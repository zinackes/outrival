import { extractBrand, normalizeHostname } from "@outrival/shared";
import type { ScrapeOptions, ScrapeOutcome } from "../types";
import {
  algoliaSearchUrl,
  parseAlgoliaHits,
  classifyHits,
  buildHackerNewsDoc,
  HN_WINDOW_DAYS_DEFAULT,
  type HackerNewsHit,
} from "./hackernews";

/**
 * Hacker News scraper. Derives the competitor brand + domain from its URL (and the
 * display name / ambiguity flag from options, threaded through by scrape-monitor),
 * queries HN's public Algolia search by name over a bounded recency window, applies
 * the anti-homonym guard, and synthesises a deterministic snapshot. Unlike
 * news/youtube, an EMPTY result is a VALID, common state — most competitors have no
 * HN presence — so it never throws on "no hits" (that would mark every off-HN
 * competitor unscrapable). It throws only when Algolia itself is unreachable, so
 * Trigger retries a transient failure rather than seeding a false-empty baseline.
 */

const FETCH_TIMEOUT_MS = 10_000;
const UA = "OutrivalBot/1.0 (competitive monitoring; +https://outrival.io)";

const WINDOW_DAYS = Number(process.env.HN_WINDOW_DAYS ?? HN_WINDOW_DAYS_DEFAULT);
const POINTS_THRESHOLD = process.env.HN_POINTS_THRESHOLD
  ? Number(process.env.HN_POINTS_THRESHOLD)
  : undefined;

export interface CollectDeps {
  /** Injected for tests; defaults to the real Algolia fetch. Throws on unreachable. */
  fetchJson?: (url: string) => Promise<unknown>;
  /** Injected "now" (ms) so the recency window is deterministic in tests. */
  now?: number;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": UA, accept: "application/json" },
    });
    if (!res.ok) throw new Error(`hn algolia HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Core pipeline (deps injectable for tests): url → brand/domain/name → Algolia
 * search over the recency window → guard-passing, classified hits. Returns the
 * resolved name + hits (possibly empty). Throws only if the fetch itself fails.
 */
export async function collectHits(
  url: string,
  opts: { competitorName?: string; ambiguousName?: boolean } = {},
  deps: CollectDeps = {},
): Promise<{ name: string; hits: HackerNewsHit[] }> {
  const brand = extractBrand(url);
  const domain = normalizeHostname(url);
  const name = (opts.competitorName ?? brand ?? "").trim();
  if (!name) throw new Error("hackernews: no name/brand derivable from competitor URL");

  const now = deps.now ?? Date.now();
  const sinceEpoch = now / 1000 - WINDOW_DAYS * 86_400;
  const fetchJson = deps.fetchJson ?? defaultFetchJson;

  const json = await fetchJson(algoliaSearchUrl(name, sinceEpoch));
  const hits = classifyHits(parseAlgoliaHits(json), {
    name,
    domain,
    ambiguousName: opts.ambiguousName,
    pointsThreshold: POINTS_THRESHOLD,
  });
  return { name, hits };
}

export async function scrape(
  _competitorId: string,
  url: string,
  options: ScrapeOptions = {},
): Promise<ScrapeOutcome> {
  const { name, hits } = await collectHits(url, {
    competitorName: options.competitorName,
    ambiguousName: options.ambiguousName,
  });
  const { html, text } = buildHackerNewsDoc(name, hits);
  return {
    html,
    text,
    screenshotBuffer: Buffer.alloc(0),
    metadata: {
      url: `https://news.ycombinator.com/`,
      scrapedWith: "hn-algolia",
      source: "hackernews",
      query: name,
      hits: hits.length,
      signalling: hits.filter((h) => h.kind !== "below_threshold").length,
    },
    statusCode: 200,
    level: 0,
    attempts: 1,
  };
}
