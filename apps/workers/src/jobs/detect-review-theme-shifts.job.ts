import { task, logger, tasks, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import {
  db,
  competitors,
  monitors,
  snapshots,
  changes,
  battleCards,
  signals,
} from "@outrival/db";
import { computeHash, uploadToR2 } from "@outrival/shared";
import { getReviewScoreSeries } from "../lib/analytics";
import {
  detectThemeShifts,
  planThemeShiftEmissions,
  detectScoreDrop,
  planScoreDropEmission,
  type ThemeShiftEmission,
} from "../lib/review-theme-shift";

// Triggered off extract-reviews (per competitor) when a fresh scored review row with
// clustered complaint themes lands — NOT a cron (the Trigger schedule cap is full).
// Reads the review_scores complaint-theme series, detects sliding-window inflections,
// and — when a theme is rising — emits ONE grounded "reviews" signal (via the same
// synthetic monitor→snapshot→change→generate-signal chain tech-stack uses) and flags
// the competitor's battle cards for regeneration so the new objection munition lands.
// Themes are NOT recomputed here — they already exist on review_scores (patch-32).

const InputSchema = z.object({ competitorId: z.string() });

export const detectReviewThemeShiftsJob = task({
  id: "detect-review-theme-shifts",
  maxDuration: 60,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },

  async run(payload: z.input<typeof InputSchema>) {
    const { competitorId } = InputSchema.parse(payload);
    logger.log("Starting detect-review-theme-shifts", { competitorId });

    const competitor = await db.query.competitors.findFirst({
      where: eq(competitors.id, competitorId),
    });
    if (!competitor) throw new AbortTaskRunError(`Competitor ${competitorId} not found`);
    if (competitor.deletedAt) return { skipped: true, reason: "deleted" };

    const lookbackDays = Number(process.env.REVIEW_THEME_LOOKBACK_DAYS ?? 84);
    const windowDays = Number(process.env.REVIEW_THEME_WINDOW_DAYS ?? 42);

    const series = await getReviewScoreSeries(competitorId, lookbackDays);
    // Need at least a baseline + a recent point for a shift to mean anything.
    if (series.length < 2) return { skipped: true, reason: "insufficient_series" };

    const now = new Date();

    // 1. Complaint-theme inflection (verbatim sources — App Store carries themes).
    const rising = detectThemeShifts(series, { now, windowDays, lookbackDays });
    let emission: ThemeShiftEmission | null = null;
    let shouldFlagBattleCards = false;

    if (rising.length > 0) {
      // Bonus causality: a recent pricing/product move by the same competitor the
      // complaint rise may be reacting to. Appended to the grounded diffText.
      const windowStart = new Date(now.getTime() - windowDays * 86_400_000);
      const causalityRows = await db.query.signals.findMany({
        where: and(
          eq(signals.competitorId, competitorId),
          gte(signals.createdAt, windowStart),
          inArray(signals.category, ["pricing", "product"]),
        ),
        orderBy: desc(signals.createdAt),
        limit: 3,
        columns: { category: true, insight: true, createdAt: true },
      });
      const plan = planThemeShiftEmissions(rising, {
        competitorName: competitor.name,
        windowDays,
        causalitySignals: causalityRows.map((s) => ({
          category: s.category,
          insight: s.insight,
          createdAt: s.createdAt,
        })),
      });
      emission = plan.emission;
      shouldFlagBattleCards = plan.shouldFlagBattleCards;
    }

    // 2. Fallback: aggregate-score inflection (Reviews v2). Surface sources like
    // Trustpilot public carry a score but no verbatims/themes, so nothing rises above
    // — a sustained score drop IS the reviews signal, quantified, no verbatims needed.
    if (!emission) {
      const dropThreshold = Number(process.env.REVIEW_SCORE_DROP_THRESHOLD ?? 0.2);
      const drop = detectScoreDrop(series, { now, windowDays, lookbackDays, dropThreshold });
      const plan = planScoreDropEmission(drop, { competitorName: competitor.name, windowDays });
      emission = plan.emission;
      shouldFlagBattleCards = plan.shouldFlagBattleCards;
    }

    if (!emission) {
      logger.log("No rising complaint theme and no score drop", { competitorId });
      return { rising: rising.length, emitted: 0 };
    }

    // Ensure the per-competitor anchor monitor (isActive=false → never scheduled,
    // never scraped; exists only to satisfy the changes → snapshot FK chain).
    let monitor = await db.query.monitors.findFirst({
      where: and(eq(monitors.competitorId, competitorId), eq(monitors.sourceType, "review_shift")),
    });
    if (!monitor) {
      [monitor] = await db
        .insert(monitors)
        .values({
          competitorId,
          sourceType: "review_shift",
          frequency: "weekly", // unused — this monitor is never scheduled
          isActive: false,
          config: {},
        })
        .returning();
    }
    if (!monitor) throw new Error("Failed to ensure review_shift monitor");

    const prevSnapshot = await db.query.snapshots.findFirst({
      where: eq(snapshots.monitorId, monitor.id),
      orderBy: desc(snapshots.scrapedAt),
    });

    // Dedup: the same rising set was already signalled → no new change (mirrors the
    // pipeline's content-hash dedup). Prevents a second review source scraped the same
    // week from re-emitting an identical signal.
    const contentHash = computeHash(emission.risingKeys.join(","));
    if (prevSnapshot?.contentHash === contentHash) {
      logger.log("Rising theme set unchanged since last emission — skipping", { competitorId });
      return { rising: rising.length, emitted: 0, deduped: true };
    }

    // R2 before DB (snapshots.r2Key is NOT NULL). The snapshot body is the grounded
    // diffText — the same text generate-signal grounds the insight on.
    const timestamp = now.toISOString();
    const r2Key = `snapshots/${competitorId}/review_shift/${timestamp}`;
    await uploadToR2(`${r2Key}.txt`, emission.diffText, "text/plain; charset=utf-8", {
      compress: true,
    });

    const [snapshot] = await db
      .insert(snapshots)
      .values({
        monitorId: monitor.id,
        r2Key,
        contentHash,
        status: "success",
        scrapedAt: now,
        resolvedUrl: competitor.url ?? null,
      })
      .returning();
    if (!snapshot) throw new Error("Failed to insert review_shift snapshot");

    const [change] = await db
      .insert(changes)
      .values({
        monitorId: monitor.id,
        snapshotBeforeId: prevSnapshot?.id ?? null,
        snapshotAfterId: snapshot.id,
        diffText: emission.diffText,
        diffType: "text",
        rawDiff: { rising: emission.risingLabels },
        detectedAt: now,
      })
      .returning();
    if (!change) throw new Error("Failed to insert review_shift change");

    await tasks.trigger("generate-signal", {
      changeId: change.id,
      classification: emission.classification,
    });

    // Flag the competitor's battle cards for regeneration (existing patch-21 flag) so
    // the next generation picks up the rising complaint as fresh objection munition.
    if (shouldFlagBattleCards) {
      await db
        .update(battleCards)
        .set({ flaggedForRegenerationAt: now })
        .where(eq(battleCards.competitorId, competitorId));
    }

    logger.log("Completed detect-review-theme-shifts", {
      competitorId,
      rising: rising.length,
      changeId: change.id,
      severity: emission.classification.severity,
    });
    return { rising: rising.length, emitted: 1, changeId: change.id };
  },
});
