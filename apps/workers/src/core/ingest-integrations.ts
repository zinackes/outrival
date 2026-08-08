import { logger } from "../lib/job-logger";
import { NonRetriable as AbortTaskRunError, generateSignal } from "@outrival/queue";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db, changes, competitors, knownIntegrations, monitors, snapshots } from "@outrival/db";
import {
  INTEGRATION_INDEX_PATHS,
  integrationsFromUrls,
  looksLikeIntegrationsIndex,
  parseIntegrationTiles,
  planIntegrationsRun,
  type IntegrationNameHit,
} from "@outrival/scrapers/content";
import { fetchPostHtml } from "@outrival/scrapers/content-fetch";
import { readIngestFirstRun, stampIngestFirstRun } from "../lib/ingest-first-run";

/**
 * Read what a competitor plugs into (Content Intelligence v2 P5).
 *
 * `partnerships` is a first-class signal category that no source fed directly: a
 * competitor shipping a Salesforce connector only reached the feed if a blog post
 * happened to mention it. An integration catalog publishes exactly that, as a list.
 *
 * Event-triggered off the sitemap branch, never a cron. Two readings and ZERO AI:
 *
 *  - THE SITEMAP, free. A /integrations/<slug> URL names an integration, and the
 *    sitemap is already walked weekly. No fetch, no parse, no model.
 *  - THE CATALOG PAGE, one GET. A catalog that renders tiles without per-tile URLs
 *    is invisible to the sitemap. Its address is probed once and cached (a MISS is
 *    cached too, or a competitor with no catalog would pay the probe every week).
 *
 * The rules are the customer registry's, deliberately:
 *  - THE FIRST PASS IS A BASELINE. A catalog lists everything ever shipped.
 *  - THE REGISTRY IS THE DEDUP. Unique per (competitor, normalised name), so an
 *    integration listed on the catalog, then in the sitemap, then again next quarter
 *    is ONE piece of news, for good.
 *  - A REMOVAL WRITES NOTHING. Catalogs paginate and get reorganised; "gone from the
 *    page we captured last week" is not evidence a partnership ended.
 */

const InputSchema = z.object({
  snapshotId: z.string(),
  competitorId: z.string(),
  /** URLs the sitemap capture just added — read for free, no fetch. */
  urls: z.array(z.string()).optional(),
});

/** Names carried in one grouped signal before it starts counting instead. */
const MAX_NAMED = 5;

