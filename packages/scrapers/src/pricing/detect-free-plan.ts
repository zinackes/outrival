/**
 * Permanent free-plan detection from pricing-page text (AI-free). Complements
 * detect-trial (patch-33): a free *trial* is time-limited access to a paid plan; a
 * free *plan* is a permanent $0 tier. The pricing extractor only emits priced plan
 * *cards*, so a free tier written on the page as a "Free" comparison column, a CTA,
 * or a "Free forever" line — but not captured as a priced card — is invisible, and
 * the pricing tab then wrongly asserts the competitor has no free tier (detect-trial's
 * own comment even assumes freemium "is already captured as a $0 plan by the pricing
 * extractor" — which this proves false; e.g. decktopus lists "Free / PRO AI /
 * Business AI" columns but only the paid ones carry a price token).
 *
 * Pure regex on the plain text, so it runs on EVERY pricing scrape regardless of the
 * staged-extraction path (structured-first / cached parser / AI floor). Mirrors the
 * project's "AI off the hot path" bias, exactly like detect-trial.
 *
 * Precision over recall: matches only explicit permanent-free phrasings or a "Free"
 * token sitting in a plan lineup — never a bare marketing "free" (risk-free, feel
 * free, toll-free, "free up your time"…) and never a free *trial* / "start free" CTA
 * ("free for 14 days", "get started free") — those are detect-trial's concern.
 */

// Recognized paid-tier plan names. Two of them next to a "Free" token is a strong
// pricing-lineup signal (a real plan column/card), which marketing prose does not
// produce; a single one ("free premium support") is not enough.
const TIER =
  "(?:pro|professional|business|teams?|plus|premium|enterprise|starter|growth|scale|standard|advanced|ultimate|individual|company|organization)";

// "Free" as a plan-column/card header in a lineup: the token "Free" sitting right
// before ≥2 tier names (decktopus: "Free PRO AI Business AI"). Excludes CTA/trial
// uses of "free" (get/try/start/for… free, "free trial") — those don't denote a
// permanent plan, only an entry hook already covered by detect-trial.
const FREE_HEADER = new RegExp(
  `(?<!\\b(?:get|try|start|started|starts|is|it|for|completely|totally|entirely|use|absolutely|feel|risk)\\s)` +
    `\\bfree\\b(?!\\s*trial\\b)` +
    `[\\s\\S]{0,15}?\\b${TIER}\\b` +
    `[\\s\\S]{0,25}?\\b${TIER}\\b`,
  "i",
);

// A recurring $0 price ("$0/mo", "$0 per user", "€0 / month") — a zero tied to a
// period is a free plan, not a "$0 setup fee" / "$0 today" trial hook.
const ZERO_PRICE_PERIOD =
  /(?:\$|€|£|usd|eur|gbp)\s?0(?:\.0{1,2})?\s?(?:\/|per\s|a\s)?\s?(?:mo\b|month|user|seat|yr\b|year)/i;

// Explicit permanent-free-tier phrasings.
const FREE_PLAN_PHRASE = new RegExp(
  [
    // Named permanent tier ("Free plan", "free tier", "free version"…).
    "\\bfree (?:plan|tier|version|account|membership|subscription)\\b",
    // "Free forever" / "forever free" / "always free".
    "\\bfree forever\\b",
    "\\b(?:forever|always) free\\b",
    // Free for a permanent audience — NOT "free for 14 days" (a trial), so a bare
    // "free for" + number is excluded; only named audiences or seat counts.
    "\\bfree for (?:individuals?|personal(?: use)?|hobby(?:ists?)?|solo|students?|teachers?|nonprofits?|freelancers?|makers?)\\b",
    "\\bfree for (?:up to )?\\d+\\s?(?:users?|seats?|members?|people|projects?)\\b",
    // A recurring $0 price.
    ZERO_PRICE_PERIOD.source,
  ].join("|"),
  "i",
);

/**
 * Whether the page advertises a permanent free plan / freemium tier. Page-level
 * fact, stamped identically onto every plan row of a scrape (like the trial facts).
 */
export function detectFreePlan(text: string): boolean {
  if (!text) return false;
  return FREE_PLAN_PHRASE.test(text) || FREE_HEADER.test(text);
}
