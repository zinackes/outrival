import { schedules, logger } from "@trigger.dev/sdk/v3";
import { and, eq, gte, inArray, isNull, ne } from "drizzle-orm";
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
// shows "3 minor feature updates from Linear" instead of three rows. Critical
// signals are never batched. Runs every 6h; idempotent (already-batched signals are
// excluded by batchedIntoId).
export const signalBatchingJob = schedules.task({
  id: "signal-batching",
  cron: "0 */6 * * *",
  maxDuration: 300,
  retry: { maxAttempts: 3, minTimeoutInMs: 5_000, maxTimeoutInMs: 60_000, factor: 2 },

  async run() {
    const windowHours = Number(process.env.BATCHING_WINDOW_HOURS ?? 24);
    const minSignals = Number(process.env.BATCHING_MIN_SIGNALS ?? 3);
    const windowStart = new Date(Date.now() - windowHours * 3600_000);

    // Orgs that explicitly turned batching off (the default is on, so orgs without
    // a prefs row still get batched).
    const disabledRows = await db.query.orgNotificationPreferences.findMany({
      where: eq(orgNotificationPreferences.batchingEnabled, false),
      columns: { orgId: true },
    });
    const disabled = new Set(disabledRows.map((r) => r.orgId));

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
          isNull(signals.batchedIntoId),
          ne(signals.severity, "critical"),
          gte(signals.createdAt, windowStart),
        ),
      );

    // Group by (org, competitor, category).
    const groups = new Map<string, Candidate[]>();
    for (const c of candidates) {
      if (disabled.has(c.orgId)) continue;
      const key = `${c.orgId}|${c.competitorId}|${c.category}`;
      const arr = groups.get(key);
      if (arr) arr.push(c);
      else groups.set(key, [c]);
    }

    let batchesCreated = 0;

    for (const group of groups.values()) {
      if (group.length < minSignals) continue;

      const first = group[0]!;
      const summary = await loggedAi("batch_summary", AI_CONFIG.classification, () =>
        generateBatchSummary({
          competitorName: first.competitorName,
          category: first.category,
          signals: group.map((s) => ({ severity: s.severity, insight: s.insight })),
        }),
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
  },
});
