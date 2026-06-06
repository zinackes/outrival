import type { PlatformField } from "@outrival/shared";
import { detectAtsBoard } from "../jobs/ats";

/**
 * Business signatures (patch-31): the platforms whose IDENTIFIER we extract so a
 * source can route straight to a structured connector. Unlike the generic
 * Wappalyzer engine (framework/CMS/CDN), these are hand-written, high-confidence,
 * and ID-bearing. Pure: regex over already-fetched HTML/scripts/CNAME, no I/O.
 *
 * ATS reuses the existing `detectAtsBoard` (patch jobs/ats) so detection and the
 * downstream jobs connector share one source of truth for providers + tokens.
 */

export interface SignatureInput {
  html: string;
  scriptSrc: string[];
  /** Resolved CNAME chain (empty when DNS is off). */
  cname: string[];
}

export interface SignatureHits {
  ats?: PlatformField<string>;
  pricingWidget?: PlatformField<string>;
  statusPage?: PlatformField<string>;
  changelog?: PlatformField<string>;
}

const field = (
  value: string,
  evidence: string[],
  confidence: PlatformField<string>["confidence"] = "high",
): PlatformField<string> => ({ value, confidence, evidence });

function anyScript(scriptSrc: string[], re: RegExp): string | null {
  return scriptSrc.find((s) => re.test(s)) ?? null;
}

export function detectBusinessSignatures(input: SignatureInput): SignatureHits {
  const { html, scriptSrc, cname } = input;
  const hits: SignatureHits = {};
  const haystack = `${html}\n${scriptSrc.join("\n")}\n${cname.join("\n")}`;

  // ── ATS (Greenhouse, Lever, Ashby, …) → "greenhouse:airbnb" ──────────────
  const board = detectAtsBoard(html);
  if (board) {
    hits.ats = field(`${board.provider}:${board.token}`, [`ats:${board.provider}`]);
  }

  // ── Stripe pricing table (the widget, not the payment SDK) ────────────────
  if (/<stripe-pricing-table/i.test(html) || anyScript(scriptSrc, /js\.stripe\.com\/v3\/pricing-table/i)) {
    hits.pricingWidget = field("stripe", ["pricing-widget:stripe-pricing-table"]);
  } else if (anyScript(scriptSrc, /cdn\.paddle\.com\/paddle/i) || /paddle\.Setup|data-paddle/i.test(html)) {
    hits.pricingWidget = field("paddle", ["pricing-widget:paddle"], "medium");
  }

  // ── Status page → "statuspage:<host>" / "instatus:<slug>" ─────────────────
  // Capture the page host (status.x.com → *.statuspage.io) when present; fall back
  // to a bare provider tag when only the CDN embed is visible. The page_id is
  // resolved by the connector (probe /api/v2/summary.json), not here.
  const spHost = /([a-z0-9-]+\.statuspage\.io)/i.exec(haystack);
  const spCname = cname.find((c) => /\.statuspage\.io$/i.test(c));
  if (spHost && spHost[1] && !/^(cdn|api)\./i.test(spHost[1])) {
    hits.statusPage = field(`statuspage:${spHost[1].toLowerCase()}`, [`statuspage:${spHost[1]}`]);
  } else if (spCname) {
    hits.statusPage = field(`statuspage:${spCname.toLowerCase()}`, [`cname:${spCname}`]);
  } else if (/cdn\.statuspage\.io/i.test(haystack)) {
    hits.statusPage = field("statuspage", ["statuspage:cdn-embed"], "medium");
  } else {
    const inst = /([a-z0-9-]+)\.instatus\.com/i.exec(haystack);
    if (inst && inst[1] && inst[1] !== "www") {
      hits.statusPage = field(`instatus:${inst[1].toLowerCase()}`, [`instatus:${inst[1]}`]);
    }
  }

  // ── Changelog widgets (unambiguous) → "canny" | "headway" | "beamer" ──────
  if (/canny\.io/i.test(haystack)) {
    hits.changelog = field("canny", ["changelog:canny"]);
  } else if (/headwayapp\.co/i.test(haystack)) {
    hits.changelog = field("headway", ["changelog:headway"]);
  } else if (/getbeamer\.com|beamer\.js/i.test(haystack)) {
    hits.changelog = field("beamer", ["changelog:beamer"]);
  } else {
    // RSS only when the feed path hints a changelog/release feed — a bare
    // <link rel=alternate rss> is usually the blog, not the changelog.
    const rss =
      /<link[^>]+rel=["']alternate["'][^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = rss.exec(html)) !== null) {
      const href = /href=["']([^"']+)["']/i.exec(m[0])?.[1];
      if (href && /(changelog|releases?|whats-?new|updates|product-?updates)/i.test(href)) {
        hits.changelog = field(`rss:${href}`, [`changelog:rss:${href}`], "medium");
        break;
      }
    }
  }

  return hits;
}
