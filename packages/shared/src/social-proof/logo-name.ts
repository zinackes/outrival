/**
 * Customer-logo name classifier for the "Customers & proof" wall.
 *
 * The homepage social-proof selector is deliberately broad (any element whose
 * class carries logo/customer/trusted/brand/partner), so it sweeps up a lot that
 * is NOT a customer brand: design-tool export names ("Frame 616", "300x290"),
 * colour codes, review-platform / award badges ("Capterra Badge", "Rated 4.5/5"),
 * compliance badges ("SOC 2 certified", "GDPR Compliant"), testimonial author
 * names ("Erin Luers Abbott"), and descriptive feature phrases ("logiciel de
 * recherche"). In that list we expect actual brands — nothing else.
 *
 * This module is the single source of truth for "is this <img alt> a real brand
 * name, and if so what's the clean name". PURE string logic (no DB, no cheerio),
 * so it's used in three places:
 *   - the scraper, at capture time (drop junk before it's stored);
 *   - the social-proof diff, so junk never fires an add/remove signal;
 *   - the API, at read time, to clean already-captured snapshots without a
 *     re-scrape (the established pattern for this wall).
 *
 * Conservative by design: a single lowercase word is KEPT (many real SaaS brands
 * are lowercase — stripe, asana, airbnb), and only confidently non-brand text is
 * dropped. Person-name detection is intentionally narrow (a title prefix, or a
 * three-word Title-Case name with no org keyword) so two-word brands that read
 * like "First Last" — "Getty Images", "Robert Half", "Morgan Stanley" — are NOT
 * deleted by name alone; testimonial author avatars are instead excluded by
 * container context at capture time (see homepage-structure.ts). The residual
 * cost is a rare three-word brand with no org keyword ("Earth Based Soul").
 */

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

export type LogoNameVerdict =
  /** A real brand name, cleaned of decorative wrappers ("ramp client logo" → "ramp"). */
  | { kind: "brand"; name: string }
  /** A generic placeholder ("Logo", "Customer logo"): drop the label, lean on the image. */
  | { kind: "uninformative" }
  /** Not a customer at all (frame/colour/review/cert/person/phrase): drop the entry. */
  | { kind: "junk" };

// Bare tokens that label a slot, not a brand. After the decorative strip below,
// a name reduced to one of these carries no brand info — render the image instead.
const GENERIC_TOKENS = new Set([
  "logo", "logos", "brand", "brands", "client", "clients", "customer", "customers",
  "partner", "partners", "image", "images", "img", "icon", "icons", "photo", "photos",
  "avatar", "picture", "placeholder", "untitled", "asset", "graphic", "banner",
  "thumbnail", "mark", "wordmark", "company",
]);

// Org / institution keywords. A name carrying one of these is a company, never a
// person — they protect brands like "Sommet Education" / "Brave Browser" from the
// person-name heuristic. Lowercase; ASCII-folded comparison happens at call site.
const ORG_KEYWORDS = new Set([
  "university", "universidad", "universite", "college", "ecole", "school", "institute",
  "institut", "academy", "academie", "inc", "llc", "ltd", "limited", "corp",
  "corporation", "co", "company", "gmbh", "sa", "sas", "sarl", "bv", "ag", "plc",
  "group", "groupe", "holdings", "holding", "technologies", "technology", "tech",
  "labs", "lab", "software", "systems", "system", "solutions", "solution", "media",
  "bank", "banque", "capital", "ventures", "partners", "consulting", "browser",
  "education", "foundation", "fondation", "hospital", "health", "clinic", "agency",
  "studio", "studios", "digital", "global", "international", "services", "service",
  "network", "networks", "cloud", "security", "energy", "motors", "airlines", "hotels",
  "hotel", "city", "county", "state", "department", "ministry", "association", "council",
  "museum", "library", "church", "communications", "industries", "enterprises", "ai",
  "io", "app", "hq",
]);

// Function words that mark a descriptive phrase rather than a brand wordmark.
const FUNCTION_WORDS = new Set([
  "de", "des", "du", "la", "le", "les", "un", "une", "et", "ou", "a", "au", "aux", "pour",
  "avec", "sur", "the", "and", "or", "for", "with", "your", "our", "to", "of", "in", "on",
  "an",
]);

const PERSON_TITLE_RE = /^(dr|mr|mrs|ms|prof|miss|sir|mme|m)\.\s/i;

