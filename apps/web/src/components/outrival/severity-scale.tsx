import { cn } from "@/lib/utils";

type Severity = "low" | "medium" | "high" | "critical";

const BANDS: Severity[] = ["low", "medium", "high", "critical"];

const FILL: Record<Severity, string> = {
  low: "bg-low",
  medium: "bg-medium",
  high: "bg-high",
  critical: "bg-critical",
};

/**
 * An unlit step: --stroke, and SHORT — roughly 60% of a lit tick, across the
 * scale's axis so the step keeps its slot and the denominator survives.
 *
 * stroke, not border-strong: an unlit tick still has to read as a step,
 * otherwise "high" loses its "out of what" — and border-strong only ever
 * reached 2:1, which is not a step you can see.
 *
 * Length carries lit-vs-unlit because in light mode colour cannot. Both edges
 * are pinned from opposite sides: --stroke is already at the ceiling that keeps
 * an unlit tick at 3:1 on every surface (3.08 on surface-3, WCAG 1.4.11), and
 * the lit colours are dark enough to double as text ink. What is left between
 * them is 1.30:1 for medium and 1.37 for high (1.71 critical, 2.04 low) —
 * against 1.8 to 3.4 in dark mode, which is why this only ever read as a
 * light-mode fault. In the signals list the gauge carries severity with no
 * label beside it, so "how many are lit" cannot be a colour judgement.
 *
 * Ratios from scripts/check-contrast.mjs's math on the current tokens; the
 * --stroke floor itself is asserted there.
 */
const UNLIT = "bg-stroke";

const INK: Record<Severity, string> = {
  low: "text-low",
  medium: "text-medium",
  high: "text-high",
  critical: "text-critical",
};

/**
 * Severity read as the four-band scale it actually is.
 *
 * A lone badge tells you "high" without telling you high out of what — and the
 * band is now a deterministic function of the materiality sub-scores, so showing
 * the scale is showing the reasoning. The lit ticks are all equal height on
 * purpose: this is a position on a scale, not a magnitude like the threat
 * meter's ascending bars, and the two must not be mistaken for each other. Only
 * the unlit ticks are short (see the tick below) — that is a lit/unlit cue, not
 * a ramp.
 *
 * Stacked (`column`) it sits in the detail pane's margin; inline it fits a row.
 */
export function SeverityScale({
  severity,
  layout = "inline",
  size = "default",
}: {
  severity: Severity;
  layout?: "inline" | "column";
  // "compact" for dense rows (the competitor Activity feed), where the scale is
  // one of several marks on a line rather than the pane's headline. Ticks and
  // label shrink together so the object keeps its proportions.
  size?: "default" | "compact";
}) {
  const active = BANDS.indexOf(severity);
  const compact = size === "compact";

  return (
    <span
      role="img"
      aria-label={`Severity ${severity}, band ${active + 1} of 4`}
      className={cn(
        "flex",
        layout === "column"
          ? "flex-col items-start gap-1.5 @2xl:items-end"
          : cn("items-center", compact ? "gap-1.5" : "gap-2"),
      )}
    >
      <span className={cn("flex items-center", compact ? "gap-[2px]" : "gap-[3px]")} aria-hidden>
        {BANDS.map((band, i) => (
          <span
            key={band}
            className={cn(
              "rounded-sm",
              compact ? "w-[3px]" : "w-1",
              i <= active
                ? cn(compact ? "h-2.5" : "h-3.5", FILL[severity])
                : cn(compact ? "h-1.5" : "h-2", UNLIT),
            )}
          />
        ))}
      </span>
      <span
        className={cn(
          "font-semibold capitalize leading-none",
          compact ? "text-xs" : "text-dense",
          INK[severity],
        )}
      >
        {severity}
      </span>
    </span>
  );
}

/**
 * The same four bands stood upright, filling from the floor: the master-list form
 * of the scale above.
 *
 * A list gutter can't wear the inline scale, even compact. Four 2px ticks repeated
 * down fifty rows read as a picket fence, and "three lit or four?" is a count
 * rather than a glance. Upright, the band reads as a height, and a mark that is
 * taller than it is wide sits quieter beside two lines of text — which is what a
 * gutter owes the row it annotates. There is no label: the row has no width to
 * spare, and the gauge repeats every 44px, so the reader learns it once.
 *
 * In the signals list it sits UNDER the competitor's mark: identity first, then
 * the verdict on it. The selection checkbox overlays the mark above, never this
 * (see SignalRow `selecting`), so the band stays lit while a selection is live.
 */
export function SeverityGauge({
  severity,
  className,
}: {
  // null renders the scale with nothing lit — the competitors roster uses it for a
  // competitor that has not moved, where "no band" is the reading, and an empty
  // gutter would just look like a missing element.
  severity: Severity | null;
  className?: string;
}) {
  const active = severity ? BANDS.indexOf(severity) : -1;

  return (
    <span
      role="img"
      aria-label={
        severity ? `Severity ${severity}, band ${active + 1} of 4` : "No severity"
      }
      className={cn("flex w-2.5 flex-col-reverse gap-px", className)}
    >
      {BANDS.map((band, i) => (
        <span
          key={band}
          className={cn(
            "h-[3px] rounded-[1px]",
            // Same unlit treatment as the scale (see UNLIT): short across the
            // axis — here the bands stack, so an unlit one is a centred stub and
            // the lit ones run the full 10px. Lit reads as one mass rather than
            // a rung of a uniform ladder, which is what the light-mode palette
            // could not give on colour alone.
            severity && i <= active
              ? cn("w-full", FILL[severity])
              : cn("w-1.5 self-center", UNLIT),
          )}
        />
      ))}
    </span>
  );
}
