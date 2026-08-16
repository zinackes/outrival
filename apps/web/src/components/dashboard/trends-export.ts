import type { TrendsSummary } from "@/lib/api";

/**
 * The trends report as a spreadsheet, following compare's export: the page's own
 * derived reading stays on the page, and what leaves is the flat evidence under it —
 * one line per captured movement, across all four dimensions at once.
 *
 * Takes the ALREADY FILTERED summary, so a hidden competitor is absent from the file
 * the same way it is absent from the charts. A download that quietly re-adds what the
 * reader excluded is a different report wearing the same name.
 */
export interface TrendsCsvRow {
  dimension: string;
  competitor: string;
  item: string;
  value: string;
  previous: string;
  change: string;
  note: string;
  recordedAt: string;
}

export const TRENDS_CSV_COLUMNS: Array<{ key: keyof TrendsCsvRow; label: string }> = [
  { key: "dimension", label: "Dimension" },
  { key: "competitor", label: "Competitor" },
  { key: "item", label: "Item" },
  { key: "value", label: "Value" },
  { key: "previous", label: "Previous" },
  { key: "change", label: "Change" },
  { key: "note", label: "Note" },
  { key: "recordedAt", label: "Recorded" },
];

const num = (n: number | null | undefined): string => (n == null ? "" : String(n));

// A delta only means something when both ends were captured; an absent baseline
// leaves the cell empty rather than claiming a move from zero.
function delta(current: number, previous: number | null | undefined): string {
  if (previous == null) return "";
  const d = current - previous;
  return d > 0 ? `+${d}` : String(d);
}

const day = (iso: string): string => iso.slice(0, 10);

export function toTrendsRows(summary: TrendsSummary): TrendsCsvRow[] {
  const rows: TrendsCsvRow[] = [];

  for (const m of summary.pricing) {
    rows.push({
      dimension: "Pricing",
      competitor: m.competitorName,
      item: m.planName,
      value: num(m.price),
      previous: num(m.prevPrice),
      change: delta(m.price, m.prevPrice),
      note: [m.currency, m.billingPeriod].filter(Boolean).join(" / "),
      recordedAt: day(m.recordedAt),
    });
  }

  for (const m of summary.hiring) {
    rows.push({
      dimension: "Hiring",
      competitor: m.competitorName,
      item: "Open roles",
      value: num(m.latest),
      previous: num(m.earliest),
      change: m.net > 0 ? `+${m.net}` : String(m.net),
      note: "",
      recordedAt: "",
    });
  }

  for (const m of summary.reviews) {
    rows.push({
      dimension: "Reviews",
      competitor: m.competitorName,
      item: m.source,
      value: m.score.toFixed(2),
      previous: m.firstScore == null ? "" : m.firstScore.toFixed(2),
      change: m.firstScore == null ? "" : (m.score - m.firstScore).toFixed(2),
      note: `${m.reviewCount} reviews`,
      recordedAt: day(m.recordedAt),
    });
  }

  for (const m of summary.tech) {
    rows.push({
      dimension: "Tech",
      competitor: m.competitorName,
      item: m.techId,
      value: m.event,
      previous: "",
      change: "",
      note: m.importance,
      recordedAt: day(m.recordedAt),
    });
  }

  return rows;
}

/** `outrival-trends-2026-06-01-to-2026-08-14.csv` — the window is in the filename. */
export function trendsCsvFilename(from: Date, to: Date): string {
  return `outrival-trends-${day(from.toISOString())}-to-${day(to.toISOString())}.csv`;
}
