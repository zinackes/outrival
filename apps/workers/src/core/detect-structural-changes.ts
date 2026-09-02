import { logger } from "../lib/job-logger";
import { and, asc, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";
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
import { loggedAi } from "../lib/analytics";
import { notifyStructuralChange } from "../lib/structural-change-notify";

const MIN_SCRAPES = Number(process.env.PIVOT_DETECTION_MIN_SCRAPES ?? 3);

type StructuralChangeType = "pivot" | "site_dead" | "acquired" | "category_shift";

// Weekly, before the Monday digest. Combines a cheap structural signal (text +
// pHash diff over consecutive stable scrapes) with an AI profile-match check to
// flag a pivot/acquisition/category-shift — never auto-resolved (patch-23).
// Runtime-neutral job body: shared verbatim by the pg-boss handler and the thin
// Trigger.dev wrapper in ../jobs/detect-structural-changes.job.ts (deleted at the
// cutover). The body is byte-identical to the pre-migration job — only the
// header and the signature change, so the two runtimes cannot drift.
export async function runDetectStructuralChanges() {
    logger.log("Starting detect-structural-changes");

    // Real competitors only: never the user's own product (type = "self"). The
    // type filter moved into the WHERE: it used to be a `continue` at the top of
    // the loop, which meant self-competitors were still fetched and still counted
    // toward the ids the batched reads below have to carry.
    const comps = await db.query.competitors.findMany({
      where: and(isNull(competitors.deletedAt), ne(competitors.type, "self")),
      columns: {
        id: true,
        orgId: true,
        name: true,
        category: true,
        description: true,
        aiSummary: true,
      },
    });

    let analysed = 0;
    let detected = 0;

    if (comps.length === 0) {
      logger.log("Completed detect-structural-changes", { analysed, detected });
      return { analysed, detected };
    }

    // Everything the loop needs, read up front. The three lookups below used to sit
    // INSIDE the loop, so a weekly cron over N tracked competitors platform-wide
    // paid 3N sequential round trips to answer three questions that are one query
    // each (`code:PER-45`).
    const compIds = comps.map((c) => c.id);

    // The homepage monitor carries the strongest pivot signal.
    const homepageMonitors = await db
      .select({ id: monitors.id, competitorId: monitors.competitorId })
      .from(monitors)
      .where(
        and(inArray(monitors.competitorId, compIds), eq(monitors.sourceType, "homepage")),
      );
    const monitorByCompetitor = new Map(homepageMonitors.map((m) => [m.competitorId, m.id]));

    // Already an open structural change for this competitor → don't pile on.
    const open = await db
      .select({ competitorId: structuralChanges.competitorId })
      .from(structuralChanges)
      .where(
        and(
          inArray(structuralChanges.competitorId, compIds),
          eq(structuralChanges.status, "detected"),
        ),
      );
    const alreadyOpen = new Set(open.map((o) => o.competitorId));

    // The MIN_SCRAPES newest successful snapshots of each homepage monitor. "Top N
    // per group" is the one of the three that a plain IN(...) cannot express: a
    // window function ranks within each monitor, and the outer filter keeps the
    // same rows the per-monitor ORDER BY + LIMIT returned.
    const snapsByMonitor = new Map<string, { r2Key: string; screenshotPhash: string | null }[]>();
    if (homepageMonitors.length > 0) {
      const ranked = db
        .select({
          monitorId: snapshots.monitorId,
          r2Key: snapshots.r2Key,
          screenshotPhash: snapshots.screenshotPhash,
          rank: sql<number>`row_number() over (
            partition by ${snapshots.monitorId} order by ${snapshots.scrapedAt} desc
          )`.as("rank"),
        })
        .from(snapshots)
        .where(
          and(
            inArray(
              snapshots.monitorId,
              homepageMonitors.map((m) => m.id),
            ),
            eq(snapshots.status, "success"),
          ),
        )
        .as("ranked");

      const rows = await db
        .select({
          monitorId: ranked.monitorId,
          r2Key: ranked.r2Key,
          screenshotPhash: ranked.screenshotPhash,
        })
        .from(ranked)
        .where(lte(ranked.rank, MIN_SCRAPES))
        .orderBy(asc(ranked.rank));

      for (const row of rows) {
        const bucket = snapsByMonitor.get(row.monitorId);
        if (bucket) bucket.push(row);
        else snapsByMonitor.set(row.monitorId, [row]);
      }
    }

    for (const comp of comps) {
      const monitorId = monitorByCompetitor.get(comp.id);
      if (!monitorId) continue;

      const snaps = snapsByMonitor.get(monitorId) ?? [];
      if (snaps.length < MIN_SCRAPES) continue;

      if (alreadyOpen.has(comp.id)) continue;

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
        { orgId: comp.orgId, competitorId: comp.id },
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
}
