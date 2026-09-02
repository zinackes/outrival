"use client";

import { format, isSameDay } from "date-fns";
import { aggregateCaptureFreshness, type MonitorFreshnessInput } from "@outrival/shared";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PANEL, PanelHead, PanelRow } from "@/components/outrival/signal-proof";
import { cn } from "@/lib/utils";
import { useHydrated } from "@/hooks/use-hydrated";
import { nowOnClock, onClock } from "@/lib/hydration-clock";

/** "today at 09:12" when it is today, "Jul 30, 14:02" when it isn't.
 *
 *  `local` is the caller's `useHydrated()`: both the hour and the "is this today"
 *  test read the runtime's timezone, which is UTC on the server and the viewer's in
 *  the browser, so an unguarded call renders two different strings across hydration
 *  (`code:PER-24`). The first pass prints the UTC reading both sides derive, the
 *  viewer's own replaces it on mount. See `@/lib/hydration-clock`. */
function stamp(iso: string, local: boolean): string {
  const d = onClock(iso, local);
  return isSameDay(d, nowOnClock(local))
    ? `today, ${format(d, "HH:mm")}`
    : format(d, "MMM d, HH:mm");
}

/**
 * What a dated tab is actually showing, and when we last managed to read it
 * (Véracité Intelligence v2 P4).
 *
 * A tab renders whatever the last successful capture left behind, and until now it
 * said so nowhere: a page we confirmed this morning and a page we have not been
 * able to open since Aug 2 both rendered as plain, undated content. The chip dates
 * the content, and its degraded variant says the second thing out loud.
 *
 * One component for the four dated tabs, and one rule with the Sources page: both
 * read `captureFreshness`, so "not verified since" appears on the chip exactly when
 * the row underneath it says "Not verified for N days". Renders nothing when there
 * is no source behind the tab to date.
 */
export function AsOf({
  monitors,
  nextRunAt,
  className,
}: {
  /** The monitors backing this tab. Folded to the oldest read, the stalest wins. */
  monitors: Array<MonitorFreshnessInput & { nextRunAt?: string | null }>;
  /**
   * When the tab's earliest scheduled read is. Optional: a null or past value means
   * "on the next hourly tick", which the panel words rather than printing as a date.
   */
  nextRunAt?: string | null;
  className?: string;
}) {
  const local = useHydrated();
  const fresh = aggregateCaptureFreshness(monitors);
  // Nothing captured yet is not a date, and "as of never" is not a sentence. The
  // tab's own empty state already says the source has not run.
  if (!fresh?.lastSuccessAt) return null;

  const degraded = !fresh.verified;
  const next = nextRunAt ? new Date(nextRunAt) : null;

  return (
    <Tooltip>
      <TooltipTrigger
        className={cn(
          "shrink-0 cursor-default whitespace-nowrap rounded-sm px-1.5 py-0.5 text-meta tabular-nums",
          "underline decoration-dotted underline-offset-2",
          degraded ? "text-medium" : "text-muted-foreground",
          className,
        )}
      >
        as of {stamp(fresh.lastSuccessAt, local)}
        {degraded && " · not verified since"}
      </TooltipTrigger>
      <TooltipContent className={PANEL}>
        <PanelHead>What you are looking at</PanelHead>
        <PanelRow label="Last successful read" value={stamp(fresh.lastSuccessAt, local)} />
        {degraded ? (
          fresh.lastAttemptAt && (
            <PanelRow label="Last attempt" value={`${stamp(fresh.lastAttemptAt, local)}, failed`} />
          )
        ) : (
          <PanelRow
            label="Next scheduled read"
            value={
              next && next.getTime() > Date.now()
                ? stamp(next.toISOString(), local)
                : "within the hour"
            }
          />
        )}
        {degraded && (
          <p className="pt-1 text-muted-foreground">
            We are still trying. Until it works, this tab shows what we last saw.
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
