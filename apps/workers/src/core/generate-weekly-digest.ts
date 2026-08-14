import { logger } from "../lib/job-logger";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import {
  db,
  organizations,
  signals,
  digests,
  competitors,
  sectoralSignals,
  standingQueries,
  signalVerifications,
  insertAiQualityCheck,
  loadMemorySignals,
} from "@outrival/db";
import {
  generateDigest,
  digestSourceText,
  toMyProductContext,
  AI_CONFIG,
  checkGlobalBreaker,
  type DigestInputSignal,
} from "@outrival/ai";
import {
  checkFaithfulness,
  isBlocked,
  blockedReviewEntry,
  groundableDigestLayer,
} from "../lib/faithfulness-gate";
import {
  buildCompetitorMemory,
  signDigestFeedbackToken,
  signUnsubscribeToken,
  VERIFIED_OUTCOME,
  verificationGapMinutes,
  type CompetitorMemory,
} from "@outrival/shared";
import { renderDigestEmail, renderAllQuietDigest } from "../lib/digest-email";
import { sendEmail, ALERT_FROM } from "../lib/resend";
import { loggedAi } from "../lib/analytics";
import { getAllQuietCounts } from "../lib/digest-counts";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The pair a digest section exposes, normalised. The model echoes the competitor
 * name and the category it was given, but not always the spacing or the case, and
 * the email itself prints `category.replace(/_/g, " ")` — so the key has to survive
 * both spellings of `pricing_change`.
 */
function sectionKey(competitor: string, category: string): string {
  return `${competitor.trim().toLowerCase()}::${category.trim().toLowerCase().replace(/[\s_]+/g, "_")}`;
}

/**
 * The week's `confirmed` signals, keyed the way a digest section can be looked up,
 * with the capture interval as the value (Véracité Intelligence v2 P4).
 *
 * The model's sections carry no signal id — it writes prose over the input list, and
 * neither `DigestSchema` nor `DigestInputSignal` has ever held one. Putting ids in
 * the prompt would change a shipped AI path for a display detail, so a section is
 * traced back deterministically instead, by (competitor, category).
 *
 * That pair is only a key when it identifies EXACTLY ONE signal in the week. Two
 * pricing signals for the same competitor mean the section could be describing
 * either, and badging a sentence that might be about the unverified one is exactly
 * the overstatement P4 exists to remove. Ambiguous pairs are therefore dropped, not
 * resolved: nothing is attached, and the row renders as it does today.
 */
async function confirmedVerifications(
  weekSignals: Array<{ changeId: string | null; competitor: string; category: string }>,
): Promise<Map<string, number | null>> {
  const changeIds = weekSignals
    .map((s) => s.changeId)
    .filter((id): id is string => id !== null);
  if (changeIds.length === 0) return new Map();

  // One query for the whole week, not one per section: the digest job already walks
  // every org in a loop and does not need a second nested one.
  const rows = await db
    .select({
      changeId: signalVerifications.changeId,
      quickCheckAt: signalVerifications.quickCheckAt,
      independentCheckAt: signalVerifications.independentCheckAt,
    })
    .from(signalVerifications)
    .where(
      and(
        inArray(signalVerifications.changeId, changeIds),
        eq(signalVerifications.outcome, VERIFIED_OUTCOME),
      ),
    );
  const gapByChange = new Map(
    rows.map((r) => [
      r.changeId,
      verificationGapMinutes(r.quickCheckAt, r.independentCheckAt),
    ]),
  );

  const byKey = new Map<string, { changeId: string | null; count: number }>();
  for (const s of weekSignals) {
    const key = sectionKey(s.competitor, s.category);
    const prev = byKey.get(key);
    if (prev) prev.count++;
    else byKey.set(key, { changeId: s.changeId, count: 1 });
  }

  const out = new Map<string, number | null>();
  for (const [key, v] of byKey) {
    if (v.count > 1 || !v.changeId) continue;
    if (!gapByChange.has(v.changeId)) continue;
    out.set(key, gapByChange.get(v.changeId) ?? null);
  }
  return out;
}

/**
 * Ceiling on the signal history one memory block is built from. An org watching
 * twenty competitors for a year sits far under it; past it the OLDEST facts are the
 * ones dropped, so the rendered trajectory stays correct and only `since` reads
 * later than the true first capture. The reverse (capping the recent end) would
 * silently narrate a stale story, which is worse than a shortened one.
 */
const MEMORY_HISTORY_CAP = 2000;

/**
 * What the org knows about its competitors over the whole tracking period (OUT-172).
 *
 * Deterministic and free: no AI call, and nothing here is new prose — every line is
 * the plain-language before/after the classifier recorded at the time, replayed.
 * What counts as replayable is decided by `loadMemorySignals` (@outrival/db), which
 * the competitor page reads through too so the two surfaces cannot drift.
 */
async function loadCompetitorMemory(orgId: string, now: Date): Promise<CompetitorMemory> {
  const rows = await loadMemorySignals({ orgId, limit: MEMORY_HISTORY_CAP });
  return buildCompetitorMemory(rows, { now });
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
          // The join key for the P2 ledger, which is keyed by change and not by
          // signal (packages/db/src/schema/signal-verifications.ts).
          changeId: signals.changeId,
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
        // A calm week is the one that reads as "is this even running?", so it is the
        // week the accumulated memory matters most: nothing moved, and here is
        // everything that did.
        const quietMemory = await loadCompetitorMemory(org.id, now);
        // The counts travel with the digest, not just with the email: a stored
        // all-quiet week used to carry three empty fields, so the in-app reader had
        // nothing to render and showed a blank page. With them, a calm week can
        // report the work that established it.
        const allQuietContent = {
          temperature: "low" as const,
          tldr: [],
          sections: [],
          quiet: { pages, checks },
          competitorStories: quietMemory.stories,
          competitorStoriesOmitted: quietMemory.omitted,
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
          competitorStories: quietMemory.stories,
          competitorStoriesOmitted: quietMemory.omitted,
        });

        try {
          await sendEmail({
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
      //
      // And of that output, only the section insights: the tldr and each so_what
      // are instructed by the prompt above to be written from OUR perspective and
      // to name a non-event, which this week's signals can never support. See
      // groundableDigestLayer for the production numbers and for the gap it leaves.
      const faithfulness = await checkFaithfulness({
        task: "digest",
        output: groundableDigestLayer(digest),
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

      // Accumulated memory (OUT-172): the only block of the brief that compounds.
      // Third deterministic append, after the gate for the same reason as the other
      // two — it restates facts the classifier already grounded, so it is not part
      // of what this week's generation has to answer for.
      const memory = await loadCompetitorMemory(org.id, now);
      if (memory.stories.length > 0) {
        digest.competitorStories = memory.stories;
        digest.competitorStoriesOmitted = memory.omitted;
      }

      // The double-capture badge (Véracité Intelligence v2 P4): fourth deterministic
      // append, after the gate for the same reason as the other three — it states a
      // fact the P2 ledger already recorded rather than anything this week's
      // generation had to produce. Only `confirmed` attaches; every other outcome and
      // every signal that was never in the verification perimeter leave the section
      // byte-identical to what the digest sent before P4.
      //
      // The field is written on every section, misses included: it is declared on the
      // one block the model produces, so a `verification` it invented has to be
      // cleared rather than left standing as proof nobody measured.
      const verified = await confirmedVerifications(weekSignals);
      for (const section of digest.sections) {
        const gapMinutes = verified.get(sectionKey(section.competitor, section.category));
        if (gapMinutes === undefined) delete section.verification;
        else section.verification = { gapMinutes };
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
          await sendEmail({
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
