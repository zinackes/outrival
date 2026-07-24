import { extractBrand, normalizeHostname } from "./url";
import { isReviewSource, validateReviewUrl } from "./reviews";
import type { SourceType } from "./constants/sources";

/**
 * Page-type hint for a custom monitor (config.hint). Grounds the classifier
 * ("this page is the competitor's {hint} page") so a diff on an /about, ToS,
 * /security or /enterprise page is weighed correctly. Kept small on purpose —
 * finer typing lives in the diff text, not the taxonomy.
 */
export const CUSTOM_MONITOR_HINTS = ["legal", "team", "product", "security", "docs", "other"] as const;
export type CustomMonitorHint = (typeof CUSTOM_MONITOR_HINTS)[number];

/**
 * Registrable brands of third-party ATS / job boards where a competitor
 * legitimately hosts its careers page off its own domain. Only consulted for
 * the `jobs` source — every other source must stay on the competitor's domain.
 */
const ATS_BRANDS = new Set([
  "greenhouse", // boards.greenhouse.io
  "lever", // jobs.lever.co
  "ashbyhq", // jobs.ashbyhq.com
  "workable", // apply.workable.com
  "recruitee",
  "smartrecruiters",
  "bamboohr",
  "teamtailor",
  "personio",
  "workday", // myworkdayjobs.com
]);

/**
 * Registrable brands of the roadmap/feedback portal vendors. A competitor's public
 * roadmap legitimately lives off their own domain (`acme.canny.io`,
 * `portal.productboard.com/pb/acme`) — the same off-domain exception the ATS hosts
 * get for `jobs`, and just as SSRF-safe (a fixed, public host list). A portal on the
 * competitor's OWN domain (feedback.acme.com, a Canny custom domain) still passes
 * through the normal same-brand check.
 */
const ROADMAP_BRANDS = new Set([
  "canny", // {brand}.canny.io
  "productboard", // portal.productboard.com/{path}
]);

/**
 * Vendor hosts serving a competitor's status page (`acme.statuspage.io`,
 * `acme.instatus.com`). Deliberately EXACTLY the two the scraper can read — it
 * fetches Statuspage's `/api/v2/summary.json` or Instatus's `/summary.json` and
 * nothing else. Listing more vendors would let the user turn on a source that then
 * fails every run, which is the same dead end this exception exists to remove.
 */
const STATUS_BRANDS = new Set(["statuspage", "instatus"]);

/**
 * The `<brand>status.com` / `<brand>-status.com` convention: githubstatus.com,
 * vercel-status.com. These are the competitor's own status page on a sibling
 * domain, which `extractBrand` reads as a different brand entirely (`vercel-status`
 * is not `vercel`), so the plain same-brand check rejects them.
 *
 * Anchored on purpose. A `startsWith` test would accept `vercelstatus-phish.com`,
 * and a generic "hyphen token contains the brand" rule would accept any
 * `acme-anything.com` — this matches the convention and nothing else.
 */
function isStatusSibling(urlBrand: string, competitorBrand: string | null): boolean {
  if (!competitorBrand) return false;
  if (!urlBrand.endsWith("status")) return false;
  const prefix = urlBrand.slice(0, -"status".length);
  return (
    prefix === competitorBrand ||
    prefix === `${competitorBrand}-` ||
    prefix === `${competitorBrand}_`
  );
}

export type MonitorUrlValidation =
  | { ok: true; url: string }
  | { ok: false; error: string };

/** Reject IP-literal hosts (IPv4 or IPv6) — defense-in-depth against SSRF. */
function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

/**
 * Hostnames that are never a real external product site and must never be
 * fetched server-side (SSRF). Syntactic check only — no DNS resolution, in line
 * with the rest of this module's defense.
 */
function isUnsafeHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (!h.includes(".")) return true; // single-label intranet name (redis, db, …)
  return false;
}

/**
 * SSRF guard for a user-supplied URL the scraper will fetch directly as the
 * competitor's own site (create / edit), where there's no reference brand to
 * lock against — unlike {@link validateMonitorUrl}. Syntactic checks only:
 * http(s), no credentials, standard port, no IP literal, no internal host.
 */
export function validatePublicUrl(raw: string): MonitorUrlValidation {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "must_be_http" };
  }
  if (parsed.username || parsed.password) return { ok: false, error: "credentials_not_allowed" };
  if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
    return { ok: false, error: "port_not_allowed" };
  }
  if (isIpLiteral(parsed.hostname)) return { ok: false, error: "host_not_allowed" };
  if (isUnsafeHost(parsed.hostname)) return { ok: false, error: "host_not_allowed" };
  return { ok: true, url: parsed.toString() };
}

/**
 * Validate a user-supplied monitor URL. Review sources delegate to the
 * brand-locked {@link validateReviewUrl}. Every other source must resolve to
 * the competitor's own registrable domain — `jobs` may additionally point at a
 * known ATS host. The brand match is itself the SSRF guard: an internal host
 * (localhost, 10.x, metadata) never shares a brand with a real product domain,
 * and IP literals are rejected outright.
 */
