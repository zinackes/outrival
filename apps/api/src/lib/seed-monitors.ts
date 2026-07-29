import { and, inArray } from "drizzle-orm";
import { monitors } from "@outrival/db";
import { scrapeMonitor, USER_SCRAPE_PRIORITY } from "@outrival/queue";
import {
  resolveSeedSources,
  seedFrequencyFor,
  type Plan,
  type SourceType,
} from "@outrival/shared";
import { db } from "./db";
import { enqueueJob } from "./queue";

/**
 * Internal anchors seeded on every competitor, whatever the plan. They are never
 * user-selectable (AUTOMATIC_SOURCES in the shared catalog): the user neither
 * chooses nor pays for them, so they are not part of the configurable default set.
 *
 * One list for both creation paths. Manual-add and discovery-add each kept their own
 * copy and had already drifted — `sitemap` was seeded by the manual path only, so a
 * competitor added from Discovery silently never got the new-page diff.
 */
const ANCHOR_SEEDS: readonly SourceType[] = [
  // Sitemap-diff anchor: the sorted URL-list snapshot surfaces brand-new pages
  // (including competitor comparison pages).
  "sitemap",
  // News / funding anchor: Google News RSS by brand → company-level events.
  "news",
  // Certificate Transparency (crt.sh) → a brand-new live subdomain reads as
  // expansion / pre-announcement.
  "subdomains",
  // YouTube channel resolved from a homepage link → new uploads.
  "youtube",
  // Hacker News Algolia by brand → Show HN launches / traction mentions.
  "hackernews",
  // /.well-known + llms.txt fingerprint → mobile-app launch / llms.txt manifest.
  "wellknown",
];

/**
 * Create the monitors a brand-new competitor starts with: the org's configurable
 * default set (narrowed by plan) plus the internal anchors.
 *
 * `scrapeStartedAt` is stamped on seed so the detail page and the list show the first
 * scrape as in-progress straight away instead of looking idle until the hourly cron.
 */
export async function seedCompetitorMonitors(args: {
  competitorId: string;
  plan: Plan;
  orgDefaultSources: SourceType[] | null;
}) {
  const { competitorId, plan, orgDefaultSources } = args;
  const scrapeStartedAt = new Date();
  const sources = [...resolveSeedSources(plan, orgDefaultSources), ...ANCHOR_SEEDS];

  return db
    .insert(monitors)
    .values(
      sources.map((sourceType) => ({
        competitorId,
        sourceType,
        frequency: seedFrequencyFor(sourceType),
        scrapeStartedAt,
      })),
    )
    .returning();
}

/**
 * Kick the first scrape of freshly-seeded monitors instead of waiting on the hourly
 * cron, so add → scrape → summarize → ready starts (and is visibly tracked) at once.
 * Best-effort: a failed enqueue just falls back to the cron.
 */
export async function enqueueFirstScrapes(rows: { id: string }[]): Promise<void> {
  for (const m of rows) {
    try {
      await enqueueJob(scrapeMonitor, { monitorId: m.id, force: true }, {
        priority: USER_SCRAPE_PRIORITY,
      });
    } catch (e) {
      console.error("Failed to trigger initial scrape", { monitorId: m.id, error: String(e) });
    }
  }
}

/**
 * Add the org's default sources to competitors that predate them — the retroactive
 * half of the setting, and what the "your plan unlocked new sources" banner acts on.
 *
 * Only ever ADDS: a source the user turned off stays off (the monitor row exists, so
 * it is skipped), and nothing is re-enabled behind their back. Idempotent — running
 * it twice creates nothing the second time.
 */
export async function applyDefaultSourcesToExisting(args: {
  plan: Plan;
  orgDefaultSources: SourceType[] | null;
  competitorIds: string[];
}): Promise<{ created: number; competitorsTouched: number; sources: SourceType[] }> {
  const { plan, orgDefaultSources, competitorIds } = args;
  const wanted = resolveSeedSources(plan, orgDefaultSources);
  if (competitorIds.length === 0 || wanted.length === 0) {
    return { created: 0, competitorsTouched: 0, sources: [] };
  }

  const existing = await db
    .select({ competitorId: monitors.competitorId, sourceType: monitors.sourceType })
    .from(monitors)
    .where(
      and(
        inArray(monitors.competitorId, competitorIds),
        inArray(monitors.sourceType, wanted),
      ),
    );
  const have = new Set(existing.map((m) => `${m.competitorId}:${m.sourceType}`));

  const scrapeStartedAt = new Date();
  const rows = competitorIds.flatMap((competitorId) =>
    wanted
      .filter((sourceType) => !have.has(`${competitorId}:${sourceType}`))
      .map((sourceType) => ({
        competitorId,
        sourceType,
        frequency: seedFrequencyFor(sourceType),
        scrapeStartedAt,
      })),
  );
  if (rows.length === 0) return { created: 0, competitorsTouched: 0, sources: [] };

  const created = await db.insert(monitors).values(rows).returning();
  await enqueueFirstScrapes(created);

  return {
    created: created.length,
    competitorsTouched: new Set(rows.map((r) => r.competitorId)).size,
    sources: [...new Set(rows.map((r) => r.sourceType))],
  };
}

/**
 * Per-source count of competitors that don't have a default source yet — the payload
 * behind the banner. A gap is not an error: it is what an upgrade (or a widened
 * default) just made available and nobody has applied.
 */
export async function defaultSourceGaps(args: {
  plan: Plan;
  orgDefaultSources: SourceType[] | null;
  competitorIds: string[];
}): Promise<{ sourceType: SourceType; missingOn: number }[]> {
  const { plan, orgDefaultSources, competitorIds } = args;
  const wanted = resolveSeedSources(plan, orgDefaultSources);
  if (competitorIds.length === 0 || wanted.length === 0) return [];

  const existing = await db
    .select({ competitorId: monitors.competitorId, sourceType: monitors.sourceType })
    .from(monitors)
    .where(
      and(
        inArray(monitors.competitorId, competitorIds),
        inArray(monitors.sourceType, wanted),
      ),
    );
  const have = new Set(existing.map((m) => `${m.competitorId}:${m.sourceType}`));

  return wanted
    .map((sourceType) => ({
      sourceType,
      missingOn: competitorIds.filter((id) => !have.has(`${id}:${sourceType}`)).length,
    }))
    .filter((g) => g.missingOn > 0);
}
