import { logger } from "../lib/job-logger";
import { NonRetriable as AbortTaskRunError, generateSignal } from "@outrival/queue";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, changes, competitors, monitors, snapshots } from "@outrival/db";
import {
  COMPARISON_INDEX_PATHS,
  comparisonTargetsFromUrls,
  looksLikeComparisonIndex,
  parseComparisonIndex,
  planComparisonRun,
  type ComparisonTargetHit,
} from "@outrival/scrapers/positioning";
import { fetchPostHtml } from "@outrival/scrapers/content-fetch";
import { resolveSelfIdentity } from "../lib/self-identity";
import {
  markTargetsAnnounced,
  pageNamesHeld,
  readMarketMapMeta,
  recordNamedTargets,
  unannouncedTargets,
  writeMarketMapMeta,
  type NewNamedTarget,
} from "../lib/named-competitors";

/**
 * Who a competitor attacks by name (Positioning Intelligence v2 P2).
 *
 * The sitemap detector has known since sitemap v2 that a `/vs/` page appeared and
 * asked one question about it: does the slug name the READER. That case is a
 * critical alert and is untouched. Everything else was thrown away — yet `/vs/klue`
 * is a company telling us in public who it thinks it is losing deals to, which is
 * the single cheapest read of a market there is.
 *
 * Event-triggered off the sitemap branch, never a cron. Two readings and ZERO AI:
 *
 *  - THE SITEMAP, free. Every comparison URL of the capture, not only the ones the
 *    diff just added: a competitor added to the workspace today has a back
 *    catalogue, and the map is supposed to show it from the first run.
 *  - THE COMPARISON HUB, up to three GETs. A `/compare` page that renders its cards
 *    client-side is invisible to the sitemap. Its address is probed once and cached
 *    — a MISS is cached too, or a competitor with no hub pays the probe every week.
 *
 * The rules are the integration catalog's, deliberately:
 *  - THE FIRST PASS IS A BASELINE, and the marker is EXPLICIT rather than a row
 *    count. A competitor who publishes no comparison pages keeps an empty registry
 *    forever, so a count would make every run "the first run" — and the day they
 *    publish their very first `/vs/` page, the most newsworthy one they will ever
 *    publish, it would be swallowed as back catalogue.
 *  - THE ANNOUNCEMENT IS PER TARGET, FOR LIFE. `/vs/crayon` and, later,
 *    `/alternatives/crayon` are two rows and one piece of news.
 *  - A REMOVAL WRITES NOTHING. Comparison pages get consolidated and re-slugged.
 */

const InputSchema = z.object({
  snapshotId: z.string(),
  competitorId: z.string(),
  /** Comparison URLs the sitemap capture holds — read for free, no fetch. */
  urls: z.array(z.string()).optional(),
});

/** Names carried in one grouped signal before it starts counting instead. */
const MAX_NAMED = 5;

