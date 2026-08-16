"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { agePhrase } from "@/components/dashboard/compare/derive";

/**
 * Where one number came from, and when we last read it (OUT-194).
 *
 * The audit of 2026-08-14 found the profile stating captured figures with the same
 * confidence as live ones, so a price read three months ago and a price read this
 * morning were indistinguishable. Every datum that carries a capture instant now
 * wears it: the reader can date the claim without opening the source tab.
 *
 * `at` null means we hold the datum but not when it was read (an older capture, a
 * manual entry). The badge then names the surface only — silence would read as
 * "fresh", and a made-up date would be worse.
 */
export function SeenBadge({
  source,
  at,
  compact = false,
  className,
}: {
  /** The surface the figure was read off: "their pricing page", "G2", "their jobs board". */
  source: string;
  /** ISO instant of that read, or null when the capture carries none. */
  at: string | null;
  /** Age only, for a cell that has no room for the sentence. The source moves to the tooltip. */
  compact?: boolean;
  className?: string;
}) {
  const age = at ? agePhrase(at) : null;
  const label = compact
    ? (age ?? "undated")
    : age
      ? `Seen on ${source} ${age}`
      : `Seen on ${source}`;
  const exact = at
    ? new Date(at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;
  const tip = exact ? `Read off ${source} on ${exact}` : `Read off ${source}, capture undated`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-meta text-muted-foreground",
              className,
            )}
          >
            <span
              aria-hidden
              className={cn("size-1 rounded-full", at ? "bg-muted-foreground" : "bg-border")}
            />
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent>{tip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
