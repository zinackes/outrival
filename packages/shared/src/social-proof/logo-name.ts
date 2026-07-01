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

// Placeholder / CMS-export words that, PAIRED WITH AN INDEX, name a slot rather than
// a brand: "image 17", "Picture1", "logo 2", "screenshot 3", "asset-4". Distinct from
// GENERIC_TOKENS (a bare "Logo" is uninformative, not junk) — here the trailing number
// is what makes it confidently non-brand.
const PLACEHOLDER_WORD_RE =
  /^(images?|img|pictures?|photos?|logos?|logotypes?|wordmarks?|assets?|graphics?|banners?|thumbnails?|screenshots?|frames?|groups?|untitled|placeholders?|icons?|avatars?|marks?|files?|unnamed|downloads?|uploads?|copy|default|items?|slides?|elements?|rectangles?|layers?|vectors?|bitmaps?|masks?|artboards?|components?)$/i;

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
// A bare language word is NOT a customer brand, so it's dropped. Entries are
// PRE-FOLDED (ASCII, accent-stripped, lowercased) so the hot path folds the
// input ONCE and does an O(1) Set lookup — no per-entry work, no extra regex.
// Matched WHOLE-string (so "Deutsche Bank" / "Polished" survive — they extend
// the bare word, they aren't it). Endonym + English/French exonym for each, so
// a switcher showing the autonym, "French", or "Français" all resolve.
const LANGUAGE_NAMES = new Set([
  // Latin-script endonyms
  "english", "francais", "espanol", "deutsch", "italiano", "portugues", "nederlands",
  "polski", "svenska", "norsk", "dansk", "suomi", "magyar", "romana", "cestina",
  "slovencina", "slovenscina", "hrvatski", "srpski", "turkce", "catala", "galego",
  "euskara", "islenska", "gaeilge", "cymraeg", "eesti", "latviesu", "lietuviu",
  "bahasa indonesia", "bahasa melayu", "tieng viet",
  // English exonyms
  "french", "spanish", "german", "italian", "portuguese", "dutch", "polish", "swedish",
  "norwegian", "danish", "finnish", "hungarian", "romanian", "czech", "slovak", "slovenian",
  "croatian", "serbian", "turkish", "catalan", "galician", "basque", "icelandic", "irish",
  "welsh", "estonian", "latvian", "lithuanian", "indonesian", "malay", "vietnamese",
  "russian", "ukrainian", "bulgarian", "greek", "hebrew", "arabic", "persian", "farsi",
  "thai", "hindi", "chinese", "japanese", "korean",
  // French exonyms
  "anglais", "espagnol", "allemand", "italien", "portugais", "neerlandais", "polonais",
  "suedois", "norvegien", "danois", "finnois", "hongrois", "roumain", "tcheque", "slovaque",
  "slovene", "croate", "serbe", "turc", "galicien", "islandais", "irlandais", "gallois",
  "estonien", "letton", "lituanien", "indonesien", "malais", "vietnamien", "russe",
  "ukrainien", "bulgare", "grec", "hebreu", "persan", "chinois", "japonais", "coreen", "arabe",
]);

// Autonyms a multilingual switcher shows in-script. Matched by NFC-lowercase, NOT
// `fold()`: the Latin accent-folder corrupts these scripts (NFD decomposes Hangul
// 한국어 → jamo, and strips the breve that turns Cyrillic й into и). These scripts
// carry no Latin decoration for fold to target, so NFC-lowercase is exact & cheap.
const LANGUAGE_AUTONYMS_NONLATIN = new Set([
  "中文", "日本語", "한국어", "русский", "українська", "български",
  "العربية", "עברית", "ελληνικά", "ไทย", "हिन्दी", "فارسی",
]);