export async function runIngestNamedCompetitors(payload: z.input<typeof InputSchema>) {
  const input = InputSchema.parse(payload);
  logger.log("Starting ingest-named-competitors", {
    competitorId: input.competitorId,
    urls: input.urls?.length ?? 0,
  });

  const competitor = await db.query.competitors.findFirst({
    where: eq(competitors.id, input.competitorId),
  });
  if (!competitor) throw new AbortTaskRunError(`Competitor ${input.competitorId} not found`);
  if (competitor.deletedAt) return { skipped: true, reason: "deleted" };

  const snapshot = await db.query.snapshots.findFirst({
    where: eq(snapshots.id, input.snapshotId),
  });
  if (!snapshot) throw new AbortTaskRunError(`Snapshot ${input.snapshotId} not found`);
  // A backdated archive capture shows a sitemap as it stood months ago: no signal
  // ever comes off a backfill, and the first-seen dates would be wrong.
  if (snapshot.origin === "archive") return { skipped: true, reason: "archive" };

  // Read BEFORE anything is written, so the baseline pass sees its own emptiness.
  const meta = readMarketMapMeta(competitor.metadata);
  const plan = planComparisonRun({ baselinedAt: meta.baselinedAt });

  const hits: ComparisonTargetHit[] = [];

  // ── The sitemap reading: free ───────────────────────────────────────────────
  hits.push(...comparisonTargetsFromUrls(input.urls ?? []));

  // ── The comparison hub: up to three GETs, once per competitor ──────────────
  const indexUrl = await resolveIndexUrl(competitor, meta);
  if (indexUrl) {
    const fetched = await fetchPostHtml(indexUrl);
    if (fetched.ok) {
      const linked = parseComparisonIndex(fetched.html, indexUrl);
      hits.push(...linked);
      logger.log("Comparison hub read", {
        competitorId: competitor.id,
        indexUrl,
        targets: linked.length,
      });
    } else {
      logger.log("Comparison hub unreadable", {
        competitorId: competitor.id,
        indexUrl,
        reason: fetched.reason,
      });
    }
  }

  // Resolved even for our own product: a self page comparing us to a rival must not
  // file US as our own competitor. The publisher is excluded too, separately —
  // `/compare/crayon-vs-klue` on crayon.co names its own author.
  const exclude = {
    self: await resolveSelfIdentity(competitor.orgId),
    owner: { name: competitor.name, url: competitor.url },
  };
  // Read BEFORE the write: who they were already known to publish against. A rival
  // gaining a SECOND page shape is a second row, never a second announcement.
  const knownFromPages = await pageNamesHeld(competitor.id);
  const written = await recordNamedTargets(competitor.id, hits, exclude);

  // Stamped AFTER the write and on every run, so a competitor whose first capture
  // found nothing at all still leaves baseline mode — otherwise their first ever
  // comparison page would be read as back catalogue.
  if (!meta.baselinedAt) {
    await writeMarketMapMeta(competitor.id, {
      namedCompetitorsBaselinedAt: new Date().toISOString(),
    });
  }

  // "You published a comparison page" is news the user wrote themselves.
  const canSignal = plan.mode === "read" && competitor.type !== "self";
  const emitted = canSignal
    ? await emitNewComparisonTarget({
        competitor,
        snapshotId: snapshot.id,
        written,
        knownFromPages,
      })
    : false;

  logger.log("Completed ingest-named-competitors", {
    competitorId: competitor.id,
    seen: hits.length,
    stored: written.length,
    emitted,
    baseline: plan.mode === "baseline",
  });
  return {
    seen: hits.length,
    stored: written.length,
    emitted: emitted ? 1 : 0,
    baseline: plan.mode === "baseline",
  };
}

type CompetitorRow = typeof competitors.$inferSelect;

/**
 * Where this competitor's comparison hub lives.
 *
 * Probed ONCE, then cached on `competitors.metadata` — a company that put its hub at
 * /compare does not move it, and a MISS is cached too so a competitor with no hub
 * does not pay three GETs on every sitemap run.
 */
async function resolveIndexUrl(
  competitor: CompetitorRow,
  meta: ReturnType<typeof readMarketMapMeta>,
): Promise<string | null> {
  if (meta.indexProbed) return meta.indexUrl;
  if (!competitor.url) return null;

  let origin: string;
  try {
    origin = new URL(competitor.url).origin;
  } catch {
    return null;
  }

  let found: string | null = null;
  for (const path of COMPARISON_INDEX_PATHS) {
    const candidate = `${origin}${path}`;
    const result = await fetchPostHtml(candidate);
    if (!result.ok) continue;
    // A site that serves its homepage for every unknown path answers 200, so the
    // page has to actually LINK to comparison pages of its own.
    if (!looksLikeComparisonIndex(result.html, candidate)) continue;
    found = candidate;
    break;
  }

  await writeMarketMapMeta(competitor.id, { comparisonIndexUrl: found });
  return found;
}

/**
 * The per-competitor `comparison_page` anchor: isActive=false, never scheduled,
 * never scraped. Shared with the sitemap detector and the blog reader, because all
 * three are the same subject — who this company points at — and a reader opening
 * "their comparison pages" should find one history, not three.
 */
