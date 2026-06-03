"use client";

import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import {
  computeFreshness,
  computeFreshnessState,
  type FreshnessLevel,
  type FreshnessState,
  type SourceType,
} from "@outrival/shared";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Static class strings so Tailwind's JIT keeps them. Colours map to the severity
// scale (design-system), distinct from the amber brand accent.
const CONFIG: Record<FreshnessLevel, { dot: string; label: string }> = {
  fresh: { dot: "bg-positive", label: "Up to date" },
  aging: { dot: "bg-medium", label: "Aging" },
  stale: { dot: "bg-high", label: "Stale" },
  failed: { dot: "bg-critical", label: "Last scan failed" },
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
  status: "success" | "failed" | null;
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
  className,
  sourceType,
  canForceRescan,
  onForceRescan,
  rescanning,
  size = "sm",
}: FreshnessDotProps) {
  const dotSize = size === "md" ? "h-2.5 w-2.5" : "h-[7px] w-[7px]";

  // Legacy patch-14 path — unchanged behaviour for callers that don't opt in.
  if (!sourceType) {
    const level = computeFreshness(lastScrapedAt, status);
    const { dot, label } = CONFIG[level];
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            tabIndex={0}
            aria-label={
              lastScrapedAt
                ? `${label} · last scan ${format(new Date(lastScrapedAt), "MMM d, yyyy 'at' HH:mm")}`
                : label
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
              {format(new Date(lastScrapedAt), "MMM d, yyyy 'at' HH:mm")}
            </span>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  // patch-27 actionable path. A failed last scan still wins (the data on screen
  // is whatever the previous success left), otherwise age + source type decide.
  const { state, ageDays } = computeFreshnessState(lastScrapedAt, sourceType);
  const effective: FreshnessState = status === "failed" ? "red" : state;
  const { dot } = STATE_CONFIG[effective];
  const ageLabel = Number.isFinite(ageDays) ? `${ageDays}d` : "never";
  const headline =
    status === "failed"
      ? "Last scan failed"
      : effective === "fresh"
        ? "Up to date"
        : `${STATE_CONFIG[effective].label} · ${ageLabel}`;

  const dotEl = (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          tabIndex={0}
          aria-label={
            lastScrapedAt
              ? `${headline} · last scan ${format(new Date(lastScrapedAt), "MMM d, yyyy 'at' HH:mm")}`
              : headline
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
            {format(new Date(lastScrapedAt), "MMM d, yyyy 'at' HH:mm")}
          </span>
        )}
        {/* 3-part message (patch-14): age → consequence → action. */}
        {(effective === "orange" || effective === "red") && (
          <span className="mt-1 block max-w-[14rem] text-muted-foreground">
            This data may no longer reflect the competitor. Re-scan to refresh now.
          </span>
        )}
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
        {rescanning && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
        {rescanning ? "Re-scanning…" : "Re-scan"}
      </button>
    </span>
  );
}
