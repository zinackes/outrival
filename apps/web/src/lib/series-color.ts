import { resolveCompetitorColor } from "@outrival/shared";

// Data-viz line palette fallback for a competitor with no assigned colour.
const FALLBACK_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

/**
 * The stroke for one competitor's series, and the swatch its chart key draws.
 *
 * A stored colour becomes an OKLCH expression built on `--comp-l-accent`, the same
 * lightness role the avatars and name tints use, so one string renders correctly in
 * both themes without reading the theme in JS.
 *
 * Lives outside the chart module on purpose: the chart lazy-loads recharts, and a
 * static import of anything inside it would pull recharts back into the route's
 * first-load bundle.
 */
export function seriesStroke(color: string | null | undefined, index: number): string {
  const resolved = resolveCompetitorColor(color);
  if (!resolved) return FALLBACK_COLORS[index % FALLBACK_COLORS.length]!;
  return `oklch(var(--comp-l-accent) ${resolved.c} ${resolved.h})`;
}
