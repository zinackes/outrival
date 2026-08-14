import { classifyRedirect } from "@outrival/scrapers/diagnose-failure";
import { resolveTrustpilotDomain } from "@outrival/scrapers/trustpilot";
import {
  keepRatio,
  normalizeHostname,
  parseAppStoreUrl,
  parseShopifyAppUrl,
  protectRegression,
} from "@outrival/shared";

// Is this capture the reviews page of the competitor we asked for?
// (Véracité Intelligence v2, P5 — audit R7.)
//
// R6 answers that question for own-domain sources at capture time, and deliberately
// excludes reviews: a reviews source legitimately lives on someone else's domain, so
// the landing-URL check alone cannot tell "g2.com/products/acme" from
// "g2.com/products/anvil". The check that CAN is the identity the platform itself
// puts in the capture — Apple's app id, Shopify's listing handle, Trustpilot's
// domain — compared against the identity the monitor URL names.
//
// It matters here more than anywhere else because review_scores is a time series
// read as one competitor's rating: a single point captured from another brand's
// profile does not look wrong, it looks like a move. Nobody can spot it afterwards,
// and the score-drop detector will happily turn it into a signal.
//
// Every check degrades to "no opinion" rather than to a refusal. A source whose
// identity we cannot derive (a G2 page, a monitor URL we can't parse) is published
// exactly as it is today: the guard only ever fires on a POSITIVE mismatch.

export type ReviewsRefusalReason =
  /** The capture names a different app/listing/domain than the monitor does. */
  | "wrong_target"
  /** The URL that served the bytes is on another registrable domain. */
  | "offsite_redirect"
  /** A profile path was bounced to the bare root — the profile is gone. */
  | "root_bounce"
  /** The extracted text never names the competitor we monitor. */
  | "brand_absent"
  /** Nothing review-shaped came out: no score, no count, no verbatim. */
  | "no_structure"
  /** The review total collapsed — better explained by a wrong page than a change. */
  | "count_collapse"
  /** The rating collapsed, same reasoning. */
  | "score_collapse"
  /** An anti-bot interstitial served at HTTP 200. Not produced here (the job detects it). */
  | "blocked_challenge";

export interface ReviewsRefusal {
  reason: ReviewsRefusalReason;
  /** What was seen, for the log line and the job's return value. */
  detail: string;
}

/** The three sources whose snapshot is our own JSON, and therefore carries an id. */
type IdentifiedSource = "appstore" | "shopify" | "trustpilot";

function isIdentified(source: string): source is IdentifiedSource {
  return source === "appstore" || source === "shopify" || source === "trustpilot";
}

/**
 * The identity the monitor asked for, from its URL. Null when the URL names none —
 * a G2 product page, a hand-typed URL the parser rejects, a competitor with no site.
 */
export function intendedIdentity(source: string, url: string | null): string | null {
  if (!url || !isIdentified(source)) return null;
  if (source === "appstore") return parseAppStoreUrl(url)?.appId ?? null;
  if (source === "shopify") return parseShopifyAppUrl(url)?.handle.toLowerCase() ?? null;
  return resolveTrustpilotDomain(url);
}

/**
 * The identity the capture itself carries. Null when the payload is not one of our
 * normalized snapshots — including when its `source` marker disagrees, which the
 * parsers already reject downstream as a parse failure.
 */
export function capturedIdentity(source: string, payload: string): string | null {
  if (!isIdentified(source)) return null;
  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const snap = data as { source?: unknown; appId?: unknown; handle?: unknown; domain?: unknown };
  if (snap.source !== source) return null;
  if (source === "appstore") return typeof snap.appId === "string" ? snap.appId : null;
  if (source === "shopify") return typeof snap.handle === "string" ? snap.handle.toLowerCase() : null;
  return typeof snap.domain === "string" ? normalizeHostname(snap.domain) : null;
}

/**
 * The pre-extraction gate: does this capture belong to the competitor we monitor?
 *
 * Ordered by how much it proves. The platform's own identifier is decisive, so it is
 * checked first; the landing URL is the fallback for the sources that carry no id,
 * and only catches the coarse failures (another domain, a bounce to the root) — the
 * same two R6 grades, applied here because reviews are out of R6's scope.
 */
