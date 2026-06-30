/**
 * Free-trial detection from pricing-page text (patch-33, AI-free). A free trial is
 * time-limited access to a paid plan — distinct from a permanent free/freemium tier,
 * which is already captured as a $0 plan by the pricing extractor. We surface three
 * facts a sales team cares about: whether a trial exists, its length in days, and
 * whether it needs a credit card up front ("no credit card required" is a strong
 * acquisition lever to compare against).
 *
 * Pure regex on the plain text, so it runs on EVERY pricing scrape regardless of the
 * staged-extraction path (structured-first / cached parser / AI floor) — schema.org
 * `Offer` doesn't reliably express trials, so an AI-only field would miss every
 * structured-resolved competitor. Mirrors the project's "AI off the hot path" bias.
 */

export interface TrialInfo {
  hasTrial: boolean;
  // null = a trial exists but no duration is stated ("Start your free trial").
  days: number | null;
  // null = unknown (only meaningful when hasTrial). false = "no credit card required".
  requiresCreditCard: boolean | null;
}

export const NO_TRIAL: TrialInfo = { hasTrial: false, days: null, requiresCreditCard: null };

// An explicit trial mention. Deliberately does NOT match a bare "free plan" /
// "free forever" (that's freemium, a permanent $0 tier, not a trial).
const TRIAL_PHRASE =
  /\bfree[\s-]?trial\b|\btrial period\b|\bstart (?:your |a )?(?:free )?trial\b|\btry (?:it |us |for )?free\b|\b\d+[\s-]?days?[\s-]?(?:free[\s-]?)?trial\b|\btrial[\s-]?(?:for |of )?\s?\d+[\s-]?days?\b|\bfree for \d+[\s-]?days?\b|\b\d+[\s-]?days?[\s-]?free\b/i;

// Duration patterns, each tied to a trial/free context so we don't grab an unrelated
// "30 day money-back guarantee". Weeks are normalized to days. First match wins.
const DAY_PATTERNS: RegExp[] = [
  /(\d+)[\s-]?days?[\s-]?(?:free[\s-]?)?trial/i,
  /(?:free[\s-]?)?trial[\s-]?(?:for |of |:)?\s?(\d+)[\s-]?days?/i,
  /free for (\d+)[\s-]?days?/i,
  /(\d+)[\s-]?days?[\s-]?free/i,
];
const WEEK_PATTERNS: RegExp[] = [
  /(\d+)[\s-]?weeks?[\s-]?(?:free[\s-]?)?trial/i,
  /(?:free[\s-]?)?trial[\s-]?(?:for |of )?\s?(\d+)[\s-]?weeks?/i,
];

const NO_CARD = /no credit card(?:\s+(?:required|needed))?|without (?:a )?credit card|no card required|no cc required|credit card[- ]free/i;
const CARD_REQUIRED = /credit card (?:is )?required|requires? (?:a )?credit card|card required to start/i;

function trialDays(text: string): number | null {
  for (const re of DAY_PATTERNS) {
    const m = text.match(re);
    const n = m ? Number(m[1]) : NaN;
    if (Number.isFinite(n) && n >= 1 && n <= 365) return n;
  }
  for (const re of WEEK_PATTERNS) {
    const m = text.match(re);
    const w = m ? Number(m[1]) : NaN;
    if (Number.isFinite(w) && w >= 1 && w <= 52) return w * 7;
  }
  return null;
}

export function detectTrial(text: string): TrialInfo {
  if (!text || !TRIAL_PHRASE.test(text)) return NO_TRIAL;
  // Card requirement is only reported when a trial exists. A "no credit card"
  // statement wins over a "card required" one if both somehow appear (the former is
  // the marketed promise); default to unknown when neither is stated.
  const requiresCreditCard = NO_CARD.test(text)
    ? false
    : CARD_REQUIRED.test(text)
      ? true
      : null;
  return { hasTrial: true, days: trialDays(text), requiresCreditCard };
}
