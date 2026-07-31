// Wayback CDX index client + capture sampler (Pricing Intelligence P5).
//
// The availability API (wayback.ts) answers "what is archived NEAREST this
// date?", one call per date. Reconstructing a three-year price timeline that way
// costs one round trip per point and, worse, cannot tell that two of those
// points are the same capture. The CDX index answers the question this phase
// actually asks — "what captures exist for this URL, ever?" — in ONE request,
// with a content digest per row, so the sampler can pick a sparse, stable set
// before a single archived page is fetched.
//
// The Internet Archive is a shared free resource funded by donations. Everything
// here is sized to be a guest: one index call per competitor, a strict cap on
// how many captures are then fetched, sequential fetches with a delay between
// them (the caller's job), and no automatic re-runs.

const CDX_ENDPOINT = "https://web.archive.org/cdx/search/cdx";
const BACKFILL_UA = "OutrivalBackfill/1.0 (+https://outrival.app; competitive monitoring)";

export interface ArchiveCapture {
  /** 14-digit Wayback timestamp — what fetchArchivedRaw replays. */
  waybackTimestamp: string;
  capturedAt: Date;
  /** Content digest the Archive computed. Equal digests = byte-identical page,
   * which is how the sampler skips a quarter where nothing moved. */
  digest: string | null;
}

function toDay(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}`;
}

function fromWaybackTimestamp(ts: string): Date | null {
  if (!/^\d{8,14}$/.test(ts)) return null;
  const p = ts.padEnd(14, "0");
  const date = new Date(
    Date.UTC(
      Number(p.slice(0, 4)),
      Number(p.slice(4, 6)) - 1,
      Number(p.slice(6, 8)),
      Number(p.slice(8, 10)),
      Number(p.slice(10, 12)),
      Number(p.slice(12, 14)),
    ),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Every 200-status capture of `url` between two dates, oldest first.
 *
 * `collapse=timestamp:6` asks the Archive to return at most one row per MONTH,
 * which is already finer than this phase samples at — it keeps a heavily
 * archived page (some are crawled daily) from returning tens of thousands of
 * rows we would immediately throw away.
 *
 * Returns [] on anything unusable: no index, a non-200, an unparseable body.
 * A backfill with no archive to read is a normal outcome, not an error.
 */
export async function listArchiveCaptures(
  url: string,
  opts: { from: Date; to: Date; limit?: number },
): Promise<ArchiveCapture[]> {
  const query =
    `${CDX_ENDPOINT}?url=${encodeURIComponent(url)}` +
    `&output=json&fl=timestamp,statuscode,digest&filter=statuscode:200` +
    `&collapse=timestamp:6&from=${toDay(opts.from)}&to=${toDay(opts.to)}` +
    `&limit=${opts.limit ?? 200}`;

  let res: Response;
  try {
    res = await fetch(query, {
      headers: { "user-agent": BACKFILL_UA },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];

  let rows: unknown;
  try {
    rows = await res.json();
  } catch {
    return [];
  }
  if (!Array.isArray(rows) || rows.length < 2) return [];

  const out: ArchiveCapture[] = [];
  // Row 0 is the column header the `fl` parameter asked for.
  for (const row of rows.slice(1)) {
    if (!Array.isArray(row)) continue;
    const ts = typeof row[0] === "string" ? row[0] : null;
    if (!ts) continue;
    const capturedAt = fromWaybackTimestamp(ts);
    if (!capturedAt) continue;
    out.push({
      waybackTimestamp: ts,
      capturedAt,
      digest: typeof row[2] === "string" && row[2] ? row[2] : null,
    });
  }
  return out.sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
}

const quarterKey = (d: Date): string =>
  `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`;

/**
 * A sparse, stable sample of a capture list: at most one per calendar quarter.
 *
 * STABLE, because the pick inside a quarter is the FIRST capture rather than the
 * closest to some moving target — so a second run over the same URL selects the
 * same captures, and the caller's "already have a batch at this date" check
 * actually catches them instead of writing a near-duplicate.
 *
 * A quarter whose capture is byte-identical to the one already kept is skipped:
 * the Archive told us nothing changed, and storing the same page twice adds a
 * timeline point that says nothing while costing a fetch.
 *
 * Over the cap, the MOST RECENT quarters survive. A price two years ago explains
 * less than a price two quarters ago, and the cap exists to bound what we ask of
 * a free service, not to pick a random subset.
 */
export function sampleQuarterly(
  captures: readonly ArchiveCapture[],
  opts: { max: number },
): ArchiveCapture[] {
  const byQuarter = new Map<string, ArchiveCapture>();
  for (const c of [...captures].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime())) {
    const key = quarterKey(c.capturedAt);
    if (!byQuarter.has(key)) byQuarter.set(key, c);
  }

  const picked: ArchiveCapture[] = [];
  let lastDigest: string | null = null;
  for (const c of byQuarter.values()) {
    if (c.digest && c.digest === lastDigest) continue;
    picked.push(c);
    lastDigest = c.digest;
  }

  return opts.max > 0 && picked.length > opts.max ? picked.slice(-opts.max) : picked;
}
