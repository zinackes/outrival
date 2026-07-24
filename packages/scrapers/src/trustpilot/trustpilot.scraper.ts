import { normalizeHostname, type TrustpilotSnapshot } from "@outrival/shared";
import type { ScrapeOutcome } from "../types";

const API_BASE = "https://api.trustpilot.com/v1";

/**
 * Trustpilot public SURFACE via the OFFICIAL Trustpilot API (Reviews v2).
 *
 * Trustpilot's ToS forbids scraping (they name "AI agents or screen scrapers") and
 * license their review verbatims as a product. Verified 2026-07-15 (curl) that there
 * is NO keyless public endpoint — `api.trustpilot.com/v1/business-units/find` and the
 * `www.trustpilot.com/review/*` page both return HTTP 403 without a key. So this
 * scraper reads ONLY the surface — trust score, review count, star distribution — via
 * the official API with `TRUSTPILOT_API_KEY`, and NEVER third-party verbatims. There
 * is deliberately NO scraping fallback: no key ⇒ clean failure, never a bypass.
 *
 * The public Business Units read endpoints authenticate with the API key as the
 * `apikey` query param. The exact response field names below follow Trustpilot's
 * Business Units API docs and are parsed defensively; RE-CONFIRM them against a live
 * key at deploy (Étape 0 of the Reviews v2 card).
 */

interface FindResponse {
  id?: string;
  score?: { trustScore?: number; stars?: number };
  trustScore?: number;
  stars?: number;
  numberOfReviews?: { total?: number } | number;
}

interface StarDistributionEntry {
  stars?: number;
  count?: number;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Which domain to ask Trustpilot about.
 *
 * Normally the competitor's own site, since Trustpilot keys profiles by domain.
 * But a company is sometimes listed under another one (a legacy domain, a regional
 * or trading name), and the `find` call then 404s — which the product reports as
 * "no Trustpilot profile for this domain", i.e. a surface they don't have. A
 * pinned profile URL (`trustpilot.com/review/<domain>`) is the user answering that:
 * it names the domain to look up instead.
 *
 * Exported for tests.
 */
export function resolveTrustpilotDomain(url: string): string | null {
  const host = normalizeHostname(url);
  if (host !== "trustpilot.com") return host;
  try {
    const parsed = new URL(url.includes("://") ? url : `https://${url}`);
    const slug = /^\/review\/([^/?#]+)/.exec(parsed.pathname)?.[1];
    // A trustpilot.com URL that is NOT a /review/<domain> profile names no domain,
    // and falling back to "trustpilot.com" would look up Trustpilot itself.
    return slug ? normalizeHostname(decodeURIComponent(slug)) : null;
  } catch {
    return null;
  }
}

export async function scrape(_competitorId: string, url: string): Promise<ScrapeOutcome> {
  const key = process.env.TRUSTPILOT_API_KEY;
  // Clean degradation, not a workaround: no key ⇒ the source is simply unavailable.
  if (!key) throw new Error("trustpilot_api_key_missing");

  const domain = resolveTrustpilotDomain(url);
  if (!domain) throw new Error(`Cannot derive a domain from ${url}`);

  const auth = `apikey=${encodeURIComponent(key)}`;

  // 1. Resolve the business unit for this domain.
  const findRes = await fetch(
    `${API_BASE}/business-units/find?name=${encodeURIComponent(domain)}&${auth}`,
    { headers: { accept: "application/json" } },
  );
  if (findRes.status === 404) {
    throw new Error(`No Trustpilot business unit for ${domain}`);
  }
  if (!findRes.ok) {
    throw new Error(`Trustpilot find failed (${findRes.status}) for ${domain}`);
  }
  const bu = (await findRes.json()) as FindResponse;
  const businessUnitId = bu.id;
  if (!businessUnitId) {
    throw new Error(`Trustpilot returned no business unit id for ${domain}`);
  }

  const trustScore = num(bu.score?.trustScore) ?? num(bu.trustScore);
  const stars = num(bu.score?.stars) ?? num(bu.stars);
  const reviewCount =
    typeof bu.numberOfReviews === "number"
      ? bu.numberOfReviews
      : num(bu.numberOfReviews?.total) ?? 0;

  // Anti-silent-failure: a business unit with neither a score nor any reviews means
  // we resolved to the wrong thing (or the shape changed) — throw rather than store a
  // hollow snapshot that the next successful run would diff as a fake score movement.
  if (trustScore === null && reviewCount === 0) {
    throw new Error(`Trustpilot returned no usable surface for ${domain}`);
  }

  // 2. Star distribution — best-effort; a failure here never sinks the score point.
  let distribution: { stars: number; count: number }[] = [];
  try {
    const distRes = await fetch(
      `${API_BASE}/business-units/${encodeURIComponent(businessUnitId)}/reviews/star-distribution?${auth}`,
      { headers: { accept: "application/json" } },
    );
    if (distRes.ok) {
      const raw = (await distRes.json()) as {
        distribution?: StarDistributionEntry[];
      };
      const entries = Array.isArray(raw.distribution) ? raw.distribution : [];
      distribution = entries
        .map((e) => ({ stars: num(e.stars) ?? 0, count: num(e.count) ?? 0 }))
        .filter((e) => e.stars >= 1 && e.stars <= 5)
        .sort((a, b) => a.stars - b.stars); // deterministic
    }
  } catch {
    // leave distribution empty
  }

  const snapshot: TrustpilotSnapshot = {
    source: "trustpilot",
    domain,
    businessUnitId,
    trustScore,
    stars,
    reviewCount,
    distribution,
  };
  const html = JSON.stringify(snapshot);

  return {
    html,
    text: html,
    screenshotBuffer: Buffer.alloc(0),
    metadata: { source: "trustpilot", domain, businessUnitId, trustScore, reviewCount },
    statusCode: findRes.status,
    level: 0, // official API, no browser/proxy
    attempts: 1,
  };
}
