import { logger } from "../lib/job-logger";
import { sql } from "drizzle-orm";
import { db, snapshots, sqlTimestamp } from "@outrival/db";
import { PLAN_LIMITS, deleteManyFromR2, snapshotObjectKeys } from "@outrival/shared";

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
// Runtime-neutral job body: shared verbatim by the pg-boss handler and the thin
// Trigger.dev wrapper in ../jobs/purge-retention.job.ts (deleted at the cutover).
// The body is byte-identical to the pre-migration job — only the header and the
// signature change, so the two runtimes cannot drift.
export async function runPurgeRetention() {
    logger.log("Starting purge-retention");

    const orgs = await db.query.organizations.findMany({
      columns: { id: true, plan: true },
    });

    let purgedOrgs = 0;
    let r2Deleted = 0;

    // By PLAN, not by org. The retention window is a function of the plan and
    // nothing else, so an org-by-org loop paid ~15 sequential round trips per
    // tenant for a cutoff shared by every org on that tier — a daily cost growing
    // with the tenant count rather than with the data actually past retention
    // (`code:PER-44`). Four tiers means at most four passes, whatever the org
    // count, and each DELETE below is the same statement with a set of orgs
    // instead of one.
    const plans = new Map<(typeof orgs)[number]["plan"], number>();
    for (const org of orgs) plans.set(org.plan, (plans.get(org.plan) ?? 0) + 1);

    for (const [plan, orgCount] of plans) {
      const days = PLAN_LIMITS[plan].historyRetentionDays;
      // sqlTimestamp, not the Date: through drizzle, postgres-js cannot bind a Date
      // as a raw sql param. See packages/db/src/sql.ts.
      const cutoff = sqlTimestamp(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
      // Written once and inlined into every statement: the org set and the cutoff
      // have to agree, and restating the predicate ten times is how they stop
      // agreeing.
      const orgsOnPlan = sql`(SELECT id FROM organizations WHERE plan = ${plan})`;

      await db.execute(sql`
        DELETE FROM alerts
        WHERE signal_id IN (
          SELECT id FROM signals WHERE org_id IN ${orgsOnPlan} AND created_at < ${cutoff}
        )`);

      await db.execute(sql`
        DELETE FROM signals WHERE org_id IN ${orgsOnPlan} AND created_at < ${cutoff}`);

      await db.execute(sql`
        DELETE FROM signal_batches sb
        WHERE sb.org_id IN ${orgsOnPlan} AND sb.window_end < ${cutoff}
          AND NOT EXISTS (SELECT 1 FROM signals s WHERE s.batched_into_id = sb.id)`);

      // A change still carrying a (recent) signal stays — signals.change_id is a
      // NOT NULL FK and the "Why this insight?" panel reads the diff.
      await db.execute(sql`
        DELETE FROM changes ch
        WHERE ch.detected_at < ${cutoff}
          AND ch.monitor_id IN (
            SELECT m.id FROM monitors m
            JOIN competitors c ON c.id = m.competitor_id
            WHERE c.org_id IN ${orgsOnPlan}
          )
          AND NOT EXISTS (SELECT 1 FROM signals s WHERE s.change_id = ch.id)`);

      // The one statement whose rows are read back, so it goes through the query
      // builder rather than db.execute: execute hands back the driver's own result
      // shape (an array on postgres-js, a { rows } envelope on PGlite), and
      // `.returning()` is what makes the two agree.
      const purgedSnapshots = await db
        .delete(snapshots)
        .where(sql`
          snapshots.scraped_at < ${cutoff}
          AND snapshots.monitor_id IN (
            SELECT m.id FROM monitors m
            JOIN competitors c ON c.id = m.competitor_id
            WHERE c.org_id IN ${orgsOnPlan}
          )
          AND NOT EXISTS (
            SELECT 1 FROM changes ch
            WHERE ch.snapshot_before_id = snapshots.id OR ch.snapshot_after_id = snapshots.id
          )
          AND snapshots.scraped_at < (
            SELECT max(s2.scraped_at) FROM snapshots s2 WHERE s2.monitor_id = snapshots.monitor_id
          )`)
        .returning({ r2Key: snapshots.r2Key });

      await db.execute(sql`
        DELETE FROM notifications WHERE org_id IN ${orgsOnPlan} AND created_at < ${cutoff}`);

      // User-facing analytics history (trends/charts) follows the tier window.
      await db.execute(sql`
        DELETE FROM signal_feed WHERE org_id IN ${orgsOnPlan} AND recorded_at < ${cutoff}`);
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
            AND competitor_id IN (SELECT id FROM competitors WHERE org_id IN ${orgsOnPlan})`);
      }

      // R2 last, best-effort: the rows are gone either way, a failure here only
      // leaves orphaned objects (storage cost, never a dangling reference).
      const r2Keys = purgedSnapshots
        .map((r) => r.r2Key)
        .filter(Boolean)
        .flatMap(snapshotObjectKeys);
      if (r2Keys.length > 0) {
        try {
          await deleteManyFromR2(r2Keys);
          // Keys attempted, not confirmed deletions: DeleteObjects treats a
          // missing key as a no-op success, so this can't tell "deleted" apart
          // from "was already gone".
          r2Deleted += r2Keys.length;
        } catch (err) {
          logger.error("R2 purge failed (orphaned objects)", {
            plan,
            keys: r2Keys.length,
            err: String(err),
          });
        }
      }

      purgedOrgs += orgCount;
    }

    logger.log("Completed purge-retention", { purgedOrgs, r2Deleted });
    return { purgedOrgs, r2Deleted };
}
