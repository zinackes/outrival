import { schedules, logger } from "@trigger.dev/sdk/v3";
import { and, desc, eq, gte, isNull, lt } from "drizzle-orm";
import { db, organizations, signals, digests, competitors, sectoralSignals } from "@outrival/db";
import { generateDigest, AI_CONFIG, type DigestInputSignal } from "@outrival/ai";
import { renderDigestEmail } from "../lib/digest-email";
import { getResend, ALERT_FROM } from "../lib/resend";
import { logAiRun } from "../lib/clickhouse";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const generateWeeklyDigestJob = schedules.task({
  id: "generate-weekly-digest",
  cron: "0 8 * * 1",
  maxDuration: 600,

  async run(payload) {
    const now = payload.timestamp ?? new Date();
    const weekEnd = new Date(now);
    weekEnd.setUTCHours(0, 0, 0, 0);
    const weekStart = new Date(weekEnd);
    weekStart.setUTCDate(weekStart.getUTCDate() - 7);

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

    for (const org of orgs) {
      const existing = await db.query.digests.findFirst({
        where: and(
          eq(digests.orgId, org.id),
          eq(digests.weekStart, isoDate(weekStart)),
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
          ),
        );

      if (weekSignals.length === 0) {
        logger.log("No signals for org this week, skipping", { orgId: org.id });
        skipped++;
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
      const { provider, model } = AI_CONFIG.digest;
      let digest;
      try {
        digest = await generateDigest(input);
      } catch (err) {
        await logAiRun("digest", provider, model, "error");
        throw err;
      }
      await logAiRun("digest", provider, model, digest ? "success" : "parse_failed");
      if (!digest) {
        logger.error("Digest generation failed", { orgId: org.id });
        skipped++;
        continue;
      }

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

      // An unsent preview (from "generate now") gets finalized in place; otherwise insert.
      const [stored] = existing
        ? await db
            .update(digests)
            .set({
              weekEnd: isoDate(weekEnd),
              content: digest,
              temperature: digest.temperature,
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
            })
            .returning();
      if (!stored) {
        logger.error("Failed to store digest", { orgId: org.id });
        skipped++;
        continue;
      }

      if (org.digestEmail) {
        try {
          const html = renderDigestEmail(digest, isoDate(weekStart), isoDate(weekEnd));
          await getResend().emails.send({
            from: ALERT_FROM,
            to: org.digestEmail,
            subject: `Outrival — Weekly digest, week of ${isoDate(weekStart)}`,
            html,
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

    logger.log("Completed generate-weekly-digest", { sent, skipped });
    return { sent, skipped };
  },
});
