import * as cheerio from "cheerio";

export interface PricingSignals {
  hasPriceTokens: boolean; // currency symbol + digits (+ optional period)
  hasGatedKeywords: boolean; // "Contact sales", "Book a demo", ...
  hasCalculator: boolean; // interactive inputs / sliders
  hasSignupWall: boolean; // "Sign up to see pricing"
  hasPromotionalText: boolean; // "Black Friday", "Limited time", ...
  priceMatches: string[]; // every "€29/mo" found
  gatedMatches: string[]; // every "Contact sales" found
  promoMatches: string[]; // every promo indicator found
}

const CURRENCY_PATTERNS = [
  /[€$£¥]\s?\d+[\d.,]*(\s?\/\s?(mo|month|mois|yr|year|an))?/gi,
  /\d+[\d.,]*\s?[€$£¥](\s?\/\s?(mo|month|mois|yr|year|an))?/gi,
];

const GATED_KEYWORDS = [
  /\bcontact\s+(us|sales|nous)\b/i,
  /\b(book|get|schedule|request)\s+(a\s+)?demo\b/i,
  /\brequest\s+(a\s+)?(quote|pricing)\b/i,
  /\btalk\s+to\s+(sales|an?\s+(expert|specialist))\b/i,
  /\bget\s+(a\s+)?quote\b/i,
  /\bcustom\s+pricing\b/i,
  /\bpricing\s+on\s+request\b/i,
  /\bdemander\s+une?\s+d[ée]mo\b/i,
  /\bnous\s+contacter\b/i,
  /\bsur\s+demande\b/i,
];

// Tested against raw HTML so the <input> tags survive. Covers both an
// interactive calculator UI and the usage-based vocabulary that signals one —
// per the taxonomy, usage-based pricing IS the `dynamic` case (a slider/quantity
// you can't read statically), e.g. Segment's "Monthly Tracked Users" slider.
const CALCULATOR_INDICATORS = [
  /<input[^>]*type=["']?(number|range)/i,
  /<input[^>]*name=["']?(users|seats|events|requests|volume)/i,
  /how\s+many\s+(users|seats|events|requests)/i,
  /estimate\s+your\s+(cost|price|bill)/i,
  /pricing\s+calculator/i,
  /pay[\s-]?as[\s-]?you[\s-]?go/i,
  /usage[\s-]based\s+pricing/i,
  /based\s+on\s+(your\s+)?usage/i,
  /monthly\s+tracked\s+users?/i,
  /\bMTUs?\b/,
];

const PROMO_INDICATORS = [
  /\blimited\s+time\b/i,
  /\bblack\s+friday\b/i,
  /\bcyber\s+monday\b/i,
  /\bend\s+of\s+year\b/i,
  /\bearly\s+bird\b/i,
  /\blifetime\s+deal\b/i,
  /\b\d+%\s+off\b/i,
  /\bpromo\b/i,
  /\bsave\s+[€$£¥]\d+/i,
  // No \b around accented letters: é/É aren't \w in JS regex, so a word
  // boundary never forms next to them. Match the distinctive stems directly,
  // and spell out É since /i only case-folds ASCII (é won't match É).
  /offre\s+limit[ée]e/i,
  /dur[ée]e\s+limit[ée]e/i,
  /[éÉeE]conomisez/i,
];

const SIGNUP_WALL = [
  /sign\s+up\s+(to|for|and)\s+(see|view|access|get)\s+(pricing|prices|plans)/i,
  /create\s+(an\s+)?account\s+to\s+(see|view|access)/i,
  /inscrivez-vous\s+pour\s+(voir|acc[ée]der)/i,
  /cr[ée]er\s+un\s+compte\s+pour\s+(voir|acc[ée]der)/i,
];

export function detectPricingSignals(html: string): PricingSignals {
  const text = extractVisibleText(html);

  const priceMatches = collectMatches(text, CURRENCY_PATTERNS);
  const gatedMatches = collectMatches(text, GATED_KEYWORDS);
  const promoMatches = collectMatches(text, PROMO_INDICATORS);

  return {
    hasPriceTokens: priceMatches.length > 0,
    priceMatches,
    hasGatedKeywords: gatedMatches.length > 0,
    gatedMatches,
    hasCalculator: anyMatch(html, CALCULATOR_INDICATORS),
    hasSignupWall: anyMatch(text, SIGNUP_WALL),
    hasPromotionalText: promoMatches.length > 0,
    promoMatches,
  };
}

export function emptySignals(): PricingSignals {
  return {
    hasPriceTokens: false,
    hasGatedKeywords: false,
    hasCalculator: false,
    hasSignupWall: false,
    hasPromotionalText: false,
    priceMatches: [],
    gatedMatches: [],
    promoMatches: [],
  };
}

/** Strip scripts/styles and return collapsed visible text. */
export function extractVisibleText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, template, svg").remove();
  const body = $("body");
  const text = body.length ? body.text() : $.root().text();
  return text.replace(/\s+/g, " ").trim();
}

// Collect every match of every pattern. Always matches with the global flag on
// a fresh clone so a `g`-flagged pattern's lastIndex never leaks between calls
// (the classic stateful-regex bug if you reuse a global regex with .test()).
function collectMatches(haystack: string, patterns: RegExp[]): string[] {
  const out = new Set<string>();
  for (const p of patterns) {
    const flags = p.flags.includes("g") ? p.flags : `${p.flags}g`;
    const re = new RegExp(p.source, flags);
    for (const m of haystack.matchAll(re)) {
      const value = m[0].trim();
      if (value) out.add(value);
    }
  }
  return [...out];
}

// Boolean test that never carries lastIndex state: strips the global flag.
function anyMatch(haystack: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => new RegExp(p.source, p.flags.replace("g", "")).test(haystack));
}
