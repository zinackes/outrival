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
}: {
  severity: Severity;
  layout?: "inline" | "column";
}) {
  const active = BANDS.indexOf(severity);

  return (
    <span
      role="img"
      aria-label={`Severity ${severity} — band ${active + 1} of 4`}
      className={cn(
        "flex",
        layout === "column"
          ? "flex-col items-start gap-1.5 @2xl:items-end"
          : "items-center gap-2",
      )}
    >
      <span className="flex items-center gap-[3px]" aria-hidden>
        {BANDS.map((band, i) => (
          <span
            key={band}
            className={cn(
              "h-3.5 w-1 rounded-sm",
              // border-strong, not border: an unlit tick still has to read as a
              // step on the scale, otherwise "high" loses its "out of what".
              i <= active ? FILL[severity] : "bg-border-strong",
            )}
          />
        ))}
      </span>
      <span
        className={cn(
          "text-dense font-semibold capitalize leading-none",
          INK[severity],
        )}
      >
        {severity}
      </span>
    </span>
  );
}