export async function runIngestIntegrations(payload: z.input<typeof InputSchema>) {
  const input = InputSchema.parse(payload);
  logger.log("Starting ingest-integrations", {
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
  // A backdated archive capture shows a catalog as it stood months ago: no signal
  // ever comes off a backfill, and the first-seen dates would be wrong.
  if (snapshot.origin === "archive") return { skipped: true, reason: "archive" };

  // Counted BEFORE anything is written, so the baseline pass sees zero.
  const [held] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(knownIntegrations)
    .where(eq(knownIntegrations.competitorId, competitor.id));
  const plan = planIntegrationsRun({ heldRows: Number(held?.n ?? 0) });

  const hits: IntegrationNameHit[] = [];

  // ── The sitemap reading: free ───────────────────────────────────────────────
  hits.push(...integrationsFromUrls(input.urls ?? []));

  // ── The catalog page: one GET ──────────────────────────────────────────────
  const indexUrl = await resolveIndexUrl(competitor);
  if (indexUrl) {
    const fetched = await fetchPostHtml(indexUrl);
    if (fetched.ok) {
      const tiles = parseIntegrationTiles(fetched.html, indexUrl);
      hits.push(...tiles);
      logger.log("Integration catalog read", {
        competitorId: competitor.id,
        indexUrl,
        tiles: tiles.length,
      });
    } else {
      logger.log("Integration catalog unreadable", {
        competitorId: competitor.id,
        indexUrl,
        reason: fetched.reason,
      });
    }
  }

  const written = await recordIntegrations(competitor.id, hits, indexUrl);

  // Stamped AFTER the write and on every run, so a competitor whose catalog is empty
  // — or who has none at all — still records that this ingest HAS read them. The
  // baseline above is a row count and cannot say that: zero rows is the permanent
  // state of a competitor with no catalog, so the sitemap's no-change catch-up would
  // re-enqueue this run every week forever without a marker of its own.
  if (!readIngestFirstRun(competitor.metadata, "integrationsFirstRunAt")) {
    await stampIngestFirstRun(competitor.id, "integrationsFirstRunAt");
  }

  logger.log("Integrations recorded", {
    competitorId: competitor.id,
    seen: hits.length,
    newNames: written.length,
    baseline: plan.mode === "baseline",
  });

  // "You added an integration" is news the user wrote themselves.
  const canSignal = plan.mode === "read" && competitor.type !== "self";
  const emitted = canSignal
    ? await emitIntegrationPublished({
        competitor,
        snapshotId: snapshot.id,
        names: written,
        evidenceUrl: indexUrl,
      })
    : false;

  logger.log("Completed ingest-integrations", {
    competitorId: competitor.id,
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

/** A name that entered the registry on this run. */
interface NewIntegration {
  displayName: string;
  firstSeenAt: Date;
  evidenceUrl: string | null;
}

/**
 * Where this competitor's catalog lives.
 *
 * Probed ONCE, then cached on `competitors.metadata` — a company that put its
 * catalog at /integrations does not move it, and a MISS is cached too so a
 * competitor with no catalog does not pay the probe on every sitemap run. Merged in
 * SQL so a concurrent write of a sibling key (customersUrl, mobileApps) survives.
 */
async function resolveIndexUrl(competitor: CompetitorRow): Promise<string | null> {
  const meta = (competitor.metadata ?? {}) as Record<string, unknown>;
  const cached = typeof meta.integrationsUrl === "string" ? meta.integrationsUrl : null;
  if (cached) return cached;
  if (meta.integrationsUrl === null) return null;
  if (!competitor.url) return null;

  let origin: string;
  try {
    origin = new URL(competitor.url).origin;
  } catch {
    return null;
  }

  let found: string | null = null;
  for (const path of INTEGRATION_INDEX_PATHS) {
    const candidate = `${origin}${path}`;
    const result = await fetchPostHtml(candidate);
    if (!result.ok) continue;
    // A site that serves its homepage for every unknown path answers 200 with a wall
    // of logos, which is exactly what we came for — so the page has to NAME itself
    // as a catalog, not merely carry logos.
    if (!looksLikeIntegrationsIndex(result.html, candidate)) continue;
    found = candidate;
    break;
  }

  await db
    .update(competitors)
    .set({
      metadata: sql`coalesce(${competitors.metadata}, '{}'::jsonb) || ${JSON.stringify({
        integrationsUrl: found,
      })}::jsonb`,
    })
    .where(eq(competitors.id, competitor.id));
  return found;
}

/**
 * Put names into the registry and report which ones were NEW.
 *
 * The unique index does the work: an insert that conflicts returns nothing, so what
 * comes back is exactly the integrations we had never seen this competitor claim.
 */
async function recordIntegrations(
  competitorId: string,
  hits: ReadonlyArray<IntegrationNameHit>,
  fallbackUrl: string | null,
): Promise<NewIntegration[]> {
  const seen = new Set<string>();
  const values = hits
    .filter((h) => {
      if (!h.nameNormalized || seen.has(h.nameNormalized)) return false;
      seen.add(h.nameNormalized);
      return true;
    })
    .map((h) => ({
      competitorId,
      nameNormalized: h.nameNormalized,
      displayName: h.displayName,
      evidenceUrl: h.evidenceUrl || fallbackUrl,
    }));
  if (values.length === 0) return [];

  return await db
    .insert(knownIntegrations)
    .values(values)
    .onConflictDoNothing()
    .returning({
      displayName: knownIntegrations.displayName,
      firstSeenAt: knownIntegrations.firstSeenAt,
      evidenceUrl: knownIntegrations.evidenceUrl,
    });
}

/**
 * The per-competitor `integration_catalog` anchor: isActive=false, never scheduled,
 * never scraped. It carries the change → signal FK chain and keeps these signals off
 * the sitemap monitor's own snapshot chain, which is what content-hash dedup diffs
 * the next capture against.
 */
async function ensureAnchor(competitorId: string) {
  const existing = await db.query.monitors.findFirst({
    where: and(
      eq(monitors.competitorId, competitorId),
      eq(monitors.sourceType, "integration_catalog"),
    ),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(monitors)
    .values({
      competitorId,
      sourceType: "integration_catalog",
      frequency: "weekly", // unused — this monitor is never scheduled
      isActive: false,
      config: {},
    })
    .returning();
  if (!created) throw new Error("Failed to ensure integration_catalog monitor");
  return created;
}

/**
 * `integration_published`: names in the catalog we have never seen there before.
 *
 * ONE grouped signal per run, never one per name — a competitor that ships a batch
 * of connectors lists them together, and three alerts about one release is the same
 * news three times. MEDIUM, always: a new integration widens where a rival can sell,
 * which is worth knowing on Monday, not worth a phone call.
 */
async function emitIntegrationPublished(args: {
  competitor: CompetitorRow;
  snapshotId: string;
  names: NewIntegration[];
  evidenceUrl: string | null;
}): Promise<boolean> {
  const { competitor, names } = args;
  if (names.length === 0) return false;

  const anchor = await ensureAnchor(competitor.id);
  const shown = names.slice(0, MAX_NAMED).map((n) => n.displayName);
  const rest = names.length - shown.length;
  const list = shown.join(", ") + (rest > 0 ? ` (+${rest} more)` : "");
  const headline =
    names.length === 1 ? `New integration — ${shown[0]}` : `${names.length} new integrations — ${list}`;
  const source = args.evidenceUrl ?? names.find((n) => n.evidenceUrl)?.evidenceUrl ?? null;

  const diffText =
    `${competitor.name} now lists ${names.length === 1 ? "an integration" : `${names.length} integrations`} ` +
    `we had never seen them claim: ${list}\n` +
    (source ? `Seen on ${source}\n` : "") +
    `\nRead from their own catalog: each name is either a listing URL of their own or ` +
    `the name their catalog prints on the tile. An integration is where a competitor ` +
    `can now sell that they could not last quarter, and it is usually built because a ` +
    `deal asked for it. Names are only ever added here, never removed: catalogs ` +
    `paginate and get reorganised, so a name disappearing says nothing.`;

  const [change] = await db
    .insert(changes)
    .values({
      monitorId: anchor.id,
      // The capture that led us here IS the evidence, so it is the "after" side —
      // the same shape customer_proof and competitor_named_you use.
      snapshotAfterId: args.snapshotId,
      diffText: diffText.slice(0, 50000),
      diffType: "text",
      rawDiff: {
        kind: "integration_published",
        names: names.map((n) => n.displayName),
        evidenceUrl: source,
      },
      detectedAt: new Date(),
    })
    .returning();
  if (!change) return false;

  await generateSignal.enqueue({
    changeId: change.id,
    classification: {
      category: "partnerships" as const,
      severity: "medium" as const,
      is_significant: true,
      reason: `${competitor.name} published ${names.length} new integration${names.length === 1 ? "" : "s"}: ${list}`,
      humanChangeBefore: null,
      humanChangeAfter: headline,
    },
  });

  await db.update(monitors).set({ lastChangedAt: new Date() }).where(eq(monitors.id, anchor.id));
  return true;
}
