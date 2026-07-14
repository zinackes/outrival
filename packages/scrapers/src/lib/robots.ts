import { redis } from "@outrival/shared";
import { safeFetch } from "./guarded-fetch";

// The collection doctrine promises we respect robots.txt. This module fetches and
// caches robots.txt per origin (24h) and answers isAllowed(url) BEFORE any request
// touches the page — an explicit Disallow is a refusal, never worked around.
//
// Cache: Upstash (shared, cross-run) with an in-memory per-process fallback, so a
// missing Redis (dev / prod-without-Upstash) still caches within a worker run.
// Fail-open on OUR errors (network/timeout/parse): the absence of a rule is not a
// rule — a robots.txt hiccup must not silence a source, only an explicit Disallow.

export const OUTRIVAL_BOT_NAME = "OutrivalBot";

const CACHE_TTL_SECONDS = 24 * 60 * 60;
const MAX_ROBOTS_BYTES = 500 * 1024; // oversized robots.txt → ignore (protection)
const FETCH_TIMEOUT_MS = 8000;
// Cached body sentinel for "no robots.txt / allow everything". An empty body parses
// to allow-all anyway, so "" doubles as the absent marker; null from the cache means
// a genuine miss (never fetched).
const ABSENT = "";

interface RobotsRule {
  pattern: string;
  allow: boolean;
  /** Match specificity = pattern length; the longest match wins, allow breaks ties. */
  length: number;
}
interface RobotsRules {
  rules: RobotsRule[];
  crawlDelayMs: number | null;
}

interface MemEntry {
  body: string;
  expiresAt: number;
}
const memCache = new Map<string, MemEntry>();

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// A robots.txt served as an HTML error page (a 200 SPA shell, a styled "Not Found")
// must be treated as ABSENT, never as Disallow:/ — a false blanket block would
// silence every source on the domain. Real robots.txt is line-based text/plain.
function looksLikeHtml(body: string): boolean {
  const head = body.slice(0, 512).toLowerCase().trimStart();
  return (
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    head.includes("<head") ||
    head.includes("<body")
  );
}

/** Fetch /robots.txt. Returns the body, or ABSENT ("") when there is effectively no
 * usable robots.txt. `cacheable` is false only for transient errors (network /
 * timeout), so a real 404/oversized/HTML result is cached but a blip is retried. */
async function fetchRobotsBody(origin: string): Promise<{ body: string; cacheable: boolean }> {
  try {
    const res = await safeFetch(`${origin}/robots.txt`, {
      headers: {
        "User-Agent": `Mozilla/5.0 (compatible; ${OUTRIVAL_BOT_NAME}/1.0; +https://outrival.app/bot)`,
      },
      timeoutMs: FETCH_TIMEOUT_MS,
    });
    // Any non-2xx (404/410/5xx) → no usable robots.txt → allow all. Stable → cache.
    if (res.status < 200 || res.status >= 300) return { body: ABSENT, cacheable: true };
    const body = await res.text();
    if (body.length > MAX_ROBOTS_BYTES) return { body: ABSENT, cacheable: true };
    if (looksLikeHtml(body)) return { body: ABSENT, cacheable: true };
    return { body, cacheable: true };
  } catch {
    // Network error / timeout / unsafe URL → fail-open, but don't cache the blip.
    return { body: ABSENT, cacheable: false };
  }
}

