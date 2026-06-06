// Platform auto-detection (patch-31). Pure, AI-free: a Wappalyzer-format engine
// over a house dataset + ID-bearing business signatures (ATS / pricing widget /
// status page / changelog) → a cached PlatformProfile that routes each source to
// its structured connector. Subpath `@outrival/scrapers/platform` — cheerio/regex/
// dns only, never crawlee/playwright. The browser step B lives worker-side.
export {
  detectPlatform,
  detectPlatformForUrl,
  type PlatformEvidence,
  type DetectPlatformOptions,
} from "./detect";
export {
  matchFingerprints,
  type MatchInput,
  type DetectedFingerprint,
} from "./wappalyzer/engine";
export { HOUSE_TECHNOLOGIES } from "./wappalyzer/technologies";
export { CATEGORIES } from "./wappalyzer/categories";
export {
  detectBusinessSignatures,
  type SignatureInput,
  type SignatureHits,
} from "./signatures";
export { resolveCnames } from "./dns";
export type {
  TechCatalog,
  TechFingerprint,
  CategoryCatalog,
  CategoryDef,
} from "./wappalyzer/types";
