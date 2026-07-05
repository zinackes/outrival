import { task, logger, tasks, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, monitors, competitors, snapshots, changes } from "@outrival/db";
import { computeHash, computeTextDiff, uploadToR2, getFromR2 } from "@outrival/shared";
import { extractContent } from "@outrival/scrapers/extract";
import { getArchivedPage } from "@outrival/scrapers/backfill";
import { evaluateSignificance } from "@outrival/ai/significance";
import { backfillQueue } from "../lib/queues";

// L2 archive backfill (docs/post-onboarding-activation.md). Fired once, from
// scrape-monitor, on the FIRST-ever capture of a backfillable source for a real
// competitor. Reconstructs the recent past from the Wayback Machine so day 0 has
// change value instead of an empty feed:
//   - homepage → one archive capture (~lookback days ago) diffed lexically against
//     the fresh scrape → a real "here's what moved" signal, marked in-app only.
//   - pricing  → several archive captures seeded into pricing_history (trend depth
//     on the pricing chart) + the lookback capture diffed for a repricing signal.
// Best-effort throughout: no archive / no diff → silent skip (that's day-0 status
// quo). Never retries (an archive insert isn't idempotent), never emails/Slacks
// (the backfill flag is derived downstream from snapshot.origin='archive').

const InputSchema = z.object({
  monitorId: z.string(),
  competitorId: z.string(),
  sourceType: z.string(),
});

