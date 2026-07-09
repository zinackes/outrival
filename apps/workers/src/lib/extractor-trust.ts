// Cached-extractor trust decision (extracted from staged-extract.ts so it can be
// tested).
//
// R8: a cached deterministic parser was trusted FOREVER as long as its replay
// produced a schema-valid, "plausible" result — but plausibility is a weak gate
// (jobs: `length > 0`; pricing: `some price > 0`). A drifted selector that now
// grabs a struck-through "was $X", or nav/blog rows that look like job titles,
// passes it and is never healed: `stageOk` succeeds, consecutiveFailures resets,
// and self-heal never fires. Nothing ever re-checked the spec against reality.
//
// So a cached spec now EXPIRES. Past `revalidateMs` since it was last generated
// against fresh HTML, the cache is skipped and the ladder falls through to
// self-heal, which regenerates the selectors from the CURRENT DOM — drift is
// corrected by construction, no output comparison needed. A spec that has failed
// its replay `maxFailures` times in a row is distrusted immediately.
//
// This redefines `parser_extractors.last_validated_at`: it is stamped only when a
// spec is (re)generated and validated against fresh HTML (`upsertExtractor`), no
// longer on every cache hit — otherwise it could never age and the expiry above
// would never fire. Nothing else in the codebase reads that column.

export interface ExtractorTrustInput {
  /** When the spec was last generated + validated against fresh HTML. */
  lastValidatedAt: Date | null;
  /** Replays that failed the schema/plausibility gate since the last success. */
  consecutiveFailures: number;
  /** Epoch ms. */
  now: number;
  /** Max age of a spec before it must be regenerated. */
  revalidateMs: number;
  /** Consecutive replay failures after which the spec is distrusted outright. */
  maxFailures: number;
}

export function shouldTrustCachedExtractor(input: ExtractorTrustInput): boolean {
  if (input.consecutiveFailures >= input.maxFailures) return false;
  // Never validated against fresh HTML (unknown provenance) → regenerate.
  if (input.lastValidatedAt == null) return false;
  return input.now - input.lastValidatedAt.getTime() < input.revalidateMs;
}
