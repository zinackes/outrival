import { logger } from "../lib/job-logger";
import { and, desc, eq, gte, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import {
  db,
  organizations,
  signals,
  digests,
  competitors,
  sectoralSignals,
  standingQueries,
  insertAiQualityCheck,
} from "@outrival/db";
import {
  generateDigest,
  digestSourceText,
  toMyProductContext,
  AI_CONFIG,
  checkGlobalBreaker,
  type DigestInputSignal,
} from "@outrival/ai";
import { checkFaithfulness, isBlocked, blockedReviewEntry } from "../lib/faithfulness-gate";
import { signDigestFeedbackToken, signUnsubscribeToken } from "@outrival/shared";
import { renderDigestEmail, renderAllQuietDigest } from "../lib/digest-email";
import { getResend, ALERT_FROM } from "../lib/resend";
import { loggedAi } from "../lib/analytics";
import { getAllQuietCounts } from "../lib/digest-counts";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Runtime-neutral job body: shared verbatim by the pg-boss handler and the thin
// Trigger.dev wrapper in ../jobs/generate-weekly-digest.job.ts (deleted at the
// cutover). The body is byte-identical to the pre-migration job — only the header
// and the signature change, so the two runtimes cannot drift.
export async function runGenerateWeeklyDigest(payload?: { timestamp?: Date }) {
    const now = payload?.timestamp ?? new Date();
    const weekEnd = new Date(now);
    weekEnd.setUTCHours(0, 0, 0, 0);
    const weekStart = new Date(weekEnd);
    weekStart.setUTCDate(weekStart.getUTCDate() - 7);

    const breaker = await checkGlobalBreaker();
    if (breaker.open) {
      logger.warn("AI circuit breaker open — deferring weekly digest to retry", {
        reason: breaker.reason,
        resetInSec: breaker.resetInSec,
      });
      throw new Error(`ai_circuit_breaker_open:${breaker.reason ?? "unknown"}`);
    }

    logger.log("Starting generate-weekly-digest", {
      weekStart: isoDate(weekStart),
      weekEnd: isoDate(weekEnd),
    });

    const orgs = await db.query.organizations.findMany({
      where: eq(organizations.digestEnabled, true),
    });
    logger.log("Orgs eligible for digest", { count: orgs.length });

    let sent = 0;
    let skipped = 0;
    let allQuiet = 0;
    // Orgs whose generation parse-failed this attempt — rethrown at the end so the
    // schedule retries them instead of silently skipping their week.
    const genFailures: string[] = [];

    for (const org of orgs) {
      const existing = await db.query.digests.findFirst({
        where: and(
          eq(digests.orgId, org.id),
          eq(digests.weekStart, isoDate(weekStart)),
          eq(digests.period, "weekly"),
        ),
      });
      if (existing?.sentAt) {
        logger.log("Digest already sent for org/week, skipping", {
          orgId: org.id,
          digestId: existing.id,
        });
        skipped++;
        continue;
      }

      const weekSignals = await db
        .select({
          id: signals.id,
          competitor: competitors.name,
          category: signals.category,
          severity: signals.severity,
          insight: signals.insight,
          soWhat: signals.soWhat,
        })
        .from(signals)
        .innerJoin(competitors, eq(competitors.id, signals.competitorId))
        .where(
          and(
            eq(signals.orgId, org.id),
            gte(signals.createdAt, weekStart),
            lt(signals.createdAt, weekEnd),
            // A signal whose insight the faithfulness gate refused to publish must
            // not reach an inbox through the digest either — the weekly email would
            // otherwise be the back door around the gate. It stays visible in-app.
            // (isNull kept: filteredReason is null for every normally-sent signal
            // and a bare `ne` would drop them all.)
            or(
              isNull(signals.filteredReason),
              ne(signals.filteredReason, "faithfulness_blocked"),
            ),
          ),
        );

      if (weekSignals.length === 0) {
        // All-quiet (Lever 6): a calm week still gets a light briefing instead
        // of going silent from the inbox where retention lives — silence reads
        // as "is this even running?". No AI call, so it's free to send. Only
        // sent when there's a recipient; mirrors the signal path's store-then-
        // send-then-stamp order so the persisted row + its sentAt double as
        // this org's idempotency marker for the week (checked at the top of
        // this loop via `existing?.sentAt`).
        if (!org.digestEmail) {
          logger.log("No signals and no digest email configured, skipping", {
            orgId: org.id,
          });
          skipped++;
          continue;
        }

        const { pages, checks } = await getAllQuietCounts(org.id, weekStart, weekEnd);
        // The counts travel with the digest, not just with the email: a stored
        // all-quiet week used to carry three empty fields, so the in-app reader had
        // nothing to render and showed a blank page. With them, a calm week can
        // report the work that established it.
        const allQuietContent = {
          temperature: "low" as const,
          tldr: [],
          sections: [],
          quiet: { pages, checks },
        };

        const [stored] = existing
          ? await db
              .update(digests)
              .set({
                weekEnd: isoDate(weekEnd),
                content: allQuietContent,
                temperature: "low",
              })
              .where(eq(digests.id, existing.id))
              .returning()
          : await db
              .insert(digests)
              .values({
                orgId: org.id,
                weekStart: isoDate(weekStart),
                weekEnd: isoDate(weekEnd),
                content: allQuietContent,
                temperature: "low",
                period: "weekly",
              })
              .returning();
        if (!stored) {
          logger.error("Failed to store all-quiet digest", { orgId: org.id });
          skipped++;
          continue;
        }

        const apiBase = process.env.NEXT_PUBLIC_API_URL ?? process.env.BETTER_AUTH_URL ?? "";
        const secret = process.env.BETTER_AUTH_SECRET ?? "";
        const unsubscribeUrl =
          apiBase && secret
            ? `${apiBase}/api/digest-feedback/unsubscribe?token=${signUnsubscribeToken(org.id, secret)}`
            : undefined;
        const webUrl = process.env.WEB_URL ?? "https://outrival.app";
        const html = renderAllQuietDigest({
          pages,
          checks,
          weekStart: isoDate(weekStart),
          weekEnd: isoDate(weekEnd),
          unsubscribeUrl,
          readUrl: `${webUrl}/dashboard/digests/${stored.id}?src=digest_allquiet`,
        });

        try {
          await getResend().emails.send({
            from: ALERT_FROM,
            to: org.digestEmail,
            subject: `Your Monday Competitive Briefing — all quiet (week of ${isoDate(weekStart)})`,
            html,
            ...(unsubscribeUrl
              ? {
                  headers: {
                    "List-Unsubscribe": `<${unsubscribeUrl}>`,
                    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                  },
                }
              : {}),
          });
          await db
            .update(digests)
            .set({ sentAt: new Date() })
            .where(eq(digests.id, stored.id));
          allQuiet++;
          logger.log("All-quiet digest email sent", {
            orgId: org.id,
            digestId: stored.id,
            pages,
            checks,
          });
        } catch (err) {
          logger.error("All-quiet digest email failed", { orgId: org.id, err: String(err) });
        }
        continue;
      }

      const input: DigestInputSignal[] = weekSignals.map((s) => ({
        competitor: s.competitor,
        category: s.category,
        severity: s.severity,
        insight: s.insight,
        so_what: s.soWhat,
      }));

      // Ops quality logging (patch-02): success / parse_failed (null) / error.
      const digest = await loggedAi(
        "digest",
        AI_CONFIG.digest,
        () => generateDigest(input, toMyProductContext(org.productProfile)),
        { orgId: org.id },
      );
      if (!digest) {
        // A parse miss is transient on the free reasoning providers — RETRIABLE,
        // not a silent skip (26% of prod generations failed this way and those
        // orgs simply never got their week). Keep processing the other orgs this
        // attempt; the throw below re-runs the job for the failed ones only
        // (already-sent orgs skip via the sentAt idempotency check above).
        logger.error("Digest generation failed — will retry", { orgId: org.id });
        genFailures.push(org.id);
        continue;
      }

      // Claim-level faithfulness gate, on the MODEL's output only — run before the
      // sectoral trends and watched questions are appended, since those are copied
      // verbatim from already-formulated text and are not grounded on this week's
      // signals. A blocked digest is still stored (the reviewer needs to read it,
      // and the row is this org's idempotency marker) but the EMAIL never goes out:
      // sentAt stays null and the failing claims land in the review queue.
      const faithfulness = await checkFaithfulness({
        output: digest,
        sourceText: digestSourceText(input),
        outputKind: "weekly competitive-intelligence digest",
        context: { orgId: org.id, weekStart: isoDate(weekStart) },
        attribution: { orgId: org.id },
      });

      // Sector trends (patch-13): unread + non-dismissed sectoral_signals, attached
      // verbatim (already AI-formulated) as a distinct digest section. Absent → no
      // section. analyze-sectoral runs at 07:00 UTC, this at 08:00, so the week's
      // freshly-created trends are still unread here.
      const sectoral = await db
        .select({ title: sectoralSignals.title, insight: sectoralSignals.insight })
        .from(sectoralSignals)
        .where(
          and(
            eq(sectoralSignals.orgId, org.id),
            isNull(sectoralSignals.readAt),
            isNull(sectoralSignals.dismissedAt),
          ),
        )
        .orderBy(desc(sectoralSignals.createdAt))
        .limit(10);
      if (sectoral.length > 0) digest.sectoralTrends = sectoral;

      // Standing queries: watched Ask questions whose answer materially changed
      // during the week (confirmed by the hysteresis, stamped lastAlertedAt).
      // Attached deterministically, same pattern as sectoralTrends.
      const watched = await db
        .select({
          question: standingQueries.question,
          changeSummary: standingQueries.lastChangeSummary,
        })
        .from(standingQueries)
        .where(
          and(
            eq(standingQueries.orgId, org.id),
            isNotNull(standingQueries.lastAlertedAt),
            gte(standingQueries.lastAlertedAt, weekStart),
            lt(standingQueries.lastAlertedAt, weekEnd),
          ),
        )
        .orderBy(desc(standingQueries.lastAlertedAt))
        .limit(10);
      if (watched.length > 0) {
        digest.watchedQuestions = watched.map((w) => ({
          question: w.question,
          changeSummary: w.changeSummary ?? "The answer to this question changed this week.",
        }));
      }

      // An unsent preview (from "generate now") gets finalized in place; otherwise insert.
      const [stored] = existing
        ? await db
            .update(digests)
            .set({
              weekEnd: isoDate(weekEnd),
              content: digest,
              temperature: digest.temperature,
              faithfulness,
            })
            .where(eq(digests.id, existing.id))
            .returning()
        : await db
            .insert(digests)
            .values({
              orgId: org.id,
              weekStart: isoDate(weekStart),
              weekEnd: isoDate(weekEnd),
              content: digest,
              temperature: digest.temperature,
              faithfulness,
              period: "weekly",
            })
            .returning();
      if (!stored) {
        logger.error("Failed to store digest", { orgId: org.id });
        skipped++;
        continue;
      }

      // Anti-hallucination (patch-24): persist the digest's grounding + self-check
      // envelope (grounded against the week's signals) for the ConfidenceDot and the
      // ops metrics. Best-effort.
      await insertAiQualityCheck(
        isBlocked(faithfulness) && faithfulness
          ? blockedReviewEntry({
              aiTask: "generate_digest",
              targetType: "digest",
              targetId: stored.id,
              orgId: org.id,
              quality: digest._quality,
              report: faithfulness,
            })
          : {
              aiTask: "generate_digest",
              targetType: "digest",
              targetId: stored.id,
              orgId: org.id,
              quality: digest._quality,
              faithfulness,
            },
      );

      if (isBlocked(faithfulness)) {
        // Stored, never sent: the email is the outward publication and it is what
        // the gate withholds. sentAt stays null, so a reviewer clearing the flag can
        // still send it from the digests UI.
        logger.warn("Digest email withheld by the faithfulness gate", {
          orgId: org.id,
          digestId: stored.id,
          reason: faithfulness?.reason ?? null,
        });
        skipped++;
        continue;
      }

      if (org.digestEmail) {
        try {
          // One-click feedback links (patch-21), signed so the email needs no
          // session. Degrades to no links if the secret / API base isn't set.
          const apiBase =
            process.env.NEXT_PUBLIC_API_URL ?? process.env.BETTER_AUTH_URL ?? "";
          const secret = process.env.BETTER_AUTH_SECRET ?? "";
          const feedbackLinks =
            apiBase && secret
              ? {
                  useful: `${apiBase}/api/digest-feedback?token=${signDigestFeedbackToken(
                    { orgId: org.id, digestId: stored.id, verdict: "useful" },
                    secret,
                  )}`,
                  notUseful: `${apiBase}/api/digest-feedback?token=${signDigestFeedbackToken(
                    { orgId: org.id, digestId: stored.id, verdict: "not_useful" },
                    secret,
                  )}`,
                }
              : undefined;
          const unsubscribeUrl =
            apiBase && secret
              ? `${apiBase}/api/digest-feedback/unsubscribe?token=${signUnsubscribeToken(org.id, secret)}`
              : undefined;
          const webUrl = process.env.WEB_URL ?? "https://outrival.app";
          const html = renderDigestEmail(
            digest,
            isoDate(weekStart),
            isoDate(weekEnd),
            feedbackLinks,
            unsubscribeUrl,
            undefined,
            `${webUrl}/dashboard/digests/${stored.id}?src=digest_weekly`,
          );
          await getResend().emails.send({
            from: ALERT_FROM,
            to: org.digestEmail,
            // Lever 11 — the weekly send IS the product's habit surface; brand
            // it as the Monday briefing ritual, not a generic digest.
            subject: `Your Monday Competitive Briefing — week of ${isoDate(weekStart)}`,
            html,
            // One-click unsubscribe headers improve inbox placement and let
            // mail clients surface their native unsubscribe affordance.
            ...(unsubscribeUrl
              ? {
                  headers: {
                    "List-Unsubscribe": `<${unsubscribeUrl}>`,
                    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                  },
                }
              : {}),
          });
          await db
            .update(digests)
            .set({ sentAt: new Date() })
            .where(eq(digests.id, stored.id));
          sent++;
          logger.log("Digest email sent", { orgId: org.id, digestId: stored.id });
        } catch (err) {
          logger.error("Digest email failed", { orgId: org.id, err: String(err) });
        }
      } else {
        logger.log("No digest email configured, digest stored only", {
          orgId: org.id,
          digestId: stored.id,
        });
      }
    }

    logger.log("Completed generate-weekly-digest", {
      sent,
      skipped,
      allQuiet,
      genFailures: genFailures.length,
    });
    if (genFailures.length > 0) {
      // Every other org was processed above; this retry only re-runs the failures.
      throw new Error(
        `digest_generation_failed for ${genFailures.length} org(s): ${genFailures.join(", ")}`,
      );
    }
    return { sent, skipped, allQuiet };
}
