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
  // Bare "Jobs" / "Hiring" / "Vacancies" nav or footer labels — common, and not
  // covered by the phrase patterns above. E.g. CardNexus links its Notion job
  // board with just "Jobs", which otherwise scores 0 and is never followed.
  /\bjobs?\b/i,
  /\bhiring\b/i,
  /\bvacanc(?:y|ies)\b/i,
];

// A careers page is very often a HUB (culture, teams, benefits, early careers)
// whose actual roles live one level deeper, behind a "Browse jobs" link
// (atlassian.com/company/careers → /company/careers/all-jobs). These patterns mark
// a link that advertises the LISTING itself, which is what lets the scraper tell a
// hop worth taking from a hub apart from a lateral wander through careers
// marketing. Ranked above the generic signals below so the listing link wins over
// the page's own "Careers" nav entry.
const LISTING_TEXT_SIGNALS: RegExp[] = [
  // "Browse jobs", "View all jobs", "See our open roles", "Search openings", …
  // The noun must be PLURAL, or introduced by "all". A SINGULAR one names ONE
  // posting, not the board: clickup.com/careers prints "Explore the role" under
  // each of its two featured openings, that CTA outscored every other link on the
  // page, and the scraper hopped to a single role's page — so a 64-role Ashby
  // board was read as the two roles the marketing page happens to hard-code.
  /\ball\b[^.]{0,20}\b(jobs?|roles?|positions?|openings?|vacanc(?:y|ies))\b/i,
  /\b(browse|view|see|explore|search|find)\b[^.]{0,20}\b(jobs|roles|positions|openings|vacancies)\b/i,
  /\b(open|current|available)\s+(jobs?|roles?|positions?|openings?|vacanc(?:y|ies))\b/i,
  /\bjob\s+(search|board|openings?|listings?)\b/i,
  // FR
  /\b(toutes\s+)?nos\s+offres\b/i,
  /\boffres?\s+d['’]emploi\b/i,
  /\bpostes?\s+(ouverts?|à\s+pourvoir|disponibles?)\b/i,
];

// Same idea on `host + path`, for a listing link whose label is an icon or a bare
// arrow. Weaker than a listing TEXT match, stronger than a generic careers link.
const LISTING_HREF_SIGNALS = [
  "all-jobs",
  "alljobs",
  "all-openings",
  "open-positions",
  "open-roles",
  "job-search",
  "jobsearch",
  "jobs/search",
  "search-jobs",
  "job-openings",
  "current-openings",
  "job-board",
  "/openings",
  "/vacancies",
  "/positions",
  "nos-offres",
  "offres-emploi",
];

// A hub's own listing frequently sits at the SAME path plus one segment: an Oracle
// CandidateExperience site serves culture copy at `<…>/sites/CX_1` and keeps the
// roles on `<…>/sites/CX_1/jobs`. Neither the label ("Jobs") nor a bare `/jobs`
// substring makes that link listing-grade on its own — both fire on any nav entry
// anywhere on the site, so both stay generic careers signals. DRILLING DOWN from the
// page we're standing on is the part that carries information: the target can only
// be deeper inside the section we already accepted as careers, never a lateral
// wander into "Life at Acme".
const DEEPER_LISTING_SEGMENT =
  /^(jobs|all-jobs|alljobs|job-search|jobsearch|jobs-search|openings|open-positions|open-roles|positions|roles|vacancies|requisitions|offres|offres-emploi|emplois|postes)$/i;

/**
 * `base` plus exactly ONE more path segment, same host, that segment naming a
 * listing. One segment only: `/careers/job/12345-engineer` is a single posting, and
 * reading one posting as the board is the exact failure LISTING_TEXT_SIGNALS already
 * guards against.
 */
function isDeeperListingPath(link: URL, base: URL): boolean {
  if (link.hostname.toLowerCase() !== base.hostname.toLowerCase()) return false;
  const from = base.pathname.replace(/\/+$/, "").toLowerCase();
  // From the site ROOT every first-level path is "deeper", which would promote links
  // the scraper's own path discovery already covers (`/jobs`, `/careers`) and let a
  // homepage nav entry outrank a real off-site board. This rule is for a hub that
  // sits at a path of its own.
  if (from === "") return false;
  const to = link.pathname.replace(/\/+$/, "").toLowerCase();
  if (!to.startsWith(`${from}/`)) return false;
  const rest = to.slice(from.length + 1);
  return !rest.includes("/") && DEEPER_LISTING_SEGMENT.test(rest);
}

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
  // "/open-positions", "/positions", and Notion boards titled
  // "Open-Positions-at-<Company>" all carry "position" in the path.
  "position",
  "vacanc",
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

/**
 * Same page ignoring hash/query/trailing-slash. Hopping there would just re-fetch
 * what we already have (e.g. the page is `/about-us` and the discovered careers
 * link is `/about-us#careers`).
 */
export function isSameResource(a: string, b: string): boolean {
  try {
    const norm = (u: string) => {
      const url = new URL(u);
      return `${url.hostname}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
    };
    return norm(a) === norm(b);
  } catch {
    return false;
  }
}

interface Candidate {
  url: string;
  score: number;
  /** The link advertises a job LISTING, not merely a careers entry point. */
  listing: boolean;
}

function rankCareersLinks(html: string, baseUrl: string): Candidate[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }

  const $ = cheerio.load(html);
  const candidates: Candidate[] = [];

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
    // A link back to the page we're ranking from is never a hop worth taking, and
    // letting it compete would let a self-referential "Careers" nav entry outrank
    // the real "Browse jobs" link next to it.
    if (isSameResource(abs.toString(), base.toString())) return;

    const label = `${$(el).text()} ${$(el).attr("aria-label") ?? ""} ${$(el).attr("title") ?? ""}`
      .replace(/\s+/g, " ")
      .trim();
    const haystack = `${abs.hostname}${abs.pathname}`.toLowerCase();

    let score = 0;
    let listing = false;
    if (LISTING_TEXT_SIGNALS.some((re) => re.test(label))) {
      score = 3;
      listing = true;
    } else if (
      LISTING_HREF_SIGNALS.some((h) => haystack.includes(h)) ||
      isDeeperListingPath(abs, base)
    ) {
      score = 2.5;
      listing = true;
    } else if (TEXT_SIGNALS.some((re) => re.test(label))) score = 2;
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

    candidates.push({ url: abs.toString(), score, listing });
  });

  return candidates;
}

function best(candidates: Candidate[]): string | null {
  if (candidates.length === 0) return null;
  // Highest score wins; ties keep the earliest (document order).
  return candidates.reduce((a, b) => (b.score > a.score ? b : a)).url;
}

export function findCareersLink(html: string, baseUrl: string): string | null {
  return best(rankCareersLinks(html, baseUrl));
}

/**
 * The strongest link that advertises an actual job LISTING (not just a careers
 * entry point). Null when the page only links careers marketing. Lets the scraper
 * leave a careers HUB for the page that carries the roles, without wandering
 * sideways into "Life at Acme".
 */
export function findJobListingLink(html: string, baseUrl: string): string | null {
  return best(rankCareersLinks(html, baseUrl).filter((c) => c.listing));
}
