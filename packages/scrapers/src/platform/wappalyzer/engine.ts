import type { PlatformConfidence } from "@outrival/shared";
import type { TechCatalog } from "./types";

/**
 * Pure matcher over a Wappalyzer-format catalog (patch-31). No I/O, no cheerio —
 * regex/string only — so it unit-tests against fixtures and stays cheap on the
 * hot path. The caller assembles the evidence (headers/scripts/cookies/meta/cname,
 * plus rendered js globals on step B); this only matches it.
 */

export interface MatchInput {
  /** Raw HTML of the page. */
  html: string;
  /** Response headers, lower-cased names. */
  headers: Record<string, string>;
  /** `<script src>` URLs (absolute). */
  scriptSrc: string[];
  /** Cookie name → value (parsed from Set-Cookie). */
  cookies: Record<string, string>;
  /** `<meta name|property>` → content. */
  meta: Record<string, string>;
  /** Global JS variable name → value — only present after a render (step B). */
  js: Record<string, unknown>;
  /** Resolved CNAME chain for the host (empty when DNS is off/failed). */
  cname: string[];
}

export interface DetectedFingerprint {
  tech: string;
  categories: number[];
  confidence: PlatformConfidence;
  /** Signal tags that matched, e.g. "header:server", "script:cdn.segment.com". */
  evidence: string[];
}

type Parsed =
  | { kind: "presence"; confidence: number }
  | { kind: "regex"; regex: RegExp; confidence: number }
  | { kind: "invalid" };

/**
 * Split a Wappalyzer pattern `regex\;version:\1\;confidence:50` into its regex and
 * confidence. Empty pattern → presence-only. Unparseable regex → never matches.
 */
function parsePattern(raw: string): Parsed {
  const parts = raw.split("\\;");
  const pattern = parts[0] ?? "";
  let confidence = 100;
  for (let i = 1; i < parts.length; i++) {
    const m = /^confidence:(\d+)$/.exec(parts[i] ?? "");
    if (m && m[1]) confidence = Number(m[1]);
  }
  if (pattern === "") return { kind: "presence", confidence };
  try {
    return { kind: "regex", regex: new RegExp(pattern, "i"), confidence };
  } catch {
    return { kind: "invalid" };
  }
}

function bucket(maxConfidence: number, evidenceCount: number): PlatformConfidence {
  // Corroborating evidence nudges confidence up; a single 100 stays high.
  const score = maxConfidence + (evidenceCount - 1) * 25;
  if (score >= 100) return "high";
  if (score >= 50) return "medium";
  return "low";
}

export function matchFingerprints(input: MatchInput, catalog: TechCatalog): DetectedFingerprint[] {
  const byTech = new Map<string, DetectedFingerprint>();

  const record = (tech: string, categories: number[], tag: string, confidence: number): void => {
    const existing = byTech.get(tech);
    if (existing) {
      existing.evidence.push(tag);
      // confidence is recomputed once at the end from the max + count
      (existing as { _max?: number })._max = Math.max(
        (existing as { _max?: number })._max ?? 0,
        confidence,
      );
      return;
    }
    const created: DetectedFingerprint & { _max?: number } = {
      tech,
      categories,
      confidence: "low",
      evidence: [tag],
      _max: confidence,
    };
    byTech.set(tech, created);
  };

  // Keyed signals (the key must exist, then its value matches the pattern).
  const matchKeyed = (
    tech: string,
    cats: number[],
    source: Record<string, string> | Record<string, unknown>,
    defs: Record<string, string> | undefined,
    label: string,
  ): void => {
    if (!defs) return;
    const normalised = normaliseKeys(source);
    for (const [key, raw] of Object.entries(defs)) {
      const lookup = key.toLowerCase();
      if (!(lookup in normalised)) continue;
      const value = String(normalised[lookup] ?? "");
      const p = parsePattern(raw);
      if (p.kind === "invalid") continue;
      if (p.kind === "presence" || p.regex.test(value)) {
        record(tech, cats, `${label}:${key}`, p.confidence);
      }
    }
  };

  // List signals (any pattern matching any item).
  const matchList = (
    tech: string,
    cats: number[],
    items: string[],
    patterns: string[] | undefined,
    label: string,
  ): void => {
    if (!patterns) return;
    for (const raw of patterns) {
      const p = parsePattern(raw);
      if (p.kind !== "regex") continue;
      const hit = items.find((it) => p.regex.test(it));
      if (hit !== undefined) record(tech, cats, `${label}:${truncate(hit)}`, p.confidence);
    }
  };

  for (const [tech, fp] of Object.entries(catalog)) {
    matchKeyed(tech, fp.cats, input.headers, fp.headers, "header");
    matchKeyed(tech, fp.cats, input.cookies, fp.cookies, "cookie");
    matchKeyed(tech, fp.cats, input.meta, fp.meta, "meta");
    matchKeyed(tech, fp.cats, input.js, fp.js, "js");
    matchList(tech, fp.cats, [input.html], fp.html, "html");
    matchList(tech, fp.cats, input.scriptSrc, fp.scriptSrc, "script");
    matchList(tech, fp.cats, input.cname, fp.dns?.CNAME, "cname");
  }

  // Transitive `implies`: an implied tech inherits a one-step-lower confidence and
  // an "implied-by" evidence tag. Bounded by the catalog (no infinite cycles since
  // we only add techs not already present).
  for (const [tech, fp] of Object.entries(catalog)) {
    if (!byTech.has(tech) || !fp.implies) continue;
    for (const implied of fp.implies) {
      if (byTech.has(implied) || !catalog[implied]) continue;
      record(implied, catalog[implied].cats, `implied-by:${tech}`, 50);
    }
  }

  const out: DetectedFingerprint[] = [];
  for (const d of byTech.values()) {
    const max = (d as { _max?: number })._max ?? 0;
    d.confidence = bucket(max, d.evidence.length);
    delete (d as { _max?: number })._max;
    out.push(d);
  }
  return out;
}

// Header/cookie/meta keys are matched case-insensitively. Fetch already lower-cases
// header names; do it defensively for the others too.
function normaliseKeys(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source)) out[k.toLowerCase()] = v;
  return out;
}

function truncate(s: string): string {
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}
