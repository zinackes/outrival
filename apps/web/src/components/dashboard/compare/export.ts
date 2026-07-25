import type { CompareColumn } from "@/lib/api";
import { money, techOf } from "./derive";

/**
 * The comparison as a grid, for the deck or the spreadsheet. This is what carries the
 * "give me the table" job now that the page itself reads as rows of measures: the
 * fields below are the flat, one-line-per-dimension form of every lens.
 */
export type ExportFormat = "csv" | "markdown" | "tsv";

// The label says what will happen (download a file vs copy, and in which shape),
// rather than a generic "Export".
export const EXPORT_BUTTON_LABEL: Record<ExportFormat, string> = {
  csv: "Export CSV",
  markdown: "Copy Markdown",
  tsv: "Copy table",
};

const DASH = "—";

function pricingText(c: CompareColumn): string {
  if (!c.pricing) return DASH;
  const { entry, top, currency, billingPeriod } = c.pricing;
  if (entry == null || top == null) return "Custom";
  const band =
    entry === top ? money(entry, currency) : `${money(entry, currency)}-${money(top, currency)}`;
  return billingPeriod ? `${band} / ${billingPeriod}` : band;
}

function plansText(c: CompareColumn): string {
  const plans = c.pricing?.plans ?? [];
  if (plans.length === 0) return DASH;
  return plans
    .map(
      (p) =>
        `${p.name || "Unnamed"} ${p.price == null ? "Custom" : money(p.price, c.pricing?.currency ?? null)}`,
    )
    .join(", ");
}

function hiringText(c: CompareColumn): string {
  if (!c.hiring) return DASH;
  const eng = c.hiring.engineeringOpen != null ? `, eng ${c.hiring.engineeringOpen}` : "";
  const dept = c.hiring.topDepartment ? `, top ${c.hiring.topDepartment}` : "";
  return `${c.hiring.totalOpen} open${eng}${dept}`;
}

function reviewsText(c: CompareColumn): string {
  if (c.reviews.length === 0) return DASH;
  return c.reviews.map((r) => `${r.source} ${r.score.toFixed(1)}/5 (${r.reviewCount})`).join(", ");
}

function moveText(c: CompareColumn): string {
  if (!c.latestSignal) return DASH;
  const { severity, category, insight, createdAt } = c.latestSignal;
  return `${severity} ${category}: ${insight} (${createdAt.slice(0, 10)})`;
}

const FIELDS: Array<{ label: string; value: (c: CompareColumn) => string }> = [
  {
    label: "Positioning",
    value: (c) =>
      [c.positioning.category, c.positioning.summary].filter(Boolean).join(" · ") || DASH,
  },
  { label: "Price band", value: pricingText },
  { label: "Plans", value: plansText },
  { label: "Hiring", value: hiringText },
  { label: "Reviews", value: reviewsText },
  { label: "Stack", value: (c) => (techOf(c).length ? techOf(c).join(", ") : DASH) },
  { label: "Website", value: (c) => c.url ?? DASH },
  { label: "Latest move", value: moveText },
];

function buildMatrix(cols: CompareColumn[]): { header: string[]; body: string[][] } {
  return {
    header: ["", ...cols.map((c) => c.name)],
    body: FIELDS.map((f) => [f.label, ...cols.map((c) => f.value(c))]),
  };
}

export function toDelimited(cols: CompareColumn[], sep: string): string {
  const { header, body } = buildMatrix(cols);
  const esc = (v: string) =>
    sep === "," && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v.replace(/\n/g, " ");
  return [header, ...body].map((line) => line.map(esc).join(sep)).join("\n");
}

export function toMarkdown(cols: CompareColumn[]): string {
  const { header, body } = buildMatrix(cols);
  const esc = (v: string) => v.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const fmt = (line: string[]) => `| ${line.map(esc).join(" | ")} |`;
  const divider = `| ${header.map(() => "---").join(" | ")} |`;
  return [fmt(header), divider, ...body.map(fmt)].join("\n");
}