export function validateMonitorUrl(
  sourceType: SourceType,
  raw: string,
  competitorUrl: string | null,
): MonitorUrlValidation {
  if (isReviewSource(sourceType)) {
    return validateReviewUrl(sourceType, raw);
  }

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (parsed.protocol !== "https:") return { ok: false, error: "must_be_https" };
  if (parsed.username || parsed.password) return { ok: false, error: "credentials_not_allowed" };
  if (parsed.port && parsed.port !== "443") return { ok: false, error: "port_not_allowed" };
  if (isIpLiteral(parsed.hostname)) return { ok: false, error: "host_not_allowed" };

  const urlBrand = extractBrand(parsed.hostname);
  if (!urlBrand) return { ok: false, error: "host_not_allowed" };

  const competitorBrand = extractBrand(competitorUrl);
  const sameBrand = competitorBrand !== null && urlBrand === competitorBrand;
  const atsAllowed = sourceType === "jobs" && ATS_BRANDS.has(urlBrand);
  // A repo lives on github.com by definition, never on the competitor's own domain
  // — the same off-domain exception the ATS hosts get for `jobs`, and just as
  // SSRF-safe (one fixed, public host).
  const repoAllowed = sourceType === "github_repo" && urlBrand === "github";
  const roadmapAllowed = sourceType === "roadmap" && ROADMAP_BRANDS.has(urlBrand);
  // A status page almost never sits on the competitor's own brand: it is either
  // vendor-hosted or on a sibling domain. Refusing both is what made "they don't
  // publish a status page" unanswerable even when the user knew otherwise.
  const statusAllowed =
    sourceType === "status" &&
    (STATUS_BRANDS.has(urlBrand) || isStatusSibling(urlBrand, competitorBrand));
  // A pinned Trustpilot profile (trustpilot.com/review/<domain>) says which domain
  // to ask the API about, for a competitor listed under a different one than their
  // site. Same fixed-public-host shape as the ATS and roadmap exceptions.
  const trustpilotAllowed = sourceType === "trustpilot_public" && urlBrand === "trustpilot";
  // A channel URL is the answer to "no YouTube channel linked from their site" —
  // by definition it lives on youtube.com, never on theirs.
  const youtubeAllowed = sourceType === "youtube" && urlBrand === "youtube";
  if (
    !sameBrand &&
    !atsAllowed &&
    !repoAllowed &&
    !roadmapAllowed &&
    !statusAllowed &&
    !trustpilotAllowed &&
    !youtubeAllowed
  ) {
    return { ok: false, error: "host_not_allowed" };
  }

  return { ok: true, url: parsed.toString() };
}

/**
 * Canonical form of a custom-monitor URL, used ONLY to dedupe two customs on the
 * same competitor (host lowercased, trailing slash on the path dropped, fragment
 * removed). Query strings are kept — a `?tab=security` is a genuinely different
 * page. Returns null on an unparseable input. Not a security check (that's
 * {@link validateCustomMonitorUrl}); just a stable equality key.
 */
export function normalizeCustomUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }
  return parsed.toString();
}

/**
 * Validate the URL of a CUSTOM page monitor. Unlike {@link validateMonitorUrl}
 * (which brand-matches by TLD-stripped label, so stripe.com ≈ stripe.io), a custom
 * page must live on the competitor's exact registrable domain (eTLD+1) — subdomains
 * are fine (docs.stripe.com for stripe.com), a different registrable domain is not.
 * Same syntactic SSRF guard as the other monitor URLs (https, no creds, standard
 * port, no IP literal, no internal host). `custom_url_domain_mismatch` is the
 * structured rejection the API surfaces.
 */
export function validateCustomMonitorUrl(
  raw: string,
  competitorUrl: string | null,
): MonitorUrlValidation {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (parsed.protocol !== "https:") return { ok: false, error: "must_be_https" };
  if (parsed.username || parsed.password) return { ok: false, error: "credentials_not_allowed" };
  if (parsed.port && parsed.port !== "443") return { ok: false, error: "port_not_allowed" };
  if (isIpLiteral(parsed.hostname)) return { ok: false, error: "host_not_allowed" };
  if (isUnsafeHost(parsed.hostname)) return { ok: false, error: "host_not_allowed" };

  // eTLD+1 equality (subdomains collapse to the registrable domain) — the domain
  // lock AND the SSRF guard: an internal host never shares a registrable domain
  // with a real competitor site.
  const urlDomain = normalizeHostname(parsed.hostname);
  const competitorDomain = normalizeHostname(competitorUrl);
  if (!urlDomain || !competitorDomain || urlDomain !== competitorDomain) {
    return { ok: false, error: "custom_url_domain_mismatch" };
  }

  return { ok: true, url: parsed.toString() };
}