const DAY_MS = 86_400_000;
// Reject a capture that's too recent to be a meaningful "past" (e.g. the page was
// only ever archived last week) — the archive-vs-current diff would be noise.
const MIN_ARCHIVE_AGE_DAYS = 14;
const LOOKBACK_DAYS = Number(process.env.BACKFILL_LOOKBACK_DAYS ?? 90);
// Extra points sampled for pricing trend depth (deduped with the lookback point).
const PRICING_OFFSETS_DAYS = (process.env.BACKFILL_PRICING_OFFSETS_DAYS ?? "30,180")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);
const SCRAPER_REGION = process.env.SCRAPER_REGION ?? "FR";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const backfillHistoryJob = task({
  id: "backfill-history",
  queue: backfillQueue,
  maxDuration: 300,
  // Not idempotent (each run inserts archive snapshots): never auto-retry, or a
  // transient failure mid-run would double-seed. Best-effort by design.
  retry: { maxAttempts: 1 },

  async run(payload: z.input<typeof InputSchema>) {
    const input = InputSchema.parse(payload);
    logger.log("Starting backfill-history", input);

    const monitor = await db.query.monitors.findFirst({ where: eq(monitors.id, input.monitorId) });
    if (!monitor) throw new AbortTaskRunError(`Monitor ${input.monitorId} not found`);
    const competitor = await db.query.competitors.findFirst({
      where: eq(competitors.id, input.competitorId),
    });
    if (!competitor) throw new AbortTaskRunError(`Competitor ${input.competitorId} not found`);
    // Self-product changes route to self_product_changes, never signals — no point
    // reconstructing the user's own past. Defensive: the trigger site already skips.
    if (competitor.type === "self") {
      return { skipped: "self" };
    }

    // The fresh scrape that triggered this backfill is the diff's "after" side.
    const currentSnapshot = await db.query.snapshots.findFirst({
      where: and(eq(snapshots.monitorId, monitor.id), eq(snapshots.origin, "live")),
      orderBy: (t) => desc(t.scrapedAt),
    });
    if (!currentSnapshot) {
      // The live snapshot should exist (we fire after inserting it); if not, bail
      // rather than retry — a later scrape will re-establish the baseline.
      return { skipped: "no_live_snapshot" };
    }
    const url = currentSnapshot.resolvedUrl ?? competitor.url;
    if (!url) return { skipped: "no_url" };

    let currentContent: string;
    try {
      currentContent = extractContent(await getFromR2(`${currentSnapshot.r2Key}.html`), monitor.sourceType);
    } catch (err) {
      logger.warn("backfill: current snapshot HTML unavailable", { error: String(err) });
      return { skipped: "no_current_html" };
    }

    const isPricing = monitor.sourceType === "pricing";
    // Largest offset first so the trend series fills oldest→newest; the lookback
    // point is where we also create the change (the canonical "past vs now").
    const offsets = isPricing
      ? [...new Set([...PRICING_OFFSETS_DAYS, LOOKBACK_DAYS])].sort((a, b) => b - a)
      : [LOOKBACK_DAYS];

    const now = Date.now();
    const seen = new Set<string>();
    let seeded = 0;
    let changeTriggered = false;

    for (const offsetDays of offsets) {
      const target = new Date(now - offsetDays * DAY_MS);
      const page = await getArchivedPage(url, target);
      if (!page) {
        logger.log("backfill: no archive near offset", { offsetDays, url });
        await sleep(1000);
        continue;
      }
      const ageDays = (now - page.capturedAt.getTime()) / DAY_MS;
      if (ageDays < MIN_ARCHIVE_AGE_DAYS || seen.has(page.waybackTimestamp)) {
        await sleep(1000);
        continue;
      }
      seen.add(page.waybackTimestamp);

      const content = extractContent(page.html, monitor.sourceType);
      // R2 before DB (invariant). Keyed by the capture time so re-runs are stable.
      const r2Key = `snapshots/${competitor.id}/${monitor.sourceType}/${page.capturedAt.toISOString()}`;
      await uploadToR2(`${r2Key}.html`, page.html, "text/html; charset=utf-8", { compress: true });
      const [archiveSnap] = await db
        .insert(snapshots)
        .values({
          monitorId: monitor.id,
          r2Key,
          contentHash: computeHash(content),
          status: "success",
          scrapedAt: page.capturedAt,
          resolvedUrl: url,
          contentSize: content.length,
          origin: "archive",
        })
        .returning();
      if (!archiveSnap) {
        await sleep(1000);
        continue;
      }
      seeded++;

      // Pricing: seed a backdated pricing_history batch (extract-pricing skips the
      // summary refresh when recordedAt is set → the archive can't clobber "now").
      if (isPricing) {
        await tasks.trigger("extract-pricing", {
          snapshotId: archiveSnap.id,
          competitorId: competitor.id,
          recordedAt: page.capturedAt.toISOString(),
          observedRegion: SCRAPER_REGION,
        });
      }

      // The change (archive → current) is created once, at the lookback offset.
      // generate-signal marks it in-app only via snapshot.origin='archive'.
      if (offsetDays === LOOKBACK_DAYS && !changeTriggered) {
        const diff = computeTextDiff(content, currentContent);
        if (diff.hasChanges) {
          const [newChange] = await db
            .insert(changes)
            .values({
              monitorId: monitor.id,
              snapshotBeforeId: archiveSnap.id,
              snapshotAfterId: currentSnapshot.id,
              diffText: diff.diffText.slice(0, 50000),
              diffType: "text",
              rawDiff: { added: diff.added, removed: diff.removed },
              detectedAt: new Date(),
            })
            .returning();
          if (newChange?.id) {
            const significance = evaluateSignificance({
              added: diff.added.join("\n"),
              removed: diff.removed.join("\n"),
            });
            if (significance.worth) {
              await tasks.trigger("classify-change", { changeId: newChange.id });
              changeTriggered = true;
            } else {
              logger.log("backfill: archive diff trivial, no signal", {
                changeId: newChange.id,
                reason: significance.reason,
              });
            }
          }
        }
      }

      await sleep(1000);
    }

    logger.log("Completed backfill-history", {
      competitorId: competitor.id,
      sourceType: monitor.sourceType,
      archivesSeeded: seeded,
      changeTriggered,
    });
    return { archivesSeeded: seeded, changeTriggered };
  },
});
