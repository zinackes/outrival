/**
 * Quantified marketing claims pulled from homepage copy — patch-17. "15,000
 * teams", "99.9% uptime", "2 billion requests": the numbers a competitor brags
 * about. Tracked over time (numeric_claims) so a jump ("10,000 → 50,000 teams")
 * surfaces as a business signal the section diff alone wouldn't flag.
 *
 * PURE: text in, claims out — no DB, no network. Regex-based, deterministic.
 * Exposed as the `@outrival/scrapers/numeric-claims` subpath.
 */

export type ClaimPattern =
  | "user_count"
  | "uptime"
  | "scale"
  | "satisfaction"
  | "savings"
  | "other_metric";

export interface NumericClaim {
  /** The matched span, e.g. "15,000+ teams". */
  rawText: string;
  /** Parsed numeric value (k/M/B expanded). */
  value: number;
  /** "%", the counted noun ("teams"), or null. */
  unit: string | null;
  /** Stable grouping key within a pattern, e.g. "teams", "uptime". */
  context: string;
  pattern: ClaimPattern;
}

const MAX_CLAIMS = 50;

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

function parseCount(raw: string): number {
  return parseInt(raw.replace(/,/g, ""), 10);
}

function applyMultiplier(value: number, mult: string | undefined): number {
  const m = (mult ?? "").toLowerCase();
  if (m === "k") return value * 1e3;
  if (m === "m") return value * 1e6;
  return value;
}

function parseScale(raw: string, unit: string): number {
  const n = parseFloat(raw.replace(/,/g, ""));
  const u = unit.toLowerCase();
  if (u.startsWith("b")) return n * 1e9;
  if (u.startsWith("t")) return n * 1e12;
  return n * 1e6; // million / m
}

interface ClaimParse {
  value: number;
  unit: string | null;
  context: string;
}

const PATTERNS: Array<{
  regex: RegExp;
  pattern: ClaimPattern;
  parse: (m: RegExpMatchArray) => ClaimParse | null;
}> = [
  {
    // "15,000 teams", "10k users", "5000+ customers", "10M developers"
    regex:
      /([\d,]+(?:\.\d+)?)\s*([kmKM])?\s*\+?\s*(teams|users|customers|companies|developers|businesses|organizations|brands|websites|stores|members|subscribers)\b/g,
    pattern: "user_count",
    parse: (m) => {
      const raw = m[1];
      const noun = m[3];
      if (!raw || !noun) return null;
      const value = applyMultiplier(parseCount(raw), m[2]);
      return { value, unit: noun.toLowerCase(), context: noun.toLowerCase() };
    },
  },
  {
    // "99.9% uptime", "99.99% reliability"
    regex: /(\d{2,3}(?:\.\d+)?)\s*%\s*(uptime|reliability|availability|sla)\b/gi,
    pattern: "uptime",
    parse: (m) => {
      const raw = m[1];
      const word = m[2];
      if (!raw || !word) return null;
      return { value: parseFloat(raw), unit: "%", context: word.toLowerCase() };
    },
  },
  {
    // "2 billion requests", "500 million events", "10M transactions"
    regex:
      /([\d,.]+)\s*(billion|million|trillion|[bmtBMT])\s*(tasks|events|requests|messages|transactions|api calls|queries|operations|downloads|installs|searches)\b/gi,
    pattern: "scale",
    parse: (m) => {
      const raw = m[1];
      const scale = m[2];
      const noun = m[3];
      if (!raw || !scale || !noun) return null;
      return { value: parseScale(raw, scale), unit: noun.toLowerCase(), context: noun.toLowerCase() };
    },
  },
  {
    // "98% satisfaction", "rated 4.8 stars"
    regex: /(\d{2,3}(?:\.\d+)?)\s*%\s*(satisfaction|satisfied|happy)\b/gi,
    pattern: "satisfaction",
    parse: (m) => {
      const raw = m[1];
      const word = m[2];
      if (!raw || !word) return null;
      return { value: parseFloat(raw), unit: "%", context: word.toLowerCase() };
    },
  },
  {
    // "save 40%", "save up to 30%"
    regex: /save\s*(?:up to\s*)?(\d{1,3})\s*%/gi,
    pattern: "savings",
    parse: (m) => {
      const raw = m[1];
      if (!raw) return null;
      return { value: parseFloat(raw), unit: "%", context: "savings" };
    },
  },
];

/**
 * Extract all quantified claims from a block of homepage text. Deduplicated by
 * (pattern, unit, context) — a repeated "15,000 teams" yields one claim.
 */
export function extractNumericClaims(text: string): NumericClaim[] {
  if (!text) return [];
  const claims: NumericClaim[] = [];
  const seen = new Set<string>();
  for (const { regex, pattern, parse } of PATTERNS) {
    // matchAll clones the regex internally, so reusing these /g patterns across
    // calls is safe (lastIndex is never mutated on the shared object).
    for (const match of text.matchAll(regex)) {
      const parsed = parse(match);
      if (!parsed || !Number.isFinite(parsed.value)) continue;
      const key = `${pattern}|${parsed.unit ?? ""}|${parsed.context}`;
      if (seen.has(key)) continue;
      seen.add(key);
      claims.push({
        rawText: norm(match[0]),
        value: parsed.value,
        unit: parsed.unit,
        context: parsed.context,
        pattern,
      });
      if (claims.length >= MAX_CLAIMS) return claims;
    }
  }
  return claims;
}
