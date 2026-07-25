"use client";

/**
 * Hover motion shared by the dashboard's recharts plots.
 *
 * Reading a value off a chart means hovering it, and every piece of that readout
 * used to teleport: the tooltips ran with `isAnimationActive={false}`, and the
 * crosshair and the active dots are redrawn at their new coordinates on every
 * pointer move. Sweeping across a plot therefore strobed instead of dragging one
 * readout along the series, and arriving on it dropped the whole thing in at
 * once. Everything that follows the pointer now slides at the system's fast
 * duration and fades in on arrival, so the eye stays locked on the same object
 * while it moves. Reduced-motion readers keep the instant behaviour via the
 * global rule in `globals.css`.
 */

/** Spread onto a recharts `<Tooltip>`. `auto` = recharts skips it under reduced motion. */
export const chartTooltipMotion = {
  isAnimationActive: "auto",
  animationDuration: 150,
  animationEasing: "ease-out",
} as const;

/**
 * Enter-fade for a custom tooltip card. A card that returns null while inactive
 * unmounts between hovers, which is what makes the animation replay on arrival.
 * Opacity only (`globals.css`), not `animate-in`: that keyframe resets `transform`
 * as well, which would drag anything positioned with one in from the origin.
 */
export const chartTooltipCardMotion = "chart-hover-fade";

/** What recharts hands a custom cursor element on a cartesian plot. */
interface CursorPoint {
  x?: number;
  y?: number;
}

const slide = "chart-hover-fade transition-transform duration-150 ease-out";

/**
 * Crosshair for the line/area plots, drawn at x=0 and moved with a CSS
 * transform: recharts moves its own cursor by rewriting the path's `d`, which no
 * engine can transition, while `transform` on an SVG element is a real animatable
 * property.
 */
export function ChartCursorLine({ points }: { points?: CursorPoint[] }) {
  const x = points?.[0]?.x;
  const top = points?.[0]?.y;
  const bottom = points?.[1]?.y;
  if (x == null || top == null || bottom == null) return null;

  return (
    <line
      x1={0}
      x2={0}
      y1={top}
      y2={bottom}
      stroke="var(--muted-foreground)"
      strokeWidth={1}
      strokeDasharray="2 3"
      strokeOpacity={0.5}
      className={slide}
      style={{ transform: `translateX(${x}px)` }}
    />
  );
}

/**
 * Same, for the bar plots: there the cursor is a band the width of one bucket,
 * so it slides from bucket to bucket rather than blinking between them.
 */
export function ChartCursorBand({
  x,
  y,
  width,
  height,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}) {
  if (x == null || y == null || width == null || height == null) return null;

  return (
    <rect
      x={0}
      y={y}
      width={width}
      height={height}
      fill="var(--foreground)"
      fillOpacity={0.06}
      className={slide}
      style={{ transform: `translateX(${x}px)` }}
    />
  );
}
