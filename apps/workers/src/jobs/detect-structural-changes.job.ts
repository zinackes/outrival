import { schedules, logger } from "@trigger.dev/sdk/v3";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  competitors,
  monitors,
  snapshots,
  structuralChanges,
} from "@outrival/db";
import { extractContent } from "@outrival/scrapers/extract";
import {
  detectStructuralSignal,
  type SnapshotPoint,
} from "@outrival/scrapers/structural";
import { verifyContentMatchesProfile, AI_CONFIG } from "@outrival/ai";
import { getFromR2 } from "../lib/r2";
import { loggedAi } from "../lib/clickhouse";
import { notifyStructuralChange } from "../lib/structural-change-notify";

const MIN_SCRAPES = Number(process.env.PIVOT_DETECTION_MIN_SCRAPES ?? 3);

type StructuralChangeType = "pivot" | "site_dead" | "acquired" | "category_shift";

// Weekly, before the Monday digest. Combines a cheap structural signal (text +
// pHash diff over consecutive stable scrapes) with an AI profile-match check to
// flag a pivot/acquisition/category-shift — never auto-resolved (patch-23).
export const detectStructuralChangesJob = schedules.task({
  id: "detect-structural-changes",
  cron: "0 6 * * 1",
  maxDuration: 600,

  async run() {
    logger.log("Starting detect-structural-changes");

    // Real competitors only: never the user's own product (type = "self").
    const comps = await db.query.competitors.findMany({
      where: isNull(competitors.deletedAt),
      columns: {
        id: true,
        name: true,
        category: true,
        description: true,
        aiSummary: true,
        type: true,
      },
    });

    let analysed = 0;
    let detected = 0;

    for (const comp of comps) {
      if (comp.type === "self") continue;

      // The homepage monitor carries the strongest pivot signal.
      const monitor = await db.query.monitors.findFirst({
        where: and(
          eq(monitors.competitorId, comp.id),
          eq(monitors.sourceType, "homepage"),
        ),
        columns: { id: true },
      });
      if (!monitor) continue;

      const snaps = await db.query.snapshots.findMany({
        where: and(
          eq(snapshots.monitorId, monitor.id),
          eq(snapshots.status, "success"),
        ),
        orderBy: desc(snapshots.scrapedAt),
        limit: MIN_SCRAPES,
        columns: { r2Key: true, screenshotPhash: true },
      });
      if (snaps.length < MIN_SCRAPES) continue;

      // Already an open structural change for this competitor → don't pile on.
      const open = await db.query.structuralChanges.findFirst({
        where: and(
          eq(structuralChanges.competitorId, comp.id),
          eq(structuralChanges.status, "detected"),
        ),
      });
      if (open) continue;

      let points: SnapshotPoint[];
      try {
        points = await Promise.all(
          snaps.map(async (s) => ({
            text: extractContent(await getFromR2(`${s.r2Key}.html`), "homepage"),
            phashHex: s.screenshotPhash,
          })),
        );
      } catch (err) {
        logger.warn("Skipping competitor — snapshot fetch failed", {
          competitorId: comp.id,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      analysed++;
      const signal = detectStructuralSignal(points);
      if (!signal) continue;

      // Stage 2 — AI confirmation. A redesign that still matches the profile is
      // not a pivot. logged so a rate-limit there shows in ai_runs / the banner.
      const verdict = await loggedAi(
        "verify_content_profile",
        { provider: AI_CONFIG.insights.provider, model: AI_CONFIG.insights.model },
        () =>
          verifyContentMatchesProfile({
            competitor: {
              name: comp.name,
              category: comp.category,
              description: comp.description,
              aiSummary: comp.aiSummary,
            },
            currentContent: points[0]?.text ?? "",
          }),
      );
      if (!verdict || verdict.matchesProfile) continue;

      const type: StructuralChangeType = verdict.detectedAcquisition
        ? "acquired"
        : verdict.detectedCategoryShift
          ? "category_shift"
          : "pivot";

      const [row] = await db
        .insert(structuralChanges)
        .values({
          competitorId: comp.id,
          type,
          confidence: verdict.confidence,
          evidence: {
            textDiffRatio: signal.textDiffRatio,
            phashDistance: signal.phashDistance,
            aiReasoning: verdict.reasoning,
            currentSummary: verdict.currentSummary,
          },
        })
        .returning();
      detected++;

      if (row) {
        // In-app + (throttled) email. Best-effort: a notification hiccup must not
        // lose the detection that's already persisted.
        await notifyStructuralChange(row.id).catch((err) =>
          logger.warn("Structural-change notification failed (non-fatal)", {
            structuralChangeId: row.id,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    logger.log("Completed detect-structural-changes", { analysed, detected });
    return { analysed, detected };
  },
});
