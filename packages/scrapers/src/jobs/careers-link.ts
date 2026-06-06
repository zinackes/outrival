import * as cheerio from "cheerio";

/**
 * Discover an off-site careers link inside a scraped page (patch-33).
 *
 * The jobs scraper already (a) guesses standard same-host paths (`/careers`,
 * `/jobs`, …) and (b) detects known ATS boards (Greenhouse, Lever, …) embedded
 * in the HTML. Neither covers a competitor — common in France — that hosts its
 * openings on a *custom, external* careers site linked from the nav or footer
 * ("Nous rejoindre" → `recrutement.example.fr`) with no recognised ATS.
 *
 * This finds the strongest careers link on the page, resolves it to an absolute
 * URL (cross-host allowed), and returns it so the scraper can follow one hop and
 * let the downstream LLM extract the listing. Pure parsing, no AI, no network.
 */

// Strong signal — matched against the link TEXT (FR + EN). A careers entry point
// almost always labels itself with one of these.
const TEXT_SIGNALS: RegExp[] = [
  /\bnous\s*rejoindre\b/i,
  /\brejoign(ez|ons)[\s-]*nous\b/i,
  /\bon\s*recrute\b/i,
  /\brecrutement\b/i,
  /\bcarri[èe]res?\b/i,
  /\bnos\s*offres\b/i,
  /\bcareers?\b/i,
  /\bjoin\s*(us|our\s*team)\b/i,
  /\bwe['’`]?re\s*hiring\b/i,
  /\bopen\s*(roles|positions|jobs)\b/i,
  /\bwork\s*with\s*us\b/i,
];

// Weaker signal — matched against `host + path` (an icon/image link with no text
// still counts). Kept separate so a text match always outranks an href match.
const HREF_SIGNALS = [
  "careers",
  "carriere",
  "carrieres",
  "recrutement",
  "nous-rejoindre",
  "rejoignez",
  "join-us",
  "join_us",
  "we-are-hiring",
  "work-with-us",
  "/jobs",
  "/emploi",
  "/hiring",
  "/career",
];

// A careers-dedicated subdomain is itself a signal (`jobs.acme.com`).
const HOST_PREFIXES = [
  "careers.",
  "career.",
  "jobs.",
  "job.",
  "recrutement.",
  "emploi.",
  "carriere.",
  "carrieres.",
];

// Hosts we can't usefully scrape a listing from. A "careers" link into a social
// network is a dead end; a known ATS is already handled by `detectAtsBoard`.
const SKIP_HOSTS = [
  "linkedin.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "youtube.com",
  "t.me",
];

/** Reject non-followable targets: wrong scheme, embedded creds, private hosts. */
function isFollowable(u: URL): boolean {
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (host === "0.0.0.0" || host === "::1" || host === "[::1]") return false;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return false;
  if (/^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (SKIP_HOSTS.some((s) => host === s || host.endsWith(`.${s}`))) return false;
  return true;
}

export function findCareersLink(html: string, baseUrl: string): string | null {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return null;
  }

  const $ = cheerio.load(html);
  const candidates: { url: string; score: number }[] = [];

  $("a[href]").each((_i, el) => {
    const raw = ($(el).attr("href") ?? "").trim();
    if (!raw || raw.startsWith("#") || /^(mailto:|tel:|javascript:)/i.test(raw)) return;

    let abs: URL;
    try {
      abs = new URL(raw, base);
    } catch {
      return;
    }
    if (!isFollowable(abs)) return;

    const label = `${$(el).text()} ${$(el).attr("aria-label") ?? ""} ${$(el).attr("title") ?? ""}`
      .replace(/\s+/g, " ")
      .trim();
    const haystack = `${abs.hostname}${abs.pathname}`.toLowerCase();

    let score = 0;
    if (TEXT_SIGNALS.some((re) => re.test(label))) score = 2;
    else if (
      HREF_SIGNALS.some((h) => haystack.includes(h)) ||
      HOST_PREFIXES.some((p) => abs.hostname.toLowerCase().startsWith(p))
    ) {
      score = 1;
    }
    if (score === 0) return;

    // Prefer an off-site careers link — same-host paths are already covered by
    // the scraper's path discovery, so a cross-host hit is the one worth following.
    if (abs.hostname.toLowerCase() !== base.hostname.toLowerCase()) score += 0.5;

    candidates.push({ url: abs.toString(), score });
  });

  if (candidates.length === 0) return null;
  // Highest score wins; ties keep the earliest (document order).
  return candidates.reduce((a, b) => (b.score > a.score ? b : a)).url;
}
