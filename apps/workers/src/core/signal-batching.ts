import { logger } from "../lib/job-logger";
import { and, asc, count, eq, gte, inArray, isNull, min, notInArray } from "drizzle-orm";
import {
  db,
  signals,
  competitors,
  signalBatches,
  orgNotificationPreferences,
} from "@outrival/db";
import { AI_CONFIG, generateBatchSummary } from "@outrival/ai";
import { loggedAi } from "../lib/analytics";

const SEVERITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

interface Candidate {
  id: string;
  orgId: string;
  competitorId: string;
  competitorName: string;
  category: string;
  severity: string;
  insight: string;
  createdAt: Date;
}

// Patch-26 layer 5: roll up 3+ similar signals (same competitor + same category)
// within BATCHING_WINDOW_HOURS into a single batch with an AI summary, so the feed
// shows "3 minor feature updates from Linear" instead of three rows. Runs every 6h;
// idempotent (already-batched signals are excluded by batchedIntoId).
//
// Neither critical NOR high is ever batched. Critical was excluded from the start;
// high joined it when the feed started folding batches into one row, because a fold
// is a row the reader is invited to skip, and "urgent" is exactly what must not sit
// behind a chevron. The feed applies the same guard client-side (buildFeedRows), so
// a high signal batched before this rule still gets its own row.
// Runtime-neutral job body: shared verbatim by the pg-boss handler and the thin
// Trigger.dev wrapper in ../jobs/signal-batching.job.ts (deleted at the
// cutover). The body is byte-identical to the pre-migration job — only the
// header and the signature change, so the two runtimes cannot drift.
export async function runSignalBatching() {
    const windowHours = Number(process.env.BATCHING_WINDOW_HOURS ?? 24);
    const minSignals = Number(process.env.BATCHING_MIN_SIGNALS ?? 3);
    const maxGroups = Number(process.env.BATCHING_MAX_GROUPS ?? 500);
    const windowStart = new Date(Date.now() - windowHours * 3600_000);

    // Orgs that explicitly turned batching off (the default is on, so orgs without
    // a prefs row still get batched).
    const disabledRows = await db.query.orgNotificationPreferences.findMany({
      where: eq(orgNotificationPreferences.batchingEnabled, false),
      columns: { orgId: true },
    });
    const disabled = disabledRows.map((r) => r.orgId);

    // One filter object, used by both queries below: they must select exactly the
    // same candidate rows or the group counts would be measured on one population
    // and the batches built from another.
    const candidateFilter = and(
      isNull(signals.batchedIntoId),
      notInArray(signals.severity, ["critical", "high"]),
      gte(signals.createdAt, windowStart),
      // In SQL, not in the JS grouping loop: a disabled org's signals used to be
      // fetched platform-wide and then dropped, and they would now spend the run's
      // group budget too.
      disabled.length > 0 ? notInArray(signals.orgId, disabled) : undefined,
    );

    // Which (org, competitor, category) groups actually qualify — aggregated in the
    // database, oldest first, capped. The select this replaces shipped EVERY
    // unbatched signal on the platform to the worker and grouped them in memory, so
    // its cost grew with total platform volume rather than with the work to be done
    // (`code:PER-14`), and the AI call per group made the run itself unbounded.
    // FIFO by age, so the cap defers a group rather than starving it: everything
    // batched here leaves the candidate pool for the next run.
    const qualifying = await db
      .select({
        orgId: signals.orgId,
        competitorId: signals.competitorId,
        category: signals.category,
      })
      .from(signals)
      .where(candidateFilter)
      .groupBy(signals.orgId, signals.competitorId, signals.category)
      .having(gte(count(), minSignals))
      .orderBy(asc(min(signals.createdAt)))
      .limit(maxGroups);

    if (qualifying.length === 0) {
      logger.log("Completed signal-batching", { batchesCreated: 0, candidates: 0 });
      return { batchesCreated: 0 };
    }

    const wanted = new Set(
      qualifying.map((g) => `${g.orgId}|${g.competitorId}|${g.category}`),
    );

    // Narrowed to the competitors that carry a qualifying group. That can still
    // over-fetch — another category of the same competitor — so `wanted` below is
    // what decides, and the count is re-checked on the rows actually returned.
    const candidates: Candidate[] = await db
      .select({
        id: signals.id,
        orgId: signals.orgId,
        competitorId: signals.competitorId,
        competitorName: competitors.name,
        category: signals.category,
        severity: signals.severity,
        insight: signals.insight,
        createdAt: signals.createdAt,
      })
      .from(signals)
      .innerJoin(competitors, eq(signals.competitorId, competitors.id))
      .where(
        and(
          candidateFilter,
          inArray(signals.competitorId, [
            ...new Set(qualifying.map((g) => g.competitorId)),
          ]),
        ),
      );

    // Group by (org, competitor, category).
    const groups = new Map<string, Candidate[]>();
    for (const c of candidates) {
      const key = `${c.orgId}|${c.competitorId}|${c.category}`;
      if (!wanted.has(key)) continue;
      const arr = groups.get(key);
      if (arr) arr.push(c);
      else groups.set(key, [c]);
    }

    let batchesCreated = 0;

    for (const group of groups.values()) {
      if (group.length < minSignals) continue;

      const first = group[0]!;
      const summary = await loggedAi(
        "batch_summary",
        AI_CONFIG.classification,
        () =>
          generateBatchSummary({
            competitorName: first.competitorName,
            category: first.category,
            signals: group.map((s) => ({ severity: s.severity, insight: s.insight })),
          }),
        { orgId: first.orgId, competitorId: first.competitorId },
      ).catch(() => null);

      const highestSeverity = group.reduce(
        (acc, s) => ((SEVERITY_RANK[s.severity] ?? 0) > (SEVERITY_RANK[acc] ?? 0) ? s.severity : acc),
        group[0]!.severity,
      );
      const times = group.map((s) => s.createdAt.getTime());

      const [batch] = await db
        .insert(signalBatches)
        .values({
          orgId: first.orgId,
          competitorId: first.competitorId,
          signalIds: group.map((s) => s.id),
          category: first.category,
          count: group.length,
          summary,
          highestSeverity,
          windowStart: new Date(Math.min(...times)),
          windowEnd: new Date(Math.max(...times)),
        })
        .returning();

      if (!batch) continue;

      await db
        .update(signals)
        .set({ batchedIntoId: batch.id })
        .where(
          inArray(
            signals.id,
            group.map((s) => s.id),
          ),
        );
      batchesCreated++;
    }

    logger.log("Completed signal-batching", { batchesCreated, candidates: candidates.length });
    return { batchesCreated };
}