async function getRobotsBody(origin: string): Promise<string> {
  const key = `robots:${origin}`;
  const now = Date.now();

  const mem = memCache.get(key);
  if (mem && mem.expiresAt > now) return mem.body;

  const cached = await redis.get<string>(key).catch(() => null);
  if (cached !== null && cached !== undefined) {
    memCache.set(key, { body: cached, expiresAt: now + CACHE_TTL_SECONDS * 1000 });
    return cached;
  }

  const { body, cacheable } = await fetchRobotsBody(origin);
  if (cacheable) {
    memCache.set(key, { body, expiresAt: now + CACHE_TTL_SECONDS * 1000 });
    await redis.set(key, body, { ex: CACHE_TTL_SECONDS }).catch(() => {});
  }
  return body;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Translate a robots pattern (prefix match, `*` wildcard, optional `$` anchor) to a
// RegExp tested against the request path (pathname + query).
function patternToRegex(pattern: string): RegExp {
  let p = pattern;
  let anchored = false;
  if (p.endsWith("$")) {
    anchored = true;
    p = p.slice(0, -1);
  }
  const body = p.split("*").map(escapeRegex).join(".*");
  return new RegExp("^" + body + (anchored ? "$" : ""));
}

// Parse robots.txt into per-user-agent groups. Directives after a run of
// User-agent lines apply to all of them; the next User-agent that follows a
// directive opens a new group (standard grouping).
function parseGroups(body: string): Map<string, RobotsRules> {
  const groups = new Map<string, RobotsRules>();
  let currentAgents: string[] = [];
  let expectingAgent = true;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      if (!expectingAgent) {
        currentAgents = [];
        expectingAgent = true;
      }
      const agent = value.toLowerCase();
      currentAgents.push(agent);
      if (!groups.has(agent)) groups.set(agent, { rules: [], crawlDelayMs: null });
      continue;
    }

    expectingAgent = false;
    if (currentAgents.length === 0) continue; // directive before any User-agent

    if (field === "disallow" || field === "allow") {
      // An empty Disallow ("Disallow:") explicitly allows everything → no rule.
      if (field === "disallow" && value === "") continue;
      if (value === "") continue;
      for (const a of currentAgents) {
        groups.get(a)!.rules.push({ pattern: value, allow: field === "allow", length: value.length });
      }
    } else if (field === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) {
        for (const a of currentAgents) groups.get(a)!.crawlDelayMs = n * 1000;
      }
    }
  }
  return groups;
}

// Choose the group governing us: our exact bot token if present, else the wildcard
// `*` group, else none (allow all).
function selectRules(groups: Map<string, RobotsRules>): RobotsRules | null {
  return groups.get(OUTRIVAL_BOT_NAME.toLowerCase()) ?? groups.get("*") ?? null;
}

function rulesFor(body: string): RobotsRules | null {
  if (body === ABSENT) return null;
  return selectRules(parseGroups(body));
}

function pathIsAllowed(rules: RobotsRules, path: string): boolean {
  let best: RobotsRule | null = null;
  for (const r of rules.rules) {
    if (!patternToRegex(r.pattern).test(path)) continue;
    if (
      best === null ||
      r.length > best.length ||
      (r.length === best.length && r.allow && !best.allow)
    ) {
      best = r;
    }
  }
  // No matching rule → allowed. A matching rule → its verdict (allow beats disallow
  // at equal specificity, per the standard).
  return best ? best.allow : true;
}

/** Pure evaluator (network-free): does `body` allow `url` for OutrivalBot? */
export function evaluateIsAllowed(body: string, url: string): boolean {
  const rules = rulesFor(body);
  if (!rules) return true;
  let path: string;
  try {
    const u = new URL(url);
    path = u.pathname + u.search;
  } catch {
    return false;
  }
  return pathIsAllowed(rules, path);
}

/** Pure evaluator (network-free): the Crawl-delay (ms) `body` declares for us. */
export function evaluateCrawlDelayMs(body: string): number | null {
  return rulesFor(body)?.crawlDelayMs ?? null;
}

/**
 * True when robots.txt permits fetching `url` for OutrivalBot. Absent / unreachable
 * / unparsable robots.txt → true (allowed). Only an explicit matching Disallow that
 * out-specifies any Allow returns false.
 */
export async function isAllowed(url: string): Promise<boolean> {
  const origin = originOf(url);
  if (!origin) return false; // unparseable target — nothing safe to fetch
  return evaluateIsAllowed(await getRobotsBody(origin), url);
}

/**
 * The Crawl-delay (ms) robots.txt requests for OutrivalBot, or null when none is
 * declared. Consumed by the per-domain rate limiter.
 */
export async function getCrawlDelayMs(url: string): Promise<number | null> {
  const origin = originOf(url);
  if (!origin) return null;
  return evaluateCrawlDelayMs(await getRobotsBody(origin));
}

/** Test-only: drop the in-memory robots cache so cases don't leak across each other. */
export function __clearRobotsCache(): void {
  memCache.clear();
}