export function checkCapturedTarget(args: {
  source: string;
  intendedUrl: string | null;
  finalUrl: string | null;
  payload: string;
}): ReviewsRefusal | null {
  const intended = intendedIdentity(args.source, args.intendedUrl);
  const captured = capturedIdentity(args.source, args.payload);
  if (intended !== null && captured !== null && intended !== captured) {
    return {
      reason: "wrong_target",
      detail: `capture names ${captured}, monitor names ${intended}`,
    };
  }
  if (args.intendedUrl && args.finalUrl) {
    const mismatch = classifyRedirect(args.intendedUrl, args.finalUrl);
    if (mismatch === "offsite") {
      return { reason: "offsite_redirect", detail: `landed on ${args.finalUrl}` };
    }
    if (mismatch === "root_bounce") {
      return { reason: "root_bounce", detail: `bounced to ${args.finalUrl}` };
    }
  }
  return null;
}

/** Shortest token worth matching: below it, a hit is a coincidence, not the brand. */
const MIN_TOKEN = 4;
/** Below this much text there is nothing to look for the brand in. */
const MIN_TEXT = 200;

function normalizeToken(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Does the extracted text name the competitor at all?
 *
 * The net for the sources with no structured id: a G2 or Capterra page for another
 * product parses perfectly and reads as a valid rating. Deliberately generous — any
 * ONE of the full name, its first word, or the site's domain label is enough — so
 * that "Acme, Inc." matching a page that only ever writes "Acme" still publishes.
 * A brand that yields no token of at least four characters is not judged at all.
 */
export function checkBrandPresence(
  text: string,
  brand: { name: string; url: string | null },
): ReviewsRefusal | null {
  if (text.length < MIN_TEXT) return null;
  const full = normalizeToken(brand.name);
  const first = normalizeToken(brand.name.split(/\s+/)[0] ?? "");
  const host = brand.url ? normalizeHostname(brand.url) : null;
  const label = host ? normalizeToken(host.split(".")[0] ?? "") : "";
  const tokens = [full, first, label].filter((t) => t.length >= MIN_TOKEN);
  if (tokens.length === 0) return null;
  const haystack = normalizeToken(text);
  if (tokens.some((t) => haystack.includes(t))) return null;
  return { reason: "brand_absent", detail: `"${brand.name}" appears nowhere in the capture` };
}

/**
 * Is there anything review-shaped in what came out?
 *
 * A score, a count — zero included, that is the platform saying "no reviews yet" —
 * or a verbatim. None of the three means we extracted from something that is not a
 * reviews page, whatever it parsed as.
 */
export function checkReviewsStructure(found: {
  score: number | null;
  reviewCount: number | null;
  verbatims: number;
}): ReviewsRefusal | null {
  if (found.score !== null || found.reviewCount !== null || found.verbatims > 0) return null;
  return { reason: "no_structure", detail: "no score, no count, no verbatim" };
}

/**
 * A review total this far below the stored one is better explained by a bad capture.
 * 20 is the floor where a halving stops being plausible: an app with 12 ratings
 * genuinely loses half of them when the vendor resets a listing.
 */
const MIN_PREV_COUNT = 20;
/** Ratings live on 1..5, so anything under 3 has no room left to collapse from. */
const MIN_PREV_SCORE = 3;
/** Half. Well below any real move, and above every wrong-page reading we have seen. */
const COLLAPSE_RATIO = 0.5;

/**
 * The last line: the fresh point against the stored one.
 *
 * Sized so a REAL move always publishes — a Trustpilot score sliding 4.4 → 4.2 is the
 * signal this product exists to catch, and even a brutal 4.6 → 2.4 goes through. Only
 * a collapse past half survives no explanation but a capture of something else.
 *
 * A missing fresh count (a G2 page that shows a rating and no total) is not a
 * collapse: it is a platform that did not say. Only a number is compared to a number.
 */
export function checkScoreRegression(
  previous: { score: number; reviewCount: number } | null,
  next: { score: number; reviewCount: number | null },
): ReviewsRefusal | null {
  if (!previous) return null;
  if (
    next.reviewCount !== null &&
    protectRegression({
      prevCount: previous.reviewCount,
      nextCount: next.reviewCount,
      minPrev: MIN_PREV_COUNT,
      minKeep: keepRatio(previous.reviewCount, COLLAPSE_RATIO),
    })
  ) {
    return {
      reason: "count_collapse",
      detail: `${previous.reviewCount} reviews → ${next.reviewCount}`,
    };
  }
  if (
    protectRegression({
      prevCount: previous.score,
      nextCount: next.score,
      minPrev: MIN_PREV_SCORE,
      minKeep: keepRatio(previous.score, COLLAPSE_RATIO),
    })
  ) {
    return { reason: "score_collapse", detail: `${previous.score} → ${next.score}` };
  }
  return null;
}
