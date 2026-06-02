// Tech-stack detection (patch-18). Independent of the homepage pipeline:
// catalog + pure detector + native-fetch scraper. Subpath export
// `@outrival/scrapers/tech-stack` — cheerio only, never crawlee/playwright.
export {
  TECH_CATALOG,
  type TechCategory,
  type ImportanceLevel,
  type TechSignature,
  type HeaderMatcher,
} from "./catalog";
export {
  detectTechStack,
  type DetectedTech,
  type TechStackInput,
} from "./detector";
export {
  fetchTechStackEvidence,
  extractScriptUrls,
  type TechStackEvidence,
} from "./scraper";
