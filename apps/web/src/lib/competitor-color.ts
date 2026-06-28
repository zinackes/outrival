import type { CSSProperties } from "react";
import { resolveCompetitorColor } from "@outrival/shared";

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

/**
 * Style for a colored 3px left-edge accent on a card/row, or undefined when the
 * competitor has no color (the element keeps its default border). Drop directly on
 * an element that already has a 1px border.
 */
export function competitorLeftBorder(
  color: string | null | undefined,
): CompetitorColorVars | undefined {
  const vars = competitorColorVars(color);
  if (!vars) return undefined;
  return { ...vars, borderLeftWidth: 3, borderLeftColor: COMP_ACCENT };
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
