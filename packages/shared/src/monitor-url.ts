import { extractBrand } from "./url";
import { isReviewSource, validateReviewUrl } from "./reviews";
import type { SourceType } from "./constants/sources";

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

export type MonitorUrlValidation =
  | { ok: true; url: string }
  | { ok: false; error: string };

/** Reject IP-literal hosts (IPv4 or IPv6) — defense-in-depth against SSRF. */
function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
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
  competitorUrl: string,
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
  if (!sameBrand && !atsAllowed) return { ok: false, error: "host_not_allowed" };

  return { ok: true, url: parsed.toString() };
}
