"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Threat level (gap-F): bucket the composite threat score (severity × overlap ×
// relevance) into a 3-bar meter so the feed order is legible per signal.
function threatBars(score: number): number {
  if (score >= 0.4) return 3;
  if (score >= 0.2) return 2;
  return 1;
}

/** Discreet 3-bar meter — muted bars, meant to sit in a quiet meta line. */
export function ThreatMeter({ score }: { score: number }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-end gap-px" aria-label="Threat level">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={cn(
                "w-[3px] rounded-sm",
                i === 0 ? "h-1.5" : i === 1 ? "h-2" : "h-2.5",
                // An unlit bar is the denominator — 1 of 3 only means something if
                // you can see the other two. bg-border put them at 1.3:1.
                i < threatBars(score) ? "bg-foreground" : "bg-stroke",
              )}
            />
          ))}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        Threat level: severity × competitor overlap × relevance
      </TooltipContent>
    </Tooltip>
  );
}
