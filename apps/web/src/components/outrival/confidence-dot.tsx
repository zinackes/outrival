"use client";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type Confidence = "low" | "medium" | "high";

// Mirror of the FreshnessDot pattern (patch-14), for AI self-reported confidence
// (patch-24). Deliberately sober: it renders NOTHING when confidence is high, so a
// dot only ever draws the eye to an output that genuinely warrants a second look.
const CONFIG: Record<Exclude<Confidence, "high">, { dot: string; label: string; why: string }> = {
  low: {
    dot: "bg-medium",
    label: "Low confidence",
    why: "The AI didn't have enough evidence to be certain. Treat this as a hypothesis, not a fact.",
  },
  medium: {
    dot: "bg-muted-foreground",
    label: "Moderate confidence",
    why: "The AI inferred this reasonably, but with some extrapolation. Worth a quick sanity check.",
  },
};

interface ConfidenceDotProps {
  confidence: Confidence;
  /** Extra context appended to the tooltip (e.g. the task name). */
  context?: string;
  size?: "sm" | "md";
  className?: string;
}

export function ConfidenceDot({ confidence, context, size = "sm", className }: ConfidenceDotProps) {
  // Visibility rule: show only below the configured threshold (default "high").
  const threshold = process.env.NEXT_PUBLIC_CONFIDENCE_DOT_THRESHOLD ?? "high";
  if (confidence === "high") return null;
  if (threshold === "medium" && confidence !== "low") return null;

  const { dot, label, why } = CONFIG[confidence];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          tabIndex={0}
          aria-label={label}
          className={cn(
            "inline-block shrink-0 rounded-full cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5",
            dot,
            className,
          )}
        />
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px]">
        {/* 3-part message (patch-14): what we did · why · what to do. */}
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{` · ${why}`}</span>
        {context && <span className="text-muted-foreground">{` ${context}`}</span>}
      </TooltipContent>
    </Tooltip>
  );
}