// Design-tool export / generic shape names: "Frame 616", "Group 12", "Rectangle",
// "Vector", "Mask group", "Layer 1". Anchored so it doesn't eat real brands.
const DESIGN_EXPORT_RE =
  /^(frame|group|rectangle|ellipse|oval|vector|mask\s*group|layer|artboard|component|union|subtract|clip\s*path|polygon|bitmap)\b[\s\-_]*\d*$/i;

// Pixel dimensions anywhere: "300x290", "120 x 48".
const DIMENSION_RE = /\b\d{2,4}\s*[x×]\s*\d{2,4}\b/i;

// Colour codes: #hex (3-8), or bare 6/8 hex that contains a digit (so a word made
// only of hex letters — "Deeded", "Face" — is not mistaken for a colour), or a
// CSS colour function.
const HEX_HASH_RE = /^#[0-9a-f]{3,8}$/i;
const HEX_BARE_RE = /^(?=[0-9a-f]*\d)[0-9a-f]{6}([0-9a-f]{2})?$/i;
const FUNC_COLOR_RE = /^(rgb|rgba|hsl|hsla)\([^)]*\)$/i;

// Review platforms / directories — proof, but not customers (dropped from the wall).
const REVIEW_PLATFORM_RE =
  /\b(capterra|g2|g2crowd|getapp|appvizer|trustpilot|trustradius|gartner|crozdesk|sourceforge|producthunt|product\s*hunt|saasworthy|financesonline|softwareadvice|software\s*advice|slashdot|featuredcustomers|featured\s*customers)\b/i;

// Rating / award copy that rides on those badges.
const RATING_COPY_RE =
  /(\b\d(\.\d)?\s*\/\s*5\b|\bout of \d\b|\b\d(\.\d)?\s*stars?\b|\brated\b|\b\d+\+?\s*reviews?\b|\bhigh performer\b|\bmomentum leader\b|\bleader\b|\btop rated\b|\busers love us\b|\beasiest to use\b|\bbest (of|relationship|usability|results|support|roi)\b|\bfastest implementation\b)/i;

// Compliance / certification badges.
const CERTIFICATION_RE =
  /\b(iso\s?\d{4,5}|soc\s?[12]|hipaa|hippa|gdpr|ccpa|pci(?:[-\s]?dss)?|ferpa|fedramp|sox|nist|csa\s?star|cyber\s?essentials)\b|\b(compliant|certified|certification|accredited)\b/i;

// Language names — a language switcher's flag <img> carries the language as its
// alt ("Français", "English", "Italiano"), and the broad social-proof selector
// sweeps those in alongside real customer logos (acutely on non-English sites).
// A bare language word is NOT a customer brand, so it's dropped. Endonyms +
// French and English exonyms, ASCII-folded & lowercased; matched WHOLE-string
// (so "Deutsche Bank" / "English Tea Shop" survive — they aren't the bare word).
const LANGUAGE_NAMES = new Set([
  // endonyms
  "english", "francais", "espanol", "deutsch", "italiano", "portugues", "nederlands",
  "polski", "svenska", "norsk", "dansk", "suomi", "magyar", "romana", "cestina", "turkce",
  "catala", "galego", "euskara",
  // French exonyms
  "anglais", "espagnol", "allemand", "italien", "portugais", "neerlandais",
  "polonais", "suedois", "norvegien", "danois", "finnois", "hongrois", "roumain", "tcheque",
  "turc", "russe", "chinois", "japonais", "coreen", "arabe", "grec",
  // English exonyms
  "french", "spanish", "german", "italian", "portuguese", "dutch", "polish", "swedish",
  "norwegian", "danish", "finnish", "hungarian", "romanian", "czech", "turkish", "russian",
  "chinese", "japanese", "korean", "arabic", "greek",
  // common non-latin endonyms left verbatim (fold is a no-op on these)
  "中文", "日本語", "한국어", "русский", "العربية",
]);

function isLanguageName(cleaned: string): boolean {
  return LANGUAGE_NAMES.has(fold(cleaned));
}

// Strip decorative wrappers to recover the brand: "ramp client logo" → "ramp",
// "Capterra Badge" → "Capterra", "Logo: Acme" → "Acme", "Acme (2)" → "Acme".
function stripDecoration(t: string): string {
  let out = t;
  out = out.replace(
    /[\s\-|·,]*\b(client|company|corporate|official|partner|customer|brand|nav|header|footer)?\s*(logo|logotype|wordmark|badge|icon|mark|image|img|photo|avatar)\s*$/i,
    "",
  );
  out = out.replace(/^\s*(logo|icon|image|img)\s*[:\-]\s*/i, "");
  out = out.replace(/\s*\(\s*\d+\s*\)\s*$/i, "");
  return norm(out);
}

