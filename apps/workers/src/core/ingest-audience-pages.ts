import { logger } from "../lib/job-logger";
import { NonRetriable as AbortTaskRunError, generateSignal } from "@outrival/queue";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, changes, competitors, monitors, snapshots } from "@outrival/db";
import {
  AUDIENCE_INDEX_PATHS,
  audienceKindLabel,
  audiencePagesFromUrls,
  looksLikeAudienceIndex,
  parseAudienceIndex,
  planAudienceRun,
  type AudienceKind,
  type AudiencePageHit,
} from "@outrival/scrapers/positioning";
import { fetchPostHtml } from "@outrival/scrapers/content-fetch";
import {
  readAudienceMeta,
  recordAudiencePages,
  writeAudienceMeta,
  type NewAudiencePageRow,
} from "../lib/audience-pages";

/**
 * Who a competitor says it sells to (Positioning Intelligence v2 P3).
 *
 * A company publishes its ICP as URLs — `/for/agencies`, `/industries/fintech`,
 * `/use-cases/onboarding` — and until now those landed in the sitemap's generic "new
 * pages appeared" lump, where "12 URLs were added" says nothing about which market
 * just opened. Those pages are expensive to write and never published by accident: a
 * new one is a segment somebody decided to go after this quarter.
 *
 * Event-triggered off the sitemap branch, never a cron. Two readings and ZERO AI:
 *
 *  - THE SITEMAP, free. Every audience URL of the capture, not only the ones the
 *    diff just added: a competitor added to the workspace today has a back catalogue,
 *    and the ICP grid is supposed to show it from the first run.
 *  - THE AUDIENCE HUB, up to four GETs. A `/solutions` page that renders its cards
 *    client-side is invisible to the sitemap. Its address is probed once and cached —
 *    a MISS is cached too, or a competitor with no hub pays the probe every week.
 *
 * The rules are the market map's, deliberately:
 *  - THE FIRST PASS IS A BASELINE, and the marker is EXPLICIT rather than a row
 *    count. A competitor who publishes no audience pages keeps an empty registry
 *    forever, so a count would make every run "the first run" — and the day they
 *    publish their very first `/industries/` page, the one that says they entered a
 *    vertical, it would be swallowed as back catalogue.
 *  - THE ANNOUNCEMENT IS PER (KIND, SLUG), FOR LIFE. The unique index is the dedup.
 *  - A REMOVAL WRITES NOTHING. Marketing sites get re-slugged constantly.
 */

const InputSchema = z.object({
  snapshotId: z.string(),
  competitorId: z.string(),
  /** Audience URLs the sitemap capture holds — read for free, no fetch. */
  urls: z.array(z.string()).optional(),
});

/** Paths carried in one grouped signal before it starts counting instead. */
const MAX_NAMED = 5;