function isLanguageName(cleaned: string): boolean {
  // Latin path first (the common case): one fold + O(1) lookup. Only fall through
  // to the autonym set for the non-Latin scripts the folder can't normalize.
  return (
    LANGUAGE_NAMES.has(fold(cleaned)) ||
    LANGUAGE_AUTONYMS_NONLATIN.has(cleaned.normalize("NFC").toLowerCase())
  );
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

// A name whose tokens are ALL placeholder-words / bare numbers, with at least one
// index present: "image 17", "Picture1 1", "logo 2". A lone "Logo" stays
// UNINFORMATIVE (handled earlier) — it's the index that turns it into junk.
function isGenericNumbered(tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  let hasIndex = false;
  for (const tok of tokens) {
    if (/^\d+$/.test(tok)) {
      hasIndex = true;
      continue;
    }
    const glued = tok.match(/^([a-z]+)(\d+)$/i); // "Picture1", "image17"
    if (glued && PLACEHOLDER_WORD_RE.test(glued[1]!)) {
      hasIndex = true;
      continue;
    }
    if (PLACEHOLDER_WORD_RE.test(tok)) continue;
    return false; // a real word ⇒ not a generic-numbered placeholder
  }
  return hasIndex;
}

// A single token that reads as a machine-generated asset id / CMS upload hash rather
// than a brand: "aU65NHNYClf9opnN", "8BOoF08xf1E", "wp1a2b3c". A LONG token is flagged
// on strong randomness signals — digits interleaved among letters, 3+ internal case
// switches over an unpronounceable base, or a near-vowelless consonant run — none of
// which a real wordmark exhibits. Short tokens are exempt so acronyms / tickers survive
// ("PSA", "3M", "eBay", "Auth0", "H2O", "23andMe"), and CamelCase brands survive via the
// vowel-ratio guard ("BigCommerce", "OpenTable" read as pronounceable, not hashes).
function looksLikeAssetHash(token: string): boolean {
  if (token.length < 8) return false;
  const letters = token.replace(/[^a-z]/gi, "");
  if (letters.length < 2) return false; // pure-number handled by isGenericNumbered
  const vowels = (token.match(/[aeiouy]/gi) ?? []).length;
  const vowelRatio = vowels / letters.length;
  const hasDigit = /\d/.test(token);
  const interleavedDigit = /[a-z]\d+[a-z]/i.test(token); // excludes leading "3M" / trailing "s3"
  let switches = 0;
  for (let i = 1; i < token.length; i++) {
    const prev = token[i - 1]!;
    const cur = token[i]!;
    if (
      (/[a-z]/.test(prev) && /[A-Z]/.test(cur)) ||
      (/[A-Z]/.test(prev) && /[a-z]/.test(cur))
    )
      switches++;
  }
  return (
    (hasDigit && interleavedDigit && (switches >= 1 || vowelRatio < 0.34)) ||
    (switches >= 3 && vowelRatio < 0.3) ||
    (vowelRatio < 0.2 && letters.length >= 8)
  );
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

  // Machine-generated names slip past every rule above because they aren't words at
  // all: CMS upload hashes ("aU65NHNYClf9opnN bg right") and indexed placeholders
  // ("image 17", "Picture1 1"). Neither is a customer brand — drop them.
  const tokens = cleaned.split(/[\s._\-–—/|]+/).filter(Boolean);
  if (tokens.some(looksLikeAssetHash)) return { kind: "junk" };
  if (isGenericNumbered(tokens)) return { kind: "junk" };

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

// Country-flag image of a language switcher ("/flags/fr.svg", "flag-de.png",
// flagcdn). The flag asset itself has no alt, so the name classifier can't catch
// it — drop on the src side, mirroring the store-badge filter. `flag` is matched
// as a whole token so real brands ("flagship-logo.svg", "/flagstaff/…") survive.
export function isLanguageFlagSrc(src: string): boolean {
  return /(^|[/_-])flags?([/_-]|$)/i.test(src) || /\bflagcdn\.com/i.test(src);
}
