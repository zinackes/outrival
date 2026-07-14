import { redis, normalizeHostname } from "@outrival/shared";

// Collection doctrine: be a polite guest. Enforce a minimum gap between two
// requests to the same registrable domain (eTLD+1), honouring a robots.txt
// Crawl-delay when the site asks for a longer one. Backed by Upstash so the gap
// holds across the worker fleet, with an in-memory per-process fallback.
//
// Best-effort courtesy, not a hard limit: under a rare cross-process race two
// requests may land within the gap. That is acceptable here — the aim is to never
// hammer a domain, not to serialise the whole fleet perfectly.

const DEFAULT_MIN_GAP_MS = Number(process.env.SCRAPE_MIN_DOMAIN_GAP_MS ?? 2000);

const memLastByDomain = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * This request's scheduled time: at least `gapMs` after the previous one we
 * scheduled for the domain, but never in the past (an idle domain fires now).
 * Pure — exported for tests.
 */
export function computeFireAt(last: number, gapMs: number, now: number): number {
  return Math.max(last + gapMs, now);
}

/**
 * Block until it's polite to hit `url`'s registrable domain again: at least
 * `max(DEFAULT_MIN_GAP_MS, crawlDelayMs)` after the previous request scheduled for
 * that domain. Reserves this request's slot so concurrent callers queue behind it.
 * No-op for an unparseable URL or a non-positive gap.
 */
export async function awaitDomainSlot(
  url: string,
  crawlDelayMs?: number | null,
): Promise<void> {
  const domain = normalizeHostname(url);
  if (!domain) return;
  const gap = Math.max(DEFAULT_MIN_GAP_MS, crawlDelayMs ?? 0);
  if (gap <= 0) return;

  const key = `ratelimit:${domain}`;
  const stored = Number(await redis.get<string>(key).catch(() => null)) || 0;
  const last = Math.max(stored, memLastByDomain.get(domain) ?? 0);
  const now = Date.now();
  const fireAt = computeFireAt(last, gap, now);

  memLastByDomain.set(domain, fireAt);
  // Expire after the gap (+buffer) so an idle domain resets to "fire now" and the
  // key doesn't linger — a burst-then-idle domain never waits on a stale slot.
  await redis
    .set(key, String(fireAt), { ex: Math.ceil((gap + 5000) / 1000) })
    .catch(() => {});

  const wait = fireAt - now;
  if (wait > 0) await sleep(wait);
}

/** Test-only: drop the in-memory per-domain schedule. */
export function __clearRateLimitState(): void {
  memLastByDomain.clear();
}
