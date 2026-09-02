"use client";

import { format, formatDistanceToNow } from "date-fns";
import { SpinnerIcon } from "@/components/icons";
import {
  computeFreshness,
  computeFreshnessState,
  type FreshnessLevel,
  type FreshnessState,
  type FreshnessStatus,
  type SourceType,
} from "@outrival/shared";
import { cn } from "@/lib/utils";
import { useHydrated } from "@/hooks/use-hydrated";
import { onClock } from "@/lib/hydration-clock";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Static class strings so Tailwind's JIT keeps them. Colours map to the severity
// scale (design-system), distinct from the cyan brand accent.
const CONFIG: Record<FreshnessLevel, { dot: string; label: string }> = {
  fresh: { dot: "bg-positive", label: "Up to date" },
  aging: { dot: "bg-medium", label: "Aging" },
  stale: { dot: "bg-high", label: "Stale" },
  failed: { dot: "bg-critical", label: "Last scan failed" },
  // Hollow, not filled: this is the absence of a surface, not a severity. It carries
  // no hue at all so it can never be read as a source we are collecting.
  none: { dot: "border border-muted-foreground/60", label: "No such surface" },
};

// patch-27 — the actionable 4-state scale (per-source-type thresholds). Same
// design-system severity colours as the legacy levels so the two modes look
// consistent on screen.
const STATE_CONFIG: Record<FreshnessState, { dot: string; label: string }> = {
  fresh: { dot: "bg-positive", label: "Up to date" },
  yellow: { dot: "bg-medium", label: "Worth a look" },
  orange: { dot: "bg-high", label: "Stale" },
  red: { dot: "bg-critical", label: "Very stale" },
};

interface FreshnessDotProps {
  lastScrapedAt: string | null;
  status: FreshnessStatus | null;
  // When the next scheduled scan is due. Surfaced in the tooltip so the user knows
  // not just how old the data is but when it refreshes next. Optional — callers
  // without a schedule (e.g. an aggregate dot) just omit it.
  nextRunAt?: string | null;
  className?: string;
  // patch-27 — opt-in actionable mode. When `sourceType` is provided the dot
  // uses the per-source-type thresholds and, on orange/red, can show an inline
  // "Re-scan" affordance (gated by `canForceRescan`, wired by the caller's hook).
  sourceType?: SourceType;
  canForceRescan?: boolean;
  onForceRescan?: () => void;
  rescanning?: boolean;
  size?: "sm" | "md";
}

