const MULTI_PART_TLDS = new Set([
  "co.uk",
  "co.jp",
  "co.kr",
  "co.nz",
  "co.za",
  "co.in",
  "co.id",
  "com.au",
  "com.br",
  "com.mx",
  "com.sg",
  "com.tr",
  "com.cn",
  "com.tw",
  "com.hk",
  "com.ar",
  "com.co",
  "org.uk",
  "gov.uk",
  "ac.uk",
  "ne.jp",
  "or.jp",
]);

export function extractHostname(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    const u = input.includes("://") ? new URL(input) : new URL(`https://${input}`);
    return u.hostname.toLowerCase().replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

export function normalizeHostname(input: string | null | undefined): string | null {
  const h = extractHostname(input);
  if (!h) return null;
  const parts = h.split(".").filter(Boolean);
  if (parts.length < 2) return h;
  const lastTwo = parts.slice(-2).join(".");
  if (parts.length >= 3 && MULTI_PART_TLDS.has(lastTwo)) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

/**
 * Bare host for keying per-domain resources, lowercased with `www.` stripped so
 * www/non-www share one entry (patch-30 parser-extractor cache). Keeps the full
 * host below that — `sub.domain.com` stays distinct from `domain.com`, because a
 * subdomain can ship a different layout. Null on an unparseable input.
 */
export function normalizeDomain(input: string | null | undefined): string | null {
  const h = extractHostname(input);
  if (!h) return null;
  return h.startsWith("www.") ? h.slice(4) : h;
}

/**
 * Registrable brand label, TLD-stripped — `amazon` for amazon.com, amazon.fr,
 * www.amazon.de or amazon.co.uk. Used to detect the same company across TLDs.
 */
export function extractBrand(input: string | null | undefined): string | null {
  const host = normalizeHostname(input);
  if (!host) return null;
  const label = host.split(".")[0];
  return label && label.length > 0 ? label : null;
}

/** Upper bound on a competitor's display name (create + edit + derivation). */
export const COMPETITOR_NAME_MAX_LENGTH = 60;

// Separators a page title uses between the brand and its tagline: " | ", " - ",
// " – ", " — ", " · ", " • " and the "Brand: tagline" form.
const TITLE_SEPARATOR = /\s+[|·•–—]\s+|\s+-\s+|:\s+/;

const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

function truncateOnWord(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Display name for a tracked company, derived from its page title.
 *
 * A <title> is a marketing sentence, not a company name ("Postiz: The All-in-One
 * agentic social media scheduling tool"), and storing it verbatim made the
 * competitor header render a whole tagline. The brand sits on one side of the
 * title's separator, so the segment matching the registrable domain wins
 * whichever side that is; with no match the first segment does, since titles lead
 * with the brand far more often than they trail with it. A kept segment that is
 * still a sentence loses to the domain label, which is a name rather than a
 * chopped phrase.
 */
export function deriveCompetitorName(url: string, title: string | null | undefined): string {
  const brand = extractBrand(url);
  const fallback = normalizeDomain(url) ?? url.trim();
  const segments = (title ?? "")
    .replace(/\s+/g, " ")
    .split(TITLE_SEPARATOR)
    .map((s) => s.trim())
    .filter(Boolean);

  const first = segments[0];
  if (!first) return truncateOnWord(fallback, COMPETITOR_NAME_MAX_LENGTH);

  const brandKey = brand ? squash(brand) : null;
  const picked = (brandKey ? segments.find((s) => squash(s) === brandKey) : undefined) ?? first;
  if (picked.length <= COMPETITOR_NAME_MAX_LENGTH) return picked;
  if (brand) return brand.charAt(0).toUpperCase() + brand.slice(1);
  return truncateOnWord(picked, COMPETITOR_NAME_MAX_LENGTH);
}

const TEMPORARY_HOSTS = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  ".vercel.app", // previews (a custom domain would not end with this)
  ".netlify.app",
  ".ngrok.io",
  ".ngrok-free.app",
  ".replit.dev",
];

/**
 * Heuristic: does this URL look like a preview/local deploy rather than a real
 * product site? Used in onboarding "live" mode as a non-blocking WARNING only —
 * the user can still proceed or switch to the "developing" (repo) mode.
 */
export function detectTemporaryUrl(url: string): { temporary: boolean; reason?: string } {
  try {
    const u = new URL(url);
    if (TEMPORARY_HOSTS.some((h) => u.hostname.endsWith(h) || u.hostname === h)) {
      return { temporary: true, reason: "This URL looks temporary (a preview or local deploy)" };
    }
    return { temporary: false };
  } catch {
    return { temporary: false };
  }
}
