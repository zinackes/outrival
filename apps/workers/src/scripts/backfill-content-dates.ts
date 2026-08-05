// One-shot repair for blog items we stored with no publication date.
//
// Two things left ~40% of blog rows undated, and both are fixed in the code now:
// a "Recent posts" sidebar shadowed the dated listing entries for the NEWEST posts
// (blog-links.ts), and `insertItems` could never fill a date in afterwards. Neither
// fix reaches the rows already written: a blog re-ingests only when its capture
// stops being byte-identical, so an undated 2021 post can sit there for months
// while the tab dates it from the day we scraped it.
//
// So this reads each affected blog again — the feed when the page advertises one,
// the listing otherwise — and fills `published_at` where it is NULL and the source
// states one. It never overwrites a date we already hold, never inserts a row, and
// never emits a signal. Re-running it is a no-op once the dates are in.
//
// Roadmap items are skipped on purpose: a portal states a STATUS, not a
// publication date, and their `published_at` is null by design.
//
//   pnpm backfill:content-dates                       # every competitor, dry run
//   pnpm backfill:content-dates -- --apply            # write
//   pnpm backfill:content-dates -- --apply --competitor <id>
//
// Runs against whatever DATABASE_URL is loaded. On a shared environment, read
// .claude/rules/production.md first.

import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, competitors, contentItems, monitors, snapshots } from "@outrival/db";
import { canonicalizeUrl, extractPostLinks } from "@outrival/scrapers/content";
import { discoverFeedUrl, parseFeed } from "@outrival/scrapers/feeds";

const APPLY = process.argv.includes("--apply");
const idFlag = process.argv.indexOf("--competitor");
const ONLY = idFlag > -1 ? process.argv[idFlag + 1] : null;

/** Same identity the scraper writes, so a stored url matches what we read back. */
const key = (url: string): string => canonicalizeUrl(url) ?? url;

const UA = "Mozilla/5.0 (compatible; OutrivalBot/1.0; +https://outrival.io)";

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/**
 * url → ISO published date, as the blog states them today.
 *
 * A blog we could not reach and a blog that dates nothing both fill zero rows, and
 * they are not the same result — the second is final, the first is worth retrying.
 * The caller prints which one it was rather than one silent "0 dated".
 */
async function datesForBlog(listingUrl: string): Promise<Map<string, string> | null> {
  const out = new Map<string, string>();
  const html = await fetchText(listingUrl);
  if (!html) return null;

  // The listing first: it is the page the rows came off, so its links are the ones
  // that match. The feed then fills anything the rendered page does not date.
  for (const link of extractPostLinks(html, listingUrl)) {
    if (link.publishedAt) out.set(key(link.url), link.publishedAt);
  }

  const feedUrl = discoverFeedUrl(html, listingUrl);
  if (feedUrl) {
    const xml = await fetchText(feedUrl);
    for (const item of xml ? parseFeed(xml) : []) {
      if (!item.link || !item.publishedAt) continue;
      const k = key(item.link);
      if (!out.has(k)) out.set(k, item.publishedAt);
    }
  }

  return out;
}

/** The page this competitor's blog was last captured from. */
async function listingUrlFor(competitorId: string): Promise<string | null> {
  const [row] = await db
    .select({ resolvedUrl: snapshots.resolvedUrl, config: monitors.config })
    .from(monitors)
    .leftJoin(snapshots, eq(snapshots.monitorId, monitors.id))
    .where(and(eq(monitors.competitorId, competitorId), eq(monitors.sourceType, "blog")))
    .orderBy(desc(snapshots.scrapedAt))
    .limit(1);
  if (!row) return null;
  return row.resolvedUrl ?? (row.config as { url?: string } | null)?.url ?? null;
}

type Repair = { found: number; filled: number; note: string };

async function repairCompetitor(competitorId: string): Promise<Repair> {
  const rows = await db
    .select({ id: contentItems.id, url: contentItems.url })
    .from(contentItems)
    .where(
      and(
        eq(contentItems.competitorId, competitorId),
        eq(contentItems.sourceType, "blog"),
        isNull(contentItems.publishedAt),
        isNotNull(contentItems.url),
      ),
    );
  if (rows.length === 0) return { found: 0, filled: 0, note: "" };

  const listingUrl = await listingUrlFor(competitorId);
  if (!listingUrl) return { found: rows.length, filled: 0, note: "no blog page on record" };

  const dates = await datesForBlog(listingUrl);
  if (!dates) return { found: rows.length, filled: 0, note: `could not read ${listingUrl}` };
  if (dates.size === 0)
    return { found: rows.length, filled: 0, note: "the source dates nothing" };

  let filled = 0;
  for (const row of rows) {
    const at = dates.get(key(row.url!));
    if (!at) continue;
    filled++;
    if (!APPLY) continue;
    await db
      .update(contentItems)
      .set({ publishedAt: new Date(at) })
      // Re-checked at write time: a concurrent ingest may have dated it first, and
      // the publisher's own date beats one we re-derived.
      .where(and(eq(contentItems.id, row.id), isNull(contentItems.publishedAt)));
  }
  return {
    found: rows.length,
    filled,
    note: filled === rows.length ? "" : "the rest are not on the page any more",
  };
}

async function main(): Promise<void> {
  const targets = await db
    .select({ id: competitors.id, name: competitors.name })
    .from(competitors)
    .innerJoin(contentItems, eq(contentItems.competitorId, competitors.id))
    .where(
      and(
        eq(contentItems.sourceType, "blog"),
        isNull(contentItems.publishedAt),
        isNotNull(contentItems.url),
        ONLY ? eq(competitors.id, ONLY) : undefined,
      ),
    )
    .groupBy(competitors.id, competitors.name)
    .orderBy(sql`count(*) desc`);

  console.log(`${targets.length} competitor(s) with undated blog items${APPLY ? "" : " — DRY RUN"}`);

  let found = 0;
  let filled = 0;
  for (const c of targets) {
    const result = await repairCompetitor(c.id);
    found += result.found;
    filled += result.filled;
    console.log(
      `  ${c.name}: ${result.filled}/${result.found} dated${result.note ? ` (${result.note})` : ""}`,
    );
  }

  console.log(
    `${filled}/${found} rows dated${APPLY ? "" : " (dry run, re-run with --apply)"}. ` +
      `${found - filled} stay undated. The reason is on each line above.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
