import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { and, desc, eq, gte } from "drizzle-orm";
import {
  db,
  monitors,
  competitors,
  snapshots,
  changes,
} from "@outrival/db";
import { getScraper } from "@outrival/scrapers";
import { computeHash, computeTextDiff, uploadToR2, getFromR2 } from "@outrival/shared";

const InputSchema = z.object({
  monitorId: z.string(),
  force: z.boolean().optional().default(false),
});

const IDEMPOTENCE_WINDOW_MS = 60 * 60 * 1000;

function frequencyToMs(freq: string): number {
  switch (freq) {
    case "realtime":
      return 60 * 60 * 1000;
    case "daily":
      return 24 * 60 * 60 * 1000;
    case "weekly":
      return 7 * 24 * 60 * 60 * 1000;
    default:
      return 24 * 60 * 60 * 1000;
  }
}

export const scrapeMonitorJob = task({
  id: "scrape-monitor",
  maxDuration: 300,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },

  async run(payload: z.input<typeof InputSchema>) {
    const input = InputSchema.parse(payload);
    logger.log("Starting scrape-monitor", { monitorId: input.monitorId, force: input.force });

    const monitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, input.monitorId),
    });
    if (!monitor) throw new AbortTaskRunError(`Monitor ${input.monitorId} not found`);

    const competitor = await db.query.competitors.findFirst({
      where: eq(competitors.id, monitor.competitorId),
    });
    if (!competitor) throw new AbortTaskRunError(`Competitor ${monitor.competitorId} not found`);

    if (!input.force) {
      const cutoff = new Date(Date.now() - IDEMPOTENCE_WINDOW_MS);
      const recent = await db.query.snapshots.findFirst({
        where: and(eq(snapshots.monitorId, monitor.id), gte(snapshots.scrapedAt, cutoff)),
      });
      if (recent) {
        logger.log("Recent snapshot exists, skipping", { snapshotId: recent.id });
        return { skipped: true, reason: "recent_snapshot" };
      }
    }

    const scraper = getScraper(monitor.sourceType);
    const result = await scraper(competitor.id, competitor.url);
    const newHash = computeHash(result.html);

    const lastSnapshot = await db.query.snapshots.findFirst({
      where: eq(snapshots.monitorId, monitor.id),
      orderBy: desc(snapshots.scrapedAt),
    });

    if (lastSnapshot && lastSnapshot.contentHash === newHash) {
      logger.log("Hash identical, no change", { lastSnapshotId: lastSnapshot.id });
      await db
        .update(monitors)
        .set({
          lastRunAt: new Date(),
          nextRunAt: new Date(Date.now() + frequencyToMs(monitor.frequency)),
        })
        .where(eq(monitors.id, monitor.id));
      return { changed: false, snapshotId: lastSnapshot.id };
    }

    const timestamp = new Date().toISOString();
    const r2Key = `snapshots/${competitor.id}/${monitor.sourceType}/${timestamp}`;

    await uploadToR2(`${r2Key}.html`, result.html, "text/html; charset=utf-8");
    if (result.screenshotBuffer.length > 0) {
      await uploadToR2(`${r2Key}.png`, result.screenshotBuffer, "image/png");
    }

    const [newSnapshot] = await db
      .insert(snapshots)
      .values({
        monitorId: monitor.id,
        r2Key,
        contentHash: newHash,
        status: "success",
        scrapedAt: new Date(),
      })
      .returning();

    if (!newSnapshot) throw new Error("Failed to insert snapshot");

    let changeId: string | null = null;
    if (lastSnapshot) {
      const beforeHtml = await getFromR2(`${lastSnapshot.r2Key}.html`);
      const diff = computeTextDiff(beforeHtml, result.html);
      if (diff.hasChanges) {
        const [newChange] = await db
          .insert(changes)
          .values({
            monitorId: monitor.id,
            snapshotBeforeId: lastSnapshot.id,
            snapshotAfterId: newSnapshot.id,
            diffText: diff.diffText.slice(0, 50000),
            diffType: "text",
            rawDiff: { added: diff.added, removed: diff.removed },
            detectedAt: new Date(),
          })
          .returning();
        changeId = newChange?.id ?? null;
      }
    }

    await db
      .update(monitors)
      .set({
        lastRunAt: new Date(),
        nextRunAt: new Date(Date.now() + frequencyToMs(monitor.frequency)),
      })
      .where(eq(monitors.id, monitor.id));

    logger.log("Completed scrape-monitor", {
      monitorId: monitor.id,
      snapshotId: newSnapshot.id,
      changeId,
    });

    return {
      changed: changeId !== null,
      snapshotId: newSnapshot.id,
      changeId,
    };
  },
});
