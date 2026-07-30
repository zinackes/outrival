/**
 * Deterministic feature-matrix parser (Pricing Intelligence P2) — the
 * structured-first stage of entitlement extraction, staged-extraction
 * philosophy: when the pricing page ships a comparison <table> (columns =
 * plans, rows = features, cells = ✓/✗/values), parse it with zero AI; the AI
 * sister task (extract-entitlements) is only paid when no such table
 * qualifies.
 *
 * The qualification anchor is the KNOWN plan names: a table only counts as the
 * comparison matrix when ≥2 of its header columns match plans the plan
 * extractor already found on this very page. That one rule keeps us out of
 * every other table a pricing page carries (FAQ, currency notes, add-on
 * lists) — and below the bar we return null, never a guess: an invented
 * matrix would diff as a full repackaging next scrape.
 */

import * as cheerio from "cheerio";

// cheerio 1.x doesn't re-export its node type; derive it from the API surface
// (same trick as harvest.ts) instead of importing transitive `domhandler`.
type CheerioSel = ReturnType<ReturnType<ReturnType<typeof cheerio.load>["root"]>["find"]>;
type CheerioEl = CheerioSel extends cheerio.Cheerio<infer E> ? E : never;

export interface ParsedEntitlement {
  plan_name: string;
  /** VERBATIM cell-1 text of the row — the proof string. */
  feature_label: string;
  kind: "boolean" | "config" | "metered";
  value_num: number | null;
  value_text: string | null;
  unit: string | null;
  reset_period: string | null;
}

const MIN_MATCHED_PLAN_COLUMNS = 2;
const MIN_FEATURE_ROWS = 3;

// ✓-family: the cell says "included", nothing more. Multilingual one-worders
// only — anything longer is a value and lands as config text.
const CHECK_TEXT =
  /^(?:✓|✔|✔️|✅|●|yes|oui|sí|si|ja|sim|included|inclus|incluido|incluida|incluso|inclusa|enthalten|inbegrepen|incluído)$/i;
// ✗-family: the cell says "absent" — no entitlement row at all.
const CROSS_TEXT = /^(?:✗|✕|✘|❌|—|–|-|no|non|nein|nee|não|nao|not included|non inclus)?$/i;
const UNLIMITED_TEXT =
  /^(?:unlimited|illimit[ée]s?|unbegrenzt|ilimitad[oa]s?|illimitat[oi]|onbeperkt)$/i;

// "10,000", "10 000", "1.5", "10k", "2M" with surrounding words as the unit.
const LEADING_NUMBER = /^([$€£]?\d[\d\s.,]*)\s*([km])?\b\s*(.*)$/i;

const RESET_PERIOD =
  /\/\s?(?:mo|month|mois|monat|mes|maand)\b|per\s+month|\bmonthly\b|par\s+mois|\/\s?(?:yr|year|an)\b|per\s+year|\byearly\b/i;

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

/** aria-labels and <title>/<img alt> inside icon cells carry the boolean when
 * the visible text is empty (SVG checkmarks). */
function cellSignal($: cheerio.CheerioAPI, cell: CheerioEl): string {
  const $cell = $(cell);
  const text = norm($cell.text());
  if (text) return text;
  const hint =
    $cell.attr("aria-label") ??
    $cell.find("[aria-label]").attr("aria-label") ??
    $cell.find("img[alt]").attr("alt") ??
    $cell.find("title").text();
  return norm(hint ?? "");
}

