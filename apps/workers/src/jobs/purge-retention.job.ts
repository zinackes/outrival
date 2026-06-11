import { schedules, logger } from "@trigger.dev/sdk/v3";
import { sql } from "drizzle-orm";
import { db, organizations } from "@outrival/db";
import { PLAN_LIMITS, deleteManyFromR2 } from "@outrival/shared";

// Enforces PLAN_LIMITS.historyRetentionDays (free 7d / starter 30d / pro 365d /
// business 1095d) — the one tier dimension that had a value but no enforcement.
// Per org, everything strictly older than the window goes: signals (and their
// alerts/batches), changes no longer pinned by a signal, snapshots no longer
// pinned by a change (R2 objects included), notifications, and the user-facing
// analytics history (trends). Ops tables (scrape_runs, ai_runs, extraction_runs,
// platform_detection_runs, audit_log) are operator data, not org history — they
// are deliberately not touched here.
//
// Delete order follows the FK chain: alerts → signals (signal_comments cascade)
// → unreferenced signal_batches → unpinned changes (self_product_changes
// cascade) → unpinned snapshots. The latest snapshot of every monitor survives
// regardless of age: it is the diff baseline for the next scrape.
export const purgeRetentionJob = schedules.task({
  id: "purge-retention",
  cron: "0 4 * * *",
  maxDuration: 600,
  retry: { maxAttempts: 3, minTimeoutInMs: 5_000, maxTimeoutInMs: 60_000, factor: 2 },

  async run() {
    logger.log("Starting purge-retention");

    const orgs = await db.query.organizations.findMany({
      columns: { id: true, plan: true },
    });

    let purgedOrgs = 0;
    let r2Deleted = 0;

    for (const org of orgs) {
      const days = PLAN_LIMITS[org.plan].historyRetentionDays;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      await db.execute(sql`
        DELETE FROM alerts
        WHERE signal_id IN (
          SELECT id FROM signals WHERE org_id = ${org.id} AND created_at < ${cutoff}
        )`);

      await db.execute(sql`
        DELETE FROM signals WHERE org_id = ${org.id} AND created_at < ${cutoff}`);

      await db.execute(sql`
        DELETE FROM signal_batches sb
        WHERE sb.org_id = ${org.id} AND sb.window_end < ${cutoff}
          AND NOT EXISTS (SELECT 1 FROM signals s WHERE s.batched_into_id = sb.id)`);

      // A change still carrying a (recent) signal stays — signals.change_id is a
      // NOT NULL FK and the "Why this insight?" panel reads the diff.
      await db.execute(sql`
        DELETE FROM changes ch
        WHERE ch.detected_at < ${cutoff}
          AND ch.monitor_id IN (
            SELECT m.id FROM monitors m
            JOIN competitors c ON c.id = m.competitor_id
            WHERE c.org_id = ${org.id}
          )
          AND NOT EXISTS (SELECT 1 FROM signals s WHERE s.change_id = ch.id)`);

      const purgedSnapshots = await db.execute(sql`
        DELETE FROM snapshots sn
        WHERE sn.scraped_at < ${cutoff}
          AND sn.monitor_id IN (
            SELECT m.id FROM monitors m
            JOIN competitors c ON c.id = m.competitor_id
            WHERE c.org_id = ${org.id}
          )
          AND NOT EXISTS (
            SELECT 1 FROM changes ch
            WHERE ch.snapshot_before_id = sn.id OR ch.snapshot_after_id = sn.id
          )
          AND sn.scraped_at < (
            SELECT max(s2.scraped_at) FROM snapshots s2 WHERE s2.monitor_id = sn.monitor_id
          )
        RETURNING sn.r2_key`);

      await db.execute(sql`
        DELETE FROM notifications WHERE org_id = ${org.id} AND created_at < ${cutoff}`);

      // User-facing analytics history (trends/charts) follows the tier window.
      await db.execute(sql`
        DELETE FROM signal_feed WHERE org_id = ${org.id} AND recorded_at < ${cutoff}`);
      for (const [table, tsColumn] of [
        ["pricing_history", "recorded_at"],
        ["job_counts", "recorded_at"],
        ["review_scores", "recorded_at"],
        ["numeric_claims", "observed_at"],
        ["tech_stack_history", "recorded_at"],
      ] as const) {
        await db.execute(sql`
          DELETE FROM ${sql.identifier(table)}
          WHERE ${sql.identifier(tsColumn)} < ${cutoff}
            AND competitor_id IN (SELECT id FROM competitors WHERE org_id = ${org.id})`);
      }

      // R2 last, best-effort: the rows are gone either way, a failure here only
      // leaves orphaned objects (storage cost, never a dangling reference).
      const r2Keys = (purgedSnapshots as unknown as Array<{ r2_key: string }>)
        .map((r) => r.r2_key)
        .filter(Boolean)
        .flatMap((key) => [key, key.replace(/\.html$/, ".png")]);
      if (r2Keys.length > 0) {
        try {
          await deleteManyFromR2(r2Keys);
          r2Deleted += r2Keys.length;
        } catch (err) {
          logger.error("R2 purge failed (orphaned objects)", {
            orgId: org.id,
            keys: r2Keys.length,
            err: String(err),
          });
        }
      }

      purgedOrgs++;
    }

    logger.log("Completed purge-retention", { purgedOrgs, r2Deleted });
    return { purgedOrgs, r2Deleted };
  },
});
