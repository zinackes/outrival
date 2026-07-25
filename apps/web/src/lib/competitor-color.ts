import type { CSSProperties } from "react";
import { COMPETITOR_COLORS, resolveCompetitorColor } from "@outrival/shared";

// CSS color expressions that combine the per-competitor hue/chroma vars (set inline,
// see competitorColorVars) with the per-theme lightness roles from globals.css. These
// strings are constant — only the --comp-h / --comp-c vars change per competitor, and
// the theme picks the lightness — so one expression renders correctly in dark & light.
export const COMP_ACCENT =
  "oklch(var(--comp-l-accent) var(--comp-c) var(--comp-h))";
export const COMP_FILL =
  "oklch(var(--comp-l-fill) calc(var(--comp-c) * var(--comp-fill-chroma-mult)) var(--comp-h))";
export const COMP_ON_FILL =
  "oklch(var(--comp-l-on-fill) var(--comp-c) var(--comp-h))";
// The competitor name tinted inline. Uses the AA-tuned text lightness (see
// --comp-l-text in globals.css) — a darker accent than COMP_ACCENT so the name
// clears 4.5:1 as body text, not just 3:1 as a graphical edge.
export const COMP_TEXT =
  "oklch(var(--comp-l-text) var(--comp-c) var(--comp-h))";

export type CompetitorColorVars = CSSProperties & {
  "--comp-h"?: number;
  "--comp-c"?: number;
};

/**
 * Inline style that sets the per-competitor hue/chroma CSS vars, or null when the
 * competitor has no color (caller renders the neutral look). Spread onto the element
 * that uses COMP_ACCENT / COMP_FILL / COMP_ON_FILL.
 */
export function competitorColorVars(
  color: string | null | undefined,
): CompetitorColorVars | null {
  const resolved = resolveCompetitorColor(color);
  if (!resolved) return null;
  return { "--comp-h": resolved.h, "--comp-c": resolved.c };
}

// Palette hues handed out when a competitor carries no user-assigned color but the UI
// still has to tell N series apart. `slate` sits this one out: at chroma 0.025 it
// renders as the neutral grey the fallback exists to escape.
const SERIES_TOKENS = COMPETITOR_COLORS.filter((c) => c.chroma > 0.05).map((c) => c.token);

/**
 * Per-entity color for a compared SET (compare page): an explicit color always wins,
 * and everyone else borrows the next palette hue not already taken in the set — the
 * same trick products use for their identity (see product-color.ts).
 *
 * Without this a workspace that never opened the color picker draws every bar in the
 * same neutral grey, which is a chart whose series cannot be told apart. Deterministic
 * in the set's order, so a row keeps its hue across re-renders and across lenses.
 * Your own product is left alone: it wears the accent everywhere.
 */
export function assignSeriesColors(
  rows: ReadonlyArray<{ id: string; color: string | null; mine?: boolean }>,
): Map<string, string | null> {
  const taken = new Set(rows.map((r) => r.color).filter((c): c is string => Boolean(c)));
  const out = new Map<string, string | null>();
  let cursor = 0;
  for (const row of rows) {
    if (row.mine || row.color) {
      out.set(row.id, row.color);
      continue;
    }
    while (cursor < SERIES_TOKENS.length && taken.has(SERIES_TOKENS[cursor] as string)) cursor++;
    // More rows than hues can't happen at the current cap of six, but wrapping beats
    // handing out `undefined`.
    out.set(row.id, SERIES_TOKENS[cursor % SERIES_TOKENS.length] as string);
    cursor++;
  }
  return out;
}

/**
 * Style that tints a competitor's NAME text with its color, or undefined when the
 * competitor has no color (the name keeps its inherited foreground). Drop directly
 * on the element that renders the name.
 */
export function competitorNameColor(
  color: string | null | undefined,
): CompetitorColorVars | undefined {
  const vars = competitorColorVars(color);
  if (!vars) return undefined;
  return { ...vars, color: COMP_TEXT };
}
