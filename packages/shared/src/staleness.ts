// Patch-27 — actionable data-freshness state. Distinct from patch-14's
// `freshness.ts` (fresh|aging|stale|failed, fixed 7/30-day cutoffs): here the
// thresholds vary by *what* is monitored (pricing goes stale fast, reviews
// slowly) and the result drives a concrete UI action (the inline "Re-scan"
// button shows up on orange/red). Pure + side-effect-free so the web dot and the
// silent-monitor worker read the exact same numbers.

import type { SourceType } from "./constants/sources";

// The six freshness buckets the thresholds are keyed by. The monitor
// `source_type` enum has more values; `mapSourceTypeToCategory` collapses them.
export type StalenessCategory =
  | "pricing"
  | "features"
  | "reviews"
  | "jobs"
  | "blog"
  | "homepage";

export type FreshnessState = "fresh" | "yellow" | "orange" | "red";

export interface StalenessThresholds {
  yellow: number; // days since last update → start "watch"
  orange: number; // → "stale", suggest a re-scan
  red: number; // → "very stale", re-scan urged + ops alert
}

const DEFAULT_THRESHOLDS: Record<StalenessCategory, StalenessThresholds> = {
  pricing: { yellow: 7, orange: 14, red: 30 },
  features: { yellow: 14, orange: 30, red: 60 },
  reviews: { yellow: 21, orange: 45, red: 90 },
  jobs: { yellow: 14, orange: 30, red: 60 },
  blog: { yellow: 30, orange: 60, red: 120 },
  homepage: { yellow: 14, orange: 30, red: 60 },
};

// Collapse a monitor `source_type` (12 values) onto one of the six threshold
// buckets. github_repo → features so a dev-stage product's repo gets its own
// cadence; the social/anchor sources fall back to homepage timing.
export function mapSourceTypeToCategory(sourceType: SourceType): StalenessCategory {
  switch (sourceType) {
    case "pricing":
      return "pricing";
    case "jobs":
      return "jobs";
    case "g2_reviews":
    case "capterra_reviews":
    case "appstore_reviews":
    case "trustpilot_reviews":
    case "trustradius_reviews":
    case "gartner_reviews":
    case "playstore_reviews":
    case "reddit":
      return "reviews";
    case "blog":
    case "changelog":
      return "blog";
    case "github_repo":
      return "features";
    case "homepage":
    case "linkedin":
    case "twitter":
    case "tech_stack":
    default:
      return "homepage";
  }
}

// Parse a "yellow,orange,red" env string (e.g. "7,14,30"). Any malformed value
// falls back to the default for that category — config never crashes the dot.
export function parseThresholdsFromEnv(
  envValue: string | undefined,
  fallback: StalenessThresholds,
): StalenessThresholds {
  if (!envValue) return fallback;
  const parts = envValue.split(",").map((s) => parseInt(s.trim(), 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return fallback;
  const [yellow, orange, red] = parts as [number, number, number];
  return { yellow, orange, red };
}

// Thresholds for a category, env-overridable via STALENESS_THRESHOLDS_<CATEGORY>.
// `process.env` is only inlined server-side (Next strips non-NEXT_PUBLIC vars on
// the client), so the browser dot uses the defaults — intentional: these are
// non-secret cadence knobs the server/worker authoritatively applies.
export function getStalenessThresholds(category: StalenessCategory): StalenessThresholds {
  const fallback = DEFAULT_THRESHOLDS[category];
  const envValue =
    typeof process !== "undefined"
      ? process.env[`STALENESS_THRESHOLDS_${category.toUpperCase()}`]
      : undefined;
  return parseThresholdsFromEnv(envValue, fallback);
}

export interface FreshnessStateResult {
  state: FreshnessState;
  /** Whole days since the last update; Infinity when never updated. */
  ageDays: number;
  /** Days until the next worse state; null once red (nothing worse). */
  nextThresholdDays: number | null;
}

// Classify how stale a piece of data is for its source type. No timestamp →
// treated as red (we have nothing, surface the strongest call to action).
export function computeFreshnessState(
  lastUpdatedAt: Date | string | null | undefined,
  sourceType: SourceType,
  now: Date = new Date(),
): FreshnessStateResult {
  if (!lastUpdatedAt) {
    return { state: "red", ageDays: Infinity, nextThresholdDays: null };
  }
  const ts = lastUpdatedAt instanceof Date ? lastUpdatedAt.getTime() : new Date(lastUpdatedAt).getTime();
  if (Number.isNaN(ts)) {
    return { state: "red", ageDays: Infinity, nextThresholdDays: null };
  }

  const ageDays = Math.floor((now.getTime() - ts) / 86_400_000);
  const t = getStalenessThresholds(mapSourceTypeToCategory(sourceType));

  if (ageDays < t.yellow) {
    return { state: "fresh", ageDays, nextThresholdDays: t.yellow - ageDays };
  }
  if (ageDays < t.orange) {
    return { state: "yellow", ageDays, nextThresholdDays: t.orange - ageDays };
  }
  if (ageDays < t.red) {
    return { state: "orange", ageDays, nextThresholdDays: t.red - ageDays };
  }
  return { state: "red", ageDays, nextThresholdDays: null };
}
