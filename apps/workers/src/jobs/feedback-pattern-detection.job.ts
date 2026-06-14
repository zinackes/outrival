import { schedules, logger } from "@trigger.dev/sdk/v3";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, qualityFeedback } from "@outrival/db";
import { sendSlackMessage } from "@outrival/shared";

// Weekly scan of quality feedback (patch-21). Surfaces only CRITICAL patterns to
// Slack so it doesn't cry wolf — the full picture lives in the admin dashboard.
// Never auto-adjusts anything: this is a heads-up for a human to investigate.
const WINDOW_DAYS = 14;
const CRITICAL_NOT_USEFUL_RATE = 0.75;
const CRITICAL_MIN_COUNT = 10;

const TYPE_LABELS: Record<string, string> = {
  signal: "Signals",
  discovery_suggestion: "Discovery",
  battle_card: "Battle cards",
  digest: "Digest",
  severity_classification: "Severity",
  nps: "NPS",
};

interface FeedbackPattern {
  targetType: string;
  total: number;
  notUseful: number;
  notUsefulRate: number;
  topReasons: Array<{ reason: string; count: number }>;
}

async function computeFeedbackPatterns(days: number): Promise<FeedbackPattern[]> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const verdictRows = await db
    .select({
      targetType: qualityFeedback.targetType,
      verdict: qualityFeedback.verdict,
      count: sql<number>`count(*)::int`,
    })
    .from(qualityFeedback)
    .where(gte(qualityFeedback.createdAt, cutoff))
    .groupBy(qualityFeedback.targetType, qualityFeedback.verdict);

  const reasonRows = await db
    .select({
      targetType: qualityFeedback.targetType,
      reason: qualityFeedback.reason,
      count: sql<number>`count(*)::int`,
    })
    .from(qualityFeedback)
    .where(
      and(gte(qualityFeedback.createdAt, cutoff), eq(qualityFeedback.verdict, "not_useful")),
    )
    .groupBy(qualityFeedback.targetType, qualityFeedback.reason);

  const totals: Record<string, { total: number; notUseful: number }> = {};
  for (const r of verdictRows) {
    const t = (totals[r.targetType] ??= { total: 0, notUseful: 0 });
    t.total += r.count;
    if (r.verdict === "not_useful") t.notUseful += r.count;
  }

  const reasonsByType: Record<string, Array<{ reason: string; count: number }>> = {};
  for (const r of reasonRows) {
    (reasonsByType[r.targetType] ??= []).push({
      reason: r.reason ?? "unspecified",
      count: r.count,
    });
  }

  return Object.entries(totals).map(([targetType, t]) => ({
    targetType,
    total: t.total,
    notUseful: t.notUseful,
    notUsefulRate: t.total > 0 ? t.notUseful / t.total : 0,
    topReasons: (reasonsByType[targetType] ?? [])
      .sort((a, b) => b.count - a.count)
      .slice(0, 3),
  }));
}

export const feedbackPatternDetectionJob = schedules.task({
  id: "feedback-pattern-detection",
  // Schedule disabled to fit Trigger's free-plan 10-schedule cap (we have 15).
  // Re-enable (uncomment) on a paid plan. Task still runs if triggered manually.
  // cron: "0 9 * * 1", // Mondays 09:00 UTC
  maxDuration: 120,

  async run() {
    logger.log("Starting feedback-pattern-detection");

    const patterns = await computeFeedbackPatterns(WINDOW_DAYS);
    const critical = patterns.filter(
      (p) => p.notUsefulRate > CRITICAL_NOT_USEFUL_RATE && p.total >= CRITICAL_MIN_COUNT,
    );

    if (critical.length === 0) {
      logger.log("Completed feedback-pattern-detection", { critical: 0 });
      return { critical: 0 };
    }

    const lines = critical.map((p) => {
      const label = TYPE_LABELS[p.targetType] ?? p.targetType;
      const reasons =
        p.topReasons.length > 0
          ? ` · ${p.topReasons.map((r) => `${r.reason} (${r.count})`).join(", ")}`
          : "";
      return `🚨 ${label}: ${Math.round(p.notUsefulRate * 100)}% not useful (${p.notUseful}/${p.total}, ${WINDOW_DAYS}d)${reasons}`;
    });
    const text = `*Outrival AI quality — critical feedback patterns*\n${lines.join("\n")}`;

    // Silent when the webhook is unset/down — never throws.
    await sendSlackMessage(process.env.OPS_SLACK_WEBHOOK_URL ?? "", text);
    logger.warn("Feedback pattern alerts fired", { count: critical.length });

    return { critical: critical.length };
  },
});