// Accent-fold for keyword comparison ("universite" with accents -> "universite").
// Strips Unicode combining marks (U+0300..U+036F) without a literal-mark regex.
function fold(w: string): string {
  return [...w.normalize("NFD")]
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code < 0x0300 || code > 0x036f;
    })
    .join("")
    .toLowerCase();
}

function isColorCode(t: string): boolean {
  return HEX_HASH_RE.test(t) || HEX_BARE_RE.test(t) || FUNC_COLOR_RE.test(t);
}

function looksLikePersonName(t: string): boolean {
  if (PERSON_TITLE_RE.test(t)) return true;
  const tokens = t.split(/\s+/);
  // Exactly three name tokens ("Erin Luers Abbott"). Two-word Title Case is far
  // too brand-ambiguous to drop ("Getty Images", "Robert Half", "Morgan Stanley"
  // all read as First Last) — those are left to the extraction-time context
  // exclusion (testimonial/avatar containers), not deleted by name alone.
  if (tokens.length !== 3) return false;
  // Each token an initial-cap word with a lowercase tail — excludes ALL-CAPS
  // acronyms and mixed-case brands (BigCommerce), digits, and punctuation.
  const isNameToken = (w: string): boolean => /^[A-ZÀ-Þ][a-zß-ÿ'’-]+$/.test(w);
  if (!tokens.every(isNameToken)) return false;
  if (tokens.some((w) => ORG_KEYWORDS.has(fold(w)))) return false;
  return true;
}

function looksLikeDescriptivePhrase(t: string): boolean {
  const tokens = t.split(/\s+/);
  if (tokens.length < 3) return false; // single / double words can be brands
  const hasFn = tokens.some((w) => FUNCTION_WORDS.has(fold(w)));
  const noCaps = !/[A-ZÀ-Þ]/.test(t);
  return hasFn && noCaps; // a lowercase 3+ word run with a function word reads as prose
}

/**
 * Classify an `<img alt>` for the customer wall. `null`/empty → uninformative
 * (the entry may still carry a renderable image).
 */
export function classifyLogoName(raw: string | null | undefined): LogoNameVerdict {
  const cleaned = stripDecoration(norm(raw ?? ""));
  if (!cleaned) return { kind: "uninformative" };
  if (GENERIC_TOKENS.has(cleaned.toLowerCase())) return { kind: "uninformative" };

  if (DESIGN_EXPORT_RE.test(cleaned)) return { kind: "junk" };
  if (DIMENSION_RE.test(cleaned)) return { kind: "junk" };
  if (isColorCode(cleaned)) return { kind: "junk" };
  if (REVIEW_PLATFORM_RE.test(cleaned)) return { kind: "junk" };
  if (RATING_COPY_RE.test(cleaned)) return { kind: "junk" };
  if (CERTIFICATION_RE.test(cleaned)) return { kind: "junk" };
  if (isLanguageName(cleaned)) return { kind: "junk" };
  if (looksLikePersonName(cleaned)) return { kind: "junk" };
  if (looksLikeDescriptivePhrase(cleaned)) return { kind: "junk" };
  if (cleaned.length > 60) return { kind: "junk" }; // a sentence, not a wordmark

  return { kind: "brand", name: cleaned };
}

/** True when the name is confidently NOT a customer brand (the `junk` verdict). */
export function isJunkLogoName(raw: string | null | undefined): boolean {
  return classifyLogoName(raw).kind === "junk";
}

// --- Image source (src) junk, shared by the scraper and the API read path ---

// A data:image/svg+xml URI with no drawable element (just an empty <svg/>): a
// lazy-load spacer that renders blank.
export function isBlankSvgDataUri(src: string): boolean {
  if (!/^data:image\/svg\+xml/i.test(src)) return false;
  if (src.length > 400) return false;
  // Check only the SVG payload (after the comma) — the "data:image/svg+xml"
  // prefix itself contains "image". Decoded or percent-encoded, a real icon
  // mentions one of these drawable tags; a spacer doesn't.
  const payload = src.slice(src.indexOf(",") + 1);
  return !/(path|rect|circle|ellipse|image|text|polygon|polyline|%3Cg|<g)/i.test(payload);
}

// App-store / Play-store download badges — store proof, not a customer brand.
export function isStoreBadgeSrc(src: string): boolean {
  return /(apple|app)[-_]?store|play[-_]?store|google[-_]?play|download[-_]?on|get[-_]?it[-_]?on/i.test(
    src,
  );
}
