import type {
  JobTrendPoint,
  PricingHistoryPoint,
  ReviewScorePoint,
} from "@/lib/api";
import { formatDate } from "@/lib/format-date";

export function lineColor(i: number): string {
  // Theme-aware data-viz palette (globals.css --chart-1..6); one series color
  // reads on both light and dark surfaces.
  return `var(--chart-${(i % 6) + 1})`;
}

/**
 * The analytics tables store `recorded_at` as a naive `timestamp`, so the API wraps
 * it in `AT TIME ZONE 'UTC'` and Postgres renders "2026-07-11 23:02:25+00". That
 * offset is one digit short of ISO 8601: swapping the space for a "T" turned a
 * string the engine parses fine into an unparseable one, and every axis label fell
 * back to printing the raw timestamp. Parse as given, and only reach for the "T"
 * form when the engine actually rejects it.
 */
export function parseRecordedAt(value: string): Date {
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;
  return new Date(value.replace(" ", "T"));
}

export function shortDate(iso: string): string {
  const d = parseRecordedAt(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formatDate(d, { day: "2-digit", month: "short" });
}

/**
 * Fold rows into one chart point per capture DAY, ordered by the real timestamp.
 *
 * Two traps live in the obvious version of this, and both drew a chart that lied:
 *   - ordering on the formatted label ("Apr 14") is a LEXICAL sort, so April lands
 *     before January and July before May. An archive-backfilled series, whose
 *     captures span months, then reads as noise rather than as a trend;
 *   - keying on that same label collapses the same day of two different years into
 *     one point, silently dropping a capture.
 * Keying on the ISO day and sorting on the epoch closes both.
 */
function mergeByDay<T>(
  rows: T[],
  recordedAt: (row: T) => string,
  assign: (point: Record<string, number | string>, row: T) => void,
): Array<Record<string, number | string>> {
  const byDay = new Map<string, { at: number; point: Record<string, number | string> }>();
  for (const row of rows) {
    const iso = recordedAt(row);
    const at = parseRecordedAt(iso);
    // An unparseable timestamp keeps its raw string as the key so it stays one
    // point instead of merging with every other unparseable row.
    const key = Number.isNaN(at.getTime()) ? iso : at.toISOString().slice(0, 10);
    const entry = byDay.get(key) ?? { at: at.getTime(), point: { date: shortDate(iso) } };
    assign(entry.point, row);
    byDay.set(key, entry);
  }
  return Array.from(byDay.values())
    .sort((a, b) => a.at - b.at)
    .map((e) => e.point);
}

export function buildPricingSeries(history: PricingHistoryPoint[]): {
  points: Array<Record<string, number | string>>;
  byPlan: Record<string, PricingHistoryPoint[]>;
} {
  // byPlan keeps every plan (incl. quote-based "Custom" tiers) for the tier list;
  // the chart points carry numeric prices only — a null-priced tier has no point.
  const byPlan: Record<string, PricingHistoryPoint[]> = {};
  for (const p of history) {
    (byPlan[p.plan_name] ??= []).push(p);
  }
  // One series per plan, so the caller must have narrowed `history` to a single
  // billing period first: a `yearly` row is an annual TOTAL, and letting it share
  // a plan's line with its monthly row draws a 12x cliff nobody is being charged.
  const points = mergeByDay(
    history.filter((p) => p.price != null),
    (p) => p.recorded_at,
    (point, p) => {
      point[p.plan_name] = p.price!;
      // P5 — this day's price was reconstructed from a Wayback capture, not
      // watched. Two underscore-prefixed meta keys, never series keys (the caller
      // derives those from byPlan), so the chart can draw the point differently
      // and name the date the archive actually holds.
      if (p.origin === "archive") point[ARCHIVED_KEY] = 1;
      point[CAPTURE_DAY_KEY] = longDate(p.recorded_at);
    },
  );
  return { points, byPlan };
}

/** Meta key: 1 when the day's point came from the Internet Archive. */
export const ARCHIVED_KEY = "__archived";
/** Meta key: the capture day, spelled out for the tooltip. */
export const CAPTURE_DAY_KEY = "__captureDay";

function longDate(iso: string): string {
  const d = parseRecordedAt(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formatDate(d, { day: "2-digit", month: "short", year: "numeric" });
}

export function buildJobTrend(
  points: JobTrendPoint[],
): Record<string, JobTrendPoint[]> {
  const byDept: Record<string, JobTrendPoint[]> = {};
  for (const p of points) {
    (byDept[p.department] ??= []).push(p);
  }
  return byDept;
}

/**
 * One point per capture day, carrying EVERY department the window knows about.
 *
 * A capture writes one row per department that has open roles, so a department
 * missing from a day means zero roles that day, not "not measured". Leaving the
 * hole cost twice, and both are visible on the Hiring tab: the areas are stacked,
 * so the top edge is meant to be the board total, and a hole made that edge fall
 * short of the number the tab states for the same day; and recharts still asks the
 * series for its end dot at a point with no y, which paints it at the top of the
 * plot area — the stray colored dot in the chart's top-right corner.
 */
export function mergeTrendsByDate(
  points: JobTrendPoint[],
): Array<Record<string, number | string>> {
  const departments = Array.from(new Set(points.map((p) => p.department)));
  const merged = mergeByDay(
    points,
    (p) => p.recorded_at,
    (point, p) => {
      point[p.department] = p.count;
    },
  );
  for (const point of merged) {
    for (const department of departments) point[department] ??= 0;
  }
  return merged;
}

export function buildReviewScoreSeries(points: ReviewScorePoint[]): {
  points: Array<Record<string, number | string>>;
  sources: string[];
} {
  const sources = Array.from(new Set(points.map((p) => p.source)));
  return {
    points: mergeByDay(
      points,
      (p) => p.recorded_at,
      (point, p) => {
        point[p.source] = p.score;
      },
    ),
    sources,
  };
}
