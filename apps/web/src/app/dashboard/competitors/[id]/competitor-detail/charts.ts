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
  const byDate = new Map<string, Record<string, number | string>>();
  for (const p of history) {
    if (p.price == null) continue;
    const date = shortDate(p.recorded_at);
    const row = byDate.get(date) ?? { date };
    row[p.plan_name] = p.price;
    byDate.set(date, row);
  }
  const points = Array.from(byDate.values()).sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );
  return { points, byPlan };
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

export function mergeTrendsByDate(
  points: JobTrendPoint[],
): Array<Record<string, number | string>> {
  // Ordered by the real timestamp, not by the "05 Jul" label: the label sorts
  // lexically, which puts July before June, and the rows arrived in whatever
  // order the query returned. An unordered series draws as noise.
  const byDate = new Map<string, { at: number; row: Record<string, number | string> }>();
  for (const p of points) {
    const date = shortDate(p.recorded_at);
    const entry = byDate.get(date) ?? {
      at: parseRecordedAt(p.recorded_at).getTime(),
      row: { date },
    };
    entry.row[p.department] = p.count;
    byDate.set(date, entry);
  }
  return Array.from(byDate.values())
    .sort((a, b) => a.at - b.at)
    .map((e) => e.row);
}

export function buildReviewScoreSeries(points: ReviewScorePoint[]): {
  points: Array<Record<string, number | string>>;
  sources: string[];
} {
  const sources = Array.from(new Set(points.map((p) => p.source)));
  const byDate = new Map<string, Record<string, number | string>>();
  for (const p of points) {
    const date = shortDate(p.recorded_at);
    const row = byDate.get(date) ?? { date };
    row[p.source] = p.score;
    byDate.set(date, row);
  }
  return { points: Array.from(byDate.values()), sources };
}
