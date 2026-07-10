// Standing queries — pure helpers shared by the API (creation-time entity
// extraction, baseline) and the workers (re-evaluation). Change detection never
// diffs answer text: it compares the normalized SET of cited signal ids.

/** Dedupe + sort, so two answers citing the same signals compare equal. */
export function normalizeSignalIdSet(ids: string[]): string[] {
  return [...new Set(ids)].sort();
}

export function signalSetsEqual(a: string[], b: string[]): boolean {
  const na = normalizeSignalIdSet(a);
  const nb = normalizeSignalIdSet(b);
  return na.length === nb.length && na.every((id, i) => id === nb[i]);
}

/**
 * Stable fingerprint of a normalized signal-id set (FNV-1a 32-bit, hex). Stored
 * alongside the ids for at-a-glance comparison/debugging; equality DECISIONS always
 * use signalSetsEqual on the full arrays, so hash collisions can't mask a change.
 */
export function hashSignalIdSet(ids: string[]): string {
  const input = normalizeSignalIdSet(ids).join(",");
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// Signal categories a question can mention (mirrors the signals.category enum).
const CATEGORY_KEYWORDS: Array<{ category: string; pattern: RegExp }> = [
  { category: "pricing", pattern: /\bpric(?:e|es|ing)\b|\bcosts?\b|\btiers?\b/i },
  { category: "hiring", pattern: /\bhir(?:e|es|ing)\b|\bjobs?\b|\brecruit|\bheadcount\b/i },
  { category: "reviews", pattern: /\breviews?\b|\bratings?\b|\bg2\b|\bcapterra\b/i },
  { category: "funding", pattern: /\bfunding\b|\bseries [a-e]\b|\binvestment\b|\bvaluation\b/i },
  { category: "product", pattern: /\bfeatures?\b|\blaunch(?:es|ed)?\b|\broadmap\b|\bchangelog\b/i },
  { category: "content", pattern: /\bblog\b|\bcontent\b|\barticles?\b/i },
];

/**
 * Deterministic category extraction from the question wording (no AI). Used once at
 * creation to focus the re-evaluation trigger; empty result = wildcard (any category).
 */
export function extractQuestionCategories(question: string): string[] {
  return CATEGORY_KEYWORDS.filter(({ pattern }) => pattern.test(question)).map(
    ({ category }) => category,
  );
}