export async function runIngestAudiencePages(payload: z.input<typeof InputSchema>) {
  const input = InputSchema.parse(payload);
  logger.log("Starting ingest-audience-pages", {
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
  const meta = readAudienceMeta(competitor.metadata);
  const plan = planAudienceRun({ baselinedAt: meta.baselinedAt });

  const hits: AudiencePageHit[] = [];

  // ── The sitemap reading: free ───────────────────────────────────────────────
  hits.push(...audiencePagesFromUrls(input.urls ?? []));

  // ── The audience hub: up to four GETs, once per competitor ──────────────────
  const indexUrl = await resolveIndexUrl(competitor, meta);
  if (indexUrl) {
    const fetched = await fetchPostHtml(indexUrl);
    if (fetched.ok) {
      const linked = parseAudienceIndex(fetched.html, indexUrl);
      hits.push(...linked);
      logger.log("Audience hub read", {
        competitorId: competitor.id,
        indexUrl,
        pages: linked.length,
      });
    } else {
      logger.log("Audience hub unreadable", {
        competitorId: competitor.id,
        indexUrl,
        reason: fetched.reason,
      });
    }
  }

  const written = await recordAudiencePages(competitor.id, hits);

  // Stamped AFTER the write and on every run, so a competitor whose first capture
  // found nothing at all still leaves baseline mode — otherwise their first ever
  // audience page would be read as back catalogue.
  if (!meta.baselinedAt) {
    await writeAudienceMeta(competitor.id, {
      audiencePagesBaselinedAt: new Date().toISOString(),
    });
  }

  // "You published a /for/ page" is news the user wrote themselves.
  const canSignal = plan.mode === "read" && competitor.type !== "self";
  const emitted =
    canSignal && written.length > 0
      ? await emitNewPersonaPage({ competitor, snapshotId: snapshot.id, written })
      : false;

  logger.log("Completed ingest-audience-pages", {
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
 * Where this competitor's audience hub lives.
 *
 * Probed ONCE, then cached on `competitors.metadata` — a company that put its hub at
 * /solutions does not move it, and a MISS is cached too so a competitor with no hub
 * does not pay four GETs on every sitemap run.
 */
async function resolveIndexUrl(
  competitor: CompetitorRow,
  meta: ReturnType<typeof readAudienceMeta>,
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
  for (const path of AUDIENCE_INDEX_PATHS) {
    const candidate = `${origin}${path}`;
    const result = await fetchPostHtml(candidate);
    if (!result.ok) continue;
    // A site that serves its homepage for every unknown path answers 200, so the
    // page has to actually LINK to audience pages of its own.
    if (!looksLikeAudienceIndex(result.html, candidate)) continue;
    found = candidate;
    break;
  }

  await writeAudienceMeta(competitor.id, { audienceIndexUrl: found });
  return found;
}

/**
 * The per-competitor `audience_page` anchor: isActive=false, never scheduled, never
 * scraped.
 *
 * Its own anchor rather than the sitemap monitor's, for the reason every anchor in
 * this family has one: that chain carries the sitemap's content-hash dedup, and its
 * change row already belongs to the lexical classifier — `signals.change_id` is
 * unique, so one of the two signals would silently lose.
 */
async function ensureAnchor(competitorId: string) {
  const existing = await db.query.monitors.findFirst({
    where: and(eq(monitors.competitorId, competitorId), eq(monitors.sourceType, "audience_page")),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(monitors)
    .values({
      competitorId,
      sourceType: "audience_page",
      frequency: "weekly", // unused — this monitor is never scheduled
      isActive: false,
      config: {},
    })
    .returning();
  if (!created) throw new Error("Failed to ensure audience_page monitor");
  return created;
}

/**
 * `new_persona_page`: a segment this competitor had never published a page for.
 *
 * ONE grouped signal per run, ALL KINDS TOGETHER — a company opening a vertical
 * ships `/industries/fintech`, `/for/banks` and `/use-cases/kyc` in the same push,
 * and three alerts about one campaign is the same news three times. MEDIUM, always:
 * who they have decided to sell to is a read of the market, worth knowing on Monday
 * rather than at 2am.
 *
 * The category is `content` — the same one `new_comparison_target` uses, and for the
 * same reason: these are marketing pages a company published about its own
 * positioning. The enum is NOT extended for this.
 */
async function emitNewPersonaPage(args: {
  competitor: CompetitorRow;
  snapshotId: string;
  written: NewAudiencePageRow[];
}): Promise<boolean> {
  const { competitor, written } = args;

  const anchor = await ensureAnchor(competitor.id);
  const shownPaths = written.slice(0, MAX_NAMED).map((w) => pathOf(w.evidenceUrl) ?? w.slug);
  const rest = written.length - shownPaths.length;
  const list = shownPaths.join(", ") + (rest > 0 ? ` (+${rest} more)` : "");
  // One page reads better as the page itself — the path IS the claim, and its kind
  // says what kind of segment opened. Several read as a count plus the list.
  const headline =
    written.length === 1
      ? `New ${audienceKindLabel(written[0]!.kind as AudienceKind)} page — ${shownPaths[0]}`
      : `${written.length} new audience pages — ${list}`;

  const byKind = new Map<string, number>();
  for (const w of written) byKind.set(w.kind, (byKind.get(w.kind) ?? 0) + 1);
  const kindSummary = [...byKind.entries()]
    .map(([kind, n]) => `${n} ${audienceKindLabel(kind as AudienceKind)}`)
    .join(", ");

  const diffText =
    `${competitor.name} now publishes ${written.length === 1 ? "a page" : `${written.length} pages`} ` +
    `for ${written.length === 1 ? "a segment" : "segments"} we had never seen them claim ` +
    `(${kindSummary}):\n` +
    written.map((w) => `- [${w.kind}] ${w.displayName}: ${w.evidenceUrl ?? "(no URL)"}`).join("\n") +
    `\n\nRead from their own URLs: each segment is the slug of a persona, industry or ` +
    `use-case page they published. A company does not write those by accident — the ` +
    `page exists because somebody decided to go after that segment this quarter, and ` +
    `it names the ICP they are willing to state in public. Segments are only ever ` +
    `added here, never removed: marketing sites get re-slugged and consolidated, so a ` +
    `URL disappearing says nothing.`;

  const [change] = await db
    .insert(changes)
    .values({
      monitorId: anchor.id,
      // The capture that led us here IS the evidence, so it is the "after" side —
      // the same shape the market map and customer proof use.
      snapshotAfterId: args.snapshotId,
      diffText: diffText.slice(0, 50000),
      diffType: "text",
      rawDiff: {
        kind: "new_persona_page",
        pages: written.map((w) => ({ kind: w.kind, slug: w.slug })),
      },
      detectedAt: new Date(),
    })
    .returning();
  if (!change) return false;

  await generateSignal.enqueue({
    changeId: change.id,
    classification: {
      // The same category the comparison_page detector uses — the enum is not
      // extended for this, because it is the same subject: a marketing page a
      // company published about who it sells to.
      category: "content" as const,
      severity: "medium" as const,
      is_significant: true,
      reason: `${competitor.name} published ${written.length === 1 ? "an audience page" : `${written.length} audience pages`}: ${list}`,
      humanChangeBefore: null,
      humanChangeAfter: headline,
    },
  });

  await db.update(monitors).set({ lastChangedAt: new Date() }).where(eq(monitors.id, anchor.id));
  return true;
}

/** "https://rival.com/for/agencies" → "/for/agencies". Null when it is not a URL. */
function pathOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).pathname.replace(/\/$/, "") || null;
  } catch {
    return null;
  }
}
