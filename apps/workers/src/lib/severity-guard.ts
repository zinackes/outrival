import type { Classification } from "@outrival/ai";

// Deterministic demotion guard between the model's "critical" and the
// immediate email it triggers (plan-027). "critical" bypasses every
// notification-moderation layer (NOTIFICATION_CRITICAL_BYPASS) and pages the
// customer within minutes, but the classifier is never told that stake — so a
// wrong "critical" token pages someone for a marketing-script detection. This
// guard sits between the model's output and the signal insert: it only ever
// demotes to "high", never upgrades, and never touches a non-critical severity.

/** Sources on which a "critical" can plausibly be observed. Everything else
 * (jobs, reviews, sitemap, tech_stack, ai_visibility, github_repo…) demotes:
 * those sources' worst case is strategic, not page-the-customer urgent. */
const CRITICAL_SOURCE_ALLOWLIST = new Set([
  "homepage",
  "pricing",
  "news",
  "blog",
  "changelog",
  "status",
  // sitemap v2: a competitor publishing a /vs/{your-brand} comparison page is a
  // page-worthy, DETERMINISTIC critical (regex slug match on the user's own org, not
  // a model guess). It only ever originates from this dedicated anchor, so allowing
  // it here does NOT open critical for AI-classified sitemap changes.
  "comparison_page",
]);

// "ma" joins the allowlist with the wave-2 taxonomy: an acquisition of, or by, a
// tracked competitor carries a deterministic "critical" floor (materiality.ts's
// applyCategoryFloor), and without this entry the guard would demote every one of
// them to "high" — the floor would be dead on arrival. It is the only wave-2
// category allowed to page; its sources (news, blog) are already allowlisted below.
const CRITICAL_CATEGORY_ALLOWLIST = new Set(["pricing", "product", "funding", "ma"]);

/** A pricing-critical must be anchored on an actual number/price token in the diff
 * — a wording-only pricing change is never page-worthy. */
const PRICE_TOKEN = /[€$£¥]\s?\d|\d\s?(€|\$|usd|eur|gbp)|\/\s?(mo|month|yr|year|an)\b/i;

export interface SeverityGuardInput {
  severity: Classification["severity"];
  category: string;
  sourceType: string;
  diffText: string;
}

export interface SeverityGuardResult {
  severity: Classification["severity"];
  demoted: boolean;
  reason: string | null;
}

export function applySeverityGuard(input: SeverityGuardInput): SeverityGuardResult {
  if (input.severity !== "critical") {
    return { severity: input.severity, demoted: false, reason: null };
  }
  if (!CRITICAL_CATEGORY_ALLOWLIST.has(input.category)) {
    // Narrow carve-out: the deterministic comparison-page attack (content category,
    // from the comparison_page anchor) is page-worthy. Every other content/reviews/
    // hiring critical still demotes.
    if (!(input.category === "content" && input.sourceType === "comparison_page")) {
      return { severity: "high", demoted: true, reason: `category_${input.category}` };
    }
  }
  if (!CRITICAL_SOURCE_ALLOWLIST.has(input.sourceType)) {
    return { severity: "high", demoted: true, reason: `source_${input.sourceType}` };
  }
  if (input.category === "pricing" && !PRICE_TOKEN.test(input.diffText)) {
    return { severity: "high", demoted: true, reason: "pricing_without_price_token" };
  }
  return { severity: "critical", demoted: false, reason: null };
}
