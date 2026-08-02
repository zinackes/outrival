import { cn } from "@/lib/utils";

type Severity = "low" | "medium" | "high" | "critical";

const BANDS: Severity[] = ["low", "medium", "high", "critical"];

const FILL: Record<Severity, string> = {
  low: "bg-low",
  medium: "bg-medium",
  high: "bg-high",
  critical: "bg-critical",
};

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
 * the scale is showing the reasoning. The ticks are equal height on purpose:
 * this is a position on a scale, not a magnitude like the threat meter's
 * ascending bars, and the two must not be mistaken for each other.
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
              compact ? "h-2.5 w-[3px]" : "h-3.5 w-1",
              // border-strong, not border: an unlit tick still has to read as a
              // step on the scale, otherwise "high" loses its "out of what".
              i <= active ? FILL[severity] : "bg-border-strong",
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
            // Same unlit treatment as the scale: an unlit band still has to read
            // as a step, otherwise "high" loses its "out of what".
            "h-[3px] rounded-[1px]",
            severity && i <= active ? FILL[severity] : "bg-border-strong",
          )}
        />
      ))}
    </span>
  );
}
