import type { SeriesPaint } from "@/lib/series-color";

/**
 * The mark that stands for one competitor's line, drawn wherever the line is named
 * rather than plotted: the chart key, the tooltip rows, the filter menu.
 *
 * An SVG line rather than a coloured span, because the paint carries a dash once the
 * palette laps and a `background` cannot render one. A key whose swatch is solid
 * beside a plotted line that is dashed points at the wrong series, which is worse
 * than no swatch at all.
 */
export function SeriesSwatch({ paint }: { paint: SeriesPaint }) {
  return (
    <svg
      aria-hidden
      width={14}
      height={2}
      viewBox="0 0 14 2"
      className="shrink-0 overflow-visible"
    >
      <line
        x1="0"
        x2="14"
        y1="1"
        y2="1"
        stroke={paint.stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={paint.dash}
      />
    </svg>
  );
}