async function ensureAnchor(competitorId: string) {
  const existing = await db.query.monitors.findFirst({
    where: and(eq(monitors.competitorId, competitorId), eq(monitors.sourceType, "comparison_page")),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(monitors)
    .values({
      competitorId,
      sourceType: "comparison_page",
      frequency: "weekly", // unused — this monitor is never scheduled
      isActive: false,
      config: {},
    })
    .returning();
  if (!created) throw new Error("Failed to ensure comparison_page monitor");
  return created;
}

/**
 * `new_comparison_target`: a rival this competitor had never pointed at before.
 *
 * ONE grouped signal per run, never one per page — a company opening a front
 * publishes `/vs/x` and `/x-alternative` in the same push, and three alerts about
 * one campaign is the same news three times. MEDIUM, always: who they think they
 * compete with is a read of the market, worth knowing on Monday. The one case that
 * is urgent — the page naming the READER — never reaches here: it stays on the
 * sitemap detector's own critical, and the reader never enters this registry.
 */
async function emitNewComparisonTarget(args: {
  competitor: CompetitorRow;
  snapshotId: string;
  written: NewNamedTarget[];
  knownFromPages: Set<string>;
}): Promise<boolean> {
  const { competitor, written, knownFromPages } = args;
  // Only a comparison PAGE opens a front. A blog post that names a rival is a
  // mention: it is in the registry, and it stays silent.
  //
  // And only a rival they did not ALREADY have a page against: a `/klue-alternatives`
  // URL appearing beside an existing `/vs/klue` is them re-slugging a fight they
  // were already in.
  const fromPages = written.filter(
    (w) =>
      (w.source === "vs_page" || w.source === "alternatives_page") &&
      !knownFromPages.has(w.nameNormalized),
  );
  if (fromPages.length === 0) return false;

  const unannounced = await unannouncedTargets(
    competitor.id,
    fromPages.map((w) => w.nameNormalized),
  );
  const fresh = fromPages.filter((w) => unannounced.has(w.nameNormalized));
  if (fresh.length === 0) return false;

  const anchor = await ensureAnchor(competitor.id);
  const shown = fresh.slice(0, MAX_NAMED).map((n) => n.displayName);
  const rest = fresh.length - shown.length;
  const list = shown.join(", ") + (rest > 0 ? ` (+${rest} more)` : "");
  // One target reads better as the page itself — the path IS the claim. Several
  // read better as names: five paths is a list nobody parses.
  const headline =
    fresh.length === 1
      ? `New comparison target — ${pathOf(fresh[0]!.evidenceUrl) ?? shown[0]}`
      : `${fresh.length} new comparison targets — ${list}`;

  const diffText =
    `${competitor.name} now publishes a comparison page against ` +
    `${fresh.length === 1 ? "a company" : `${fresh.length} companies`} ` +
    `we had never seen them point at: ${list}\n` +
    fresh.map((t) => `- ${t.displayName}: ${t.evidenceUrl ?? "(no URL)"}`).join("\n") +
    `\n\nRead from their own URLs: each name is the slug of a comparison or ` +
    `alternative page they published. Who a company builds comparison pages against ` +
    `is who its sales team keeps losing to, stated in public and on purpose — it is ` +
    `the cheapest read of a market there is. Names are only ever added here, never ` +
    `removed: comparison pages get consolidated and re-slugged, so a URL ` +
    `disappearing says nothing.`;

  const [change] = await db
    .insert(changes)
    .values({
      monitorId: anchor.id,
      // The capture that led us here IS the evidence, so it is the "after" side —
      // the same shape customer_proof and integration_published use.
      snapshotAfterId: args.snapshotId,
      diffText: diffText.slice(0, 50000),
      diffType: "text",
      rawDiff: {
        kind: "new_comparison_target",
        targets: fresh.map((t) => t.nameNormalized),
      },
      detectedAt: new Date(),
    })
    .returning();
  if (!change) return false;

  await generateSignal.enqueue({
    changeId: change.id,
    classification: {
      // The same category the comparison_page detector uses — the enum is not
      // extended for this, because it is the same subject seen from the other side.
      category: "content" as const,
      severity: "medium" as const,
      is_significant: true,
      reason: `${competitor.name} opened a comparison front against ${list}`,
      humanChangeBefore: null,
      humanChangeAfter: headline,
    },
  });

  // Stamped only once the change exists, so a crash between the two re-announces
  // rather than losing the target for good.
  await markTargetsAnnounced(competitor.id, fresh.map((t) => t.nameNormalized));
  await db.update(monitors).set({ lastChangedAt: new Date() }).where(eq(monitors.id, anchor.id));
  return true;
}

/** "https://rival.com/vs/klue" → "/vs/klue". Null when it is not a URL. */
function pathOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).pathname.replace(/\/$/, "") || null;
  } catch {
    return null;
  }
}
