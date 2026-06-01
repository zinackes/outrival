"use client";

import { format } from "date-fns";
import { computeFreshness, type FreshnessLevel } from "@outrival/shared";
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

interface FreshnessDotProps {
  lastScrapedAt: string | null;
  status: "success" | "failed" | null;
  className?: string;
}

// A subtle freshness pastille (patch-14). Default state is just a coloured dot —
// the exact date stays in the tooltip (progressive disclosure: no timestamp
// pollution inline). Reused per-section on the competitor page and as one global
// dot per competitor on the list.
export function FreshnessDot({ lastScrapedAt, status, className }: FreshnessDotProps) {
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
            "inline-block h-[7px] w-[7px] shrink-0 rounded-full cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