// A subtle freshness pastille (patch-14). Default state is just a coloured dot —
// the exact date stays in the tooltip (progressive disclosure: no timestamp
// pollution inline). Reused per-section on the competitor page and as one global
// dot per competitor on the list. Patch-27 layers an actionable variant on top.
export function FreshnessDot({
  lastScrapedAt,
  status,
  nextRunAt,
  className,
  sourceType,
  canForceRescan,
  onForceRescan,
  rescanning,
  size = "sm",
}: FreshnessDotProps) {
  const dotSize = size === "md" ? "h-2.5 w-2.5" : "h-2 w-2";
  // The stamp below prints an hour, which reads on the runtime's timezone: UTC on
  // the server, the viewer's in the browser. It rides an `aria-label`, so the
  // mismatch is an attribute one and lands on a value only a screen reader hears —
  // suppressing the warning would leave that reader on UTC for good (`code:PER-24`).
  // First paint prints the UTC reading, the viewer's own arrives on mount.
  const local = useHydrated();
  const scanned = lastScrapedAt
    ? format(onClock(lastScrapedAt, local), "MMM d, yyyy 'at' HH:mm")
    : null;

  // "Next scan in ~3 days" — only when a future schedule is known.
  const nextTs = nextRunAt ? new Date(nextRunAt).getTime() : null;
  const nextLine =
    nextTs && !Number.isNaN(nextTs) && nextTs > Date.now() ? (
      <span className="mt-1 block text-muted-foreground">
        Next scan {formatDistanceToNow(new Date(nextTs), { addSuffix: true })}
      </span>
    ) : null;

  // What a failed scan IMPLIES, which the two words on their own never said: the
  // page is not broken and not empty, it is frozen at the capture whose date sits on
  // the line right above. Shown whenever the last attempt failed, including when the
  // frozen data is still fresh and the dot is therefore no longer red.
  const failedLine =
    status === "failed" ? (
      <span className="mt-1 block max-w-[14rem] text-muted-foreground">
        The latest scan failed, so this is the last successful capture.
      </span>
    ) : null;
  const failedSuffix = status === "failed" ? " · latest scan failed" : "";

  // Legacy patch-14 path — unchanged behaviour for callers that don't opt in. A
  // surface the competitor doesn't have takes it too, whatever the caller asked for:
  // there is no age to grade and no re-scan worth offering on a page that isn't
  // there, so the actionable variant has nothing to add.
  if (!sourceType || status === "not_available") {
    const level = computeFreshness(lastScrapedAt, status);
    const { dot, label } = CONFIG[level];
    // Already the headline on a "failed" level; repeating it would read twice.
    const spoken = level === "failed" ? label : `${label}${failedSuffix}`;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            tabIndex={0}
            aria-label={
              lastScrapedAt
                ? `${spoken} · last scan ${scanned}`
                : spoken
            }
            className={cn(
              "inline-block shrink-0 rounded-full cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              dotSize,
              dot,
              className,
            )}
          />
        </TooltipTrigger>
        <TooltipContent>
          <span className="font-medium">{label}</span>
          {lastScrapedAt && (
            <span className="text-muted-foreground">
              {" · Last scan "}
              {scanned}
            </span>
          )}
          {failedLine}
          {nextLine}
        </TooltipContent>
      </Tooltip>
    );
  }

  // patch-27 actionable path. Same rule as `computeFreshness`: a failed last scan
  // only takes the dot once the capture it froze has aged out. While that capture is
  // still fresh the data on screen IS current, and age + source type decide.
  const { state, ageDays } = computeFreshnessState(lastScrapedAt, sourceType);
  const effective: FreshnessState = status === "failed" && state !== "fresh" ? "red" : state;
  const { dot } = STATE_CONFIG[effective];
  const ageLabel = Number.isFinite(ageDays) ? `${ageDays}d` : "never";
  const headline =
    status === "failed" && effective === "red"
      ? "Last scan failed"
      : effective === "fresh"
        ? "Up to date"
        : `${STATE_CONFIG[effective].label} · ${ageLabel}`;
  // Already the headline when the failure won the dot; repeating it would read twice.
  const spokenHeadline =
    headline === "Last scan failed" ? headline : `${headline}${failedSuffix}`;

  const dotEl = (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          tabIndex={0}
          aria-label={
            lastScrapedAt
              ? `${spokenHeadline} · last scan ${scanned}`
              : spokenHeadline
          }
          className={cn(
            "inline-block shrink-0 rounded-full cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            dotSize,
            dot,
          )}
        />
      </TooltipTrigger>
      <TooltipContent>
        <span className="font-medium">{headline}</span>
        {lastScrapedAt && (
          <span className="text-muted-foreground">
            {" · Last scan "}
            {scanned}
          </span>
        )}
        {failedLine}
        {/* 3-part message (patch-14): age → consequence → action. */}
        {(effective === "orange" || effective === "red") && (
          <span className="mt-1 block max-w-[14rem] text-muted-foreground">
            This data may no longer reflect the competitor. Re-scan to refresh now.
          </span>
        )}
        {nextLine}
      </TooltipContent>
    </Tooltip>
  );

  // fresh / yellow → just the indicator. orange / red → indicator + inline action.
  const showAction =
    (effective === "orange" || effective === "red") && canForceRescan && onForceRescan;
  if (!showAction) {
    return <span className={cn("inline-flex", className)}>{dotEl}</span>;
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {dotEl}
      <button
        type="button"
        onClick={onForceRescan}
        disabled={rescanning}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
      >
        {rescanning && <SpinnerIcon className="h-4 w-4 animate-spin" aria-hidden />}
        {rescanning ? "Re-scanning…" : "Re-scan"}
      </button>
    </span>
  );
}
