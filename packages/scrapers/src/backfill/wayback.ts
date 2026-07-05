// Wayback Machine client for L2 archive backfill. Pure `fetch` — no browser, no
// deps, no API key. Two calls: find the archived capture closest to a target date
// (availability API), then fetch its RAW bytes (the `id_` flag strips the Wayback
// toolbar/URL-rewriting so we diff the real historical page, not archive chrome).
//
// The Internet Archive is a shared free resource: callers MUST rate-limit
// (~1 req/s, sequential) — see backfill-history.job.ts.

const AVAILABILITY_ENDPOINT = "https://archive.org/wayback/available";
const WEB_ENDPOINT = "https://web.archive.org/web";
// Descriptive UA so the Archive can identify (and, if ever needed, throttle) us.
const BACKFILL_UA = "OutrivalBackfill/1.0 (+https://outrival.app; competitive monitoring)";

export type ArchivedPage = {
  html: string;
  /** Capture time parsed from the 14-digit Wayback timestamp. */
  capturedAt: Date;
  /** The URL the capture was taken from (what we diff against the live page). */
  originalUrl: string;
  waybackTimestamp: string;
};

/** A Wayback timestamp is `YYYYMMDDhhmmss` (14 digits); the query accepts a prefix. */
function toWaybackTimestamp(date: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`
  );
}

function fromWaybackTimestamp(ts: string): Date | null {
  // Accept 8–14 digits; pad the missing tail with zeros → start of that day.
  if (!/^\d{8,14}$/.test(ts)) return null;
  const padded = ts.padEnd(14, "0");
  const y = Number(padded.slice(0, 4));
  const mo = Number(padded.slice(4, 6));
  const d = Number(padded.slice(6, 8));
  const h = Number(padded.slice(8, 10));
  const mi = Number(padded.slice(10, 12));
  const s = Number(padded.slice(12, 14));
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Closest available capture to `target`. Returns null when the URL has no archive
 * at all, or the response is unusable. Does NOT bound how far off `capturedAt` is
 * from `target` — the caller decides whether the deviation is acceptable (a site
 * archived only once, years ago, is not useful for a "recent past" diff).
 */
export async function findClosestArchive(
  url: string,
  target: Date,
): Promise<{ waybackTimestamp: string; capturedAt: Date } | null> {
  const query = `${AVAILABILITY_ENDPOINT}?url=${encodeURIComponent(url)}&timestamp=${toWaybackTimestamp(target)}`;
  let res: Response;
  try {
    res = await fetch(query, { headers: { "user-agent": BACKFILL_UA }, signal: AbortSignal.timeout(15000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let data: {
    archived_snapshots?: { closest?: { available?: boolean; timestamp?: string; status?: string } };
  };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    return null;
  }
  const closest = data.archived_snapshots?.closest;
  if (!closest?.available || !closest.timestamp) return null;
  // Prefer a 200 capture; a redirect/error capture is a dead page, not content.
  if (closest.status && closest.status !== "200") return null;
  const capturedAt = fromWaybackTimestamp(closest.timestamp);
  if (!capturedAt) return null;
  return { waybackTimestamp: closest.timestamp, capturedAt };
}

/**
 * Raw archived bytes via the `id_` modifier (no toolbar, no link rewriting).
 * Null on any non-200 or an implausibly small body (soft error / stub page).
 */
export async function fetchArchivedRaw(originalUrl: string, waybackTimestamp: string): Promise<string | null> {
  const raw = `${WEB_ENDPOINT}/${waybackTimestamp}id_/${originalUrl}`;
  let res: Response;
  try {
    res = await fetch(raw, { headers: { "user-agent": BACKFILL_UA }, redirect: "follow", signal: AbortSignal.timeout(20000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let html: string;
  try {
    html = await res.text();
  } catch {
    return null;
  }
  return html && html.length >= 200 ? html : null;
}

/** Find + fetch in one call. Null when there's no usable archive for `url` near `target`. */
export async function getArchivedPage(url: string, target: Date): Promise<ArchivedPage | null> {
  const found = await findClosestArchive(url, target);
  if (!found) return null;
  const html = await fetchArchivedRaw(url, found.waybackTimestamp);
  if (!html) return null;
  return { html, capturedAt: found.capturedAt, originalUrl: url, waybackTimestamp: found.waybackTimestamp };
}
