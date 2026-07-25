import { cn } from "@/lib/utils";

/**
 * Daily signal counts as bare CSS bars, oldest first.
 *
 * A percentage cannot tell "eleven quiet days then four loud ones" from a steady
 * hum, and that shape is what says whether something is building. Recharts is not
 * worth its weight here: fifty roster rows would mount fifty chart runtimes for
 * fourteen rectangles each, so these are divs.
 *
 * Today's bar carries the foreground tone when it fired, which marks the right
 * edge as now rather than leaving the series floating. A row with no activity
 * renders every bar at its 2px floor, so it reads as a baseline instead of blank.
 */
export function ActivitySpark({
  values,
  className,
  label,
}: {
  values: number[];
  className?: string;
  label: string;
}) {
  const max = Math.max(1, ...values);
  const last = values.length - 1;

  return (
    <span
      role="img"
      aria-label={label}
      className={cn("flex h-4 items-end gap-px", className)}
    >
      {values.map((v, i) => (
        <span
          key={i}
          className={cn(
            "min-h-0.5 flex-1 rounded-[1px]",
            i === last && v > 0 ? "bg-foreground" : "bg-border-strong",
          )}
          style={{ height: `${Math.max(2, Math.round((v / max) * 16))}px` }}
        />
      ))}
    </span>
  );
}
