/**
 * Reading the total from the calculator's OWN pricing endpoint (P4, strategy A).
 *
 * Many calculators do the arithmetic server-side: the page moves a slider, fires
 * one XHR carrying the quantity, and paints whatever JSON comes back. When that
 * is the case the JSON is a far better source than the DOM — no formatting, no
 * animated counter mid-tween, no re-finding a selector after a re-render.
 *
 * What this module does NOT do is forge requests. The endpoint is only ever read
 * as the page's own response to an interaction we performed on the public UI, in
 * the browser, at human pace. Replaying a private JSON API by hand at four
 * volumes would be a different act from using the product's calculator — and it
 * would also leave the run with no screenshot to show, which the evidence rule
 * requires for every stored point. So: the endpoint supplies the NUMBER, the UI
 * interaction supplies the PROOF, and every point still has both.
 *
 * Pure — the browser hands over the captured JSON, this finds the price inside it.
 */

/** One JSON response observed during an interaction. */
export interface CapturedJson {
  url: string;
  body: unknown;
}

export interface PricePath {
  /** Pathname of the responding endpoint — the key later reads are matched on
   * (the query string carries the quantity and changes on every move). */
  pathname: string;
  /** Dotted path to the numeric leaf, e.g. "data.estimate.monthlyTotal". */
  path: string;
}

// A calculator response is small; a 5-level walk covers every shape observed
// without letting a huge catalog payload turn the search into a crawl.
const MAX_DEPTH = 5;
const MAX_NODES = 2_000;

/** Relative tolerance when matching a JSON leaf against the displayed total —
 * the page rounds for display ("$1,234.56" for 1234.5601). */
const MATCH_EPSILON = 0.01;

/**
 * The path to the leaf that IS the total the page displayed, in the most recent
 * response that holds it. Anchoring on the DISPLAYED number is the whole point:
 * a response carries a dozen numbers (quantity, per-unit rate, discount, annual
 * equivalent), and picking the wrong one would produce a series that passes every
 * sanity check while measuring something nobody pays.
 */
export function findPricePath(calls: CapturedJson[], displayedTotal: number): PricePath | null {
  for (let i = calls.length - 1; i >= 0; i--) {
    const call = calls[i]!;
    const path = findNumericPath(call.body, displayedTotal);
    if (path == null) continue;
    const pathname = pathnameOf(call.url);
    if (!pathname) continue;
    return { pathname, path };
  }
  return null;
}

/** Read a previously-located price out of a fresh response. */
export function readPricePath(calls: CapturedJson[], target: PricePath): number | null {
  for (let i = calls.length - 1; i >= 0; i--) {
    const call = calls[i]!;
    if (pathnameOf(call.url) !== target.pathname) continue;
    const value = readPath(call.body, target.path.split("."));
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export function pathnameOf(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function readPath(node: unknown, segments: string[]): unknown {
  let cur = node;
  for (const seg of segments) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Breadth-limited walk for the first leaf whose value matches `target`. */
function findNumericPath(node: unknown, target: number): string | null {
  let visited = 0;
  const queue: { node: unknown; path: string[]; depth: number }[] = [
    { node, path: [], depth: 0 },
  ];

  while (queue.length > 0) {
    const { node: cur, path, depth } = queue.shift()!;
    if (++visited > MAX_NODES || depth > MAX_DEPTH) continue;
    if (typeof cur === "number") {
      if (matches(cur, target)) return path.join(".");
      continue;
    }
    // A total serialised as a string ("1234.56") is still the total.
    if (typeof cur === "string") {
      const parsed = Number(cur);
      if (Number.isFinite(parsed) && matches(parsed, target)) return path.join(".");
      continue;
    }
    if (Array.isArray(cur)) {
      cur.forEach((child, i) => queue.push({ node: child, path: [...path, String(i)], depth: depth + 1 }));
      continue;
    }
    if (cur && typeof cur === "object") {
      for (const [key, child] of Object.entries(cur)) {
        queue.push({ node: child, path: [...path, key], depth: depth + 1 });
      }
    }
  }
  return null;
}

function matches(value: number, target: number): boolean {
  if (target === 0) return value === 0;
  return Math.abs(value - target) <= Math.abs(target) * MATCH_EPSILON;
}
