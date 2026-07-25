/**
 * "In their words" reads the newest review verbatims, and every extraction run
 * writes that page's top praises and complaints again. The same review page yields
 * the same phrases run after run, so the list repeated itself instead of simply
 * running short — and a single run can emit two phrasings of one point
 * ("Web-based access" next to "Web-based access on the go"), which no exact
 * comparison catches either.
 *
 * Keep the first (newest) phrasing of a point and drop later restatements of it:
 * same normalized text, or one phrase wholly containing the other. Containment
 * only counts from three words up, so "Support" can't swallow "Support is slow".
 */

const MIN_CONTAINMENT_WORDS = 3;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function wordCount(normalized: string): number {
  return normalized === "" ? 0 : normalized.split(" ").length;
}

/** Whether `inner` restates `outer` — contained on word boundaries, long enough to mean it. */
function restates(outer: string, inner: string): boolean {
  if (wordCount(inner) < MIN_CONTAINMENT_WORDS) return false;
  return ` ${outer} `.includes(` ${inner} `);
}

/**
 * Up to `limit` distinct verbatims, later restatements dropped, input order kept.
 * `reviews.content` is nullable, and a null used to reach the client as a blank
 * bullet — an empty row is dropped here rather than rendered.
 */
export function dedupeVerbatims(
  contents: Array<string | null | undefined>,
  limit: number,
): string[] {
  const kept: string[] = [];
  const keptNormalized: string[] = [];
  for (const content of contents) {
    if (kept.length >= limit) break;
    if (!content) continue;
    const norm = normalize(content);
    if (norm === "") continue;
    const alreadySaid = keptNormalized.some(
      (k) => k === norm || restates(k, norm) || restates(norm, k),
    );
    if (alreadySaid) continue;
    kept.push(content);
    keptNormalized.push(norm);
  }
  return kept;
}