function parseCellValue(
  raw: string,
): Pick<ParsedEntitlement, "kind" | "value_num" | "value_text" | "unit" | "reset_period"> | "absent" {
  const text = norm(raw);
  if (CROSS_TEXT.test(text)) return "absent";
  if (CHECK_TEXT.test(text)) {
    return { kind: "boolean", value_num: null, value_text: null, unit: null, reset_period: null };
  }
  if (UNLIMITED_TEXT.test(text)) {
    return { kind: "config", value_num: null, value_text: "unlimited", unit: null, reset_period: null };
  }
  const num = text.match(LEADING_NUMBER);
  if (num && num[1]) {
    const base = Number(num[1].replace(/[$€£\s]/g, "").replace(/,/g, ""));
    if (Number.isFinite(base)) {
      const scaled = num[2]?.toLowerCase() === "k" ? base * 1e3 : num[2]?.toLowerCase() === "m" ? base * 1e6 : base;
      const reset = text.match(RESET_PERIOD)?.[0] ?? null;
      const unit = norm((num[3] ?? "").replace(RESET_PERIOD, "")) || null;
      return {
        kind: "metered",
        value_num: scaled,
        value_text: null,
        unit,
        reset_period: reset ? norm(reset.replace(/^\//, "per ")) : null,
      };
    }
  }
  // Any other text is a fixed configuration value ("Email", "24/7", "30 days"
  // falls in the numeric branch above; "Priority" lands here).
  return { kind: "config", value_num: null, value_text: text, unit: null, reset_period: null };
}

/**
 * Parse the page's plan-comparison table into entitlements, or null when no
 * table qualifies. `knownPlanNames` are the plans the plan extractor found on
 * this same capture — the anchor that identifies THE matrix among the page's
 * tables. Multiple qualifying tables (some pages split "Features" / "Security")
 * are concatenated.
 */
export function parseEntitlementTable(
  html: string,
  knownPlanNames: string[],
): ParsedEntitlement[] | null {
  if (knownPlanNames.length === 0) return null;
  const $ = cheerio.load(html);
  const known = knownPlanNames.map((n) => norm(n).toLowerCase());

  const out: ParsedEntitlement[] = [];

  $("table").each((_, table) => {
    const $table = $(table);
    const headerRow = $table.find("thead tr").first().get(0) ?? $table.find("tr").first().get(0);
    if (!headerRow) return;
    const headerCells = $(headerRow).children("th,td").toArray();
    if (headerCells.length < MIN_MATCHED_PLAN_COLUMNS + 1) return;

    // Column i → plan name, when the header cell names a known plan. Header
    // cells often embed the price under the name ("Pro $29/mo"), so match by
    // containment, longest plan name first so "Business Plus" beats "Business".
    const byLength = [...known].sort((a, b) => b.length - a.length);
    const columnPlan = new Map<number, string>();
    headerCells.forEach((cell, i) => {
      if (i === 0) return; // the feature-label column
      const text = norm($(cell).text()).toLowerCase();
      if (!text) return;
      const hit = byLength.find((name) => text.includes(name));
      if (hit === undefined) return;
      const display = knownPlanNames[known.indexOf(hit)]!;
      columnPlan.set(i, display);
    });
    if (columnPlan.size < MIN_MATCHED_PLAN_COLUMNS) return;

    const rows: ParsedEntitlement[] = [];
    // parse5 auto-inserts <tbody>, so a thead-less table's header row lands in
    // the body selection too — exclude it by node identity, not by position.
    const allRows = $table.find("tr").toArray().filter((tr) => tr !== headerRow);
    for (const tr of allRows) {
      const cells = $(tr).children("th,td").toArray();
      // A section header ("SECURITY") spans the width in one or two cells —
      // it is a heading, not a feature.
      if (cells.length < 2) continue;
      const label = norm($(cells[0]!).text());
      if (!label || label.length > 120) continue;
      for (const [col, planName] of columnPlan) {
        const cell = cells[col];
        if (!cell) continue;
        const value = parseCellValue(cellSignal($, cell));
        if (value === "absent") continue;
        rows.push({ plan_name: planName, feature_label: label, ...value });
      }
    }

    // The qualification bar counts FEATURES, not cells: a two-row pseudo-table
    // is not the matrix.
    const featureCount = new Set(rows.map((r) => r.feature_label)).size;
    if (featureCount >= MIN_FEATURE_ROWS) out.push(...rows);
  });

  return out.length > 0 ? out : null;
}
