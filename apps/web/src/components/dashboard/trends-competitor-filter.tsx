"use client";

import { UsersIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { SeriesPaint } from "@/lib/series-color";
import { paintFor } from "@/lib/series-color";
import { CompAvatar } from "./comp-avatar";
import { SeriesSwatch } from "./series-swatch";

/** One competitor the page can plot, whether or not any metric captured it. */
export interface TrendsRosterEntry {
  competitorId: string;
  competitorName: string;
  competitorUrl: string | null;
  color: string | null;
  isSelf: boolean;
}

/**
 * Which competitors the whole Trends page is about.
 *
 * Every chart used to own its own hidden set, so switching a competitor off on the
 * hiring plot left it on the pricing one, and the pricing slopegraph had no filter
 * at all. The choice is the reader's question ("show me these four"), not one
 * chart's display state, so it lives once, beside the date range, and governs the
 * headline and the movement lists as well as the plots.
 *
 * Stateless on purpose — the view owns the set so it can mirror it to the URL.
 */
export function TrendsCompetitorFilter({
  roster,
  hidden,
  paint,
  onToggle,
  onShowAll,
}: {
  roster: TrendsRosterEntry[];
  hidden: Set<string>;
  paint: Map<string, SeriesPaint>;
  onToggle: (competitorId: string) => void;
  onShowAll: () => void;
}) {
  if (roster.length < 2) return null;
  const shown = roster.length - roster.filter((r) => hidden.has(r.competitorId)).length;
  // Sorted by name, not by the palette's id order: this is a list to find a company
  // in, and nobody looks anyone up by hue.
  const sorted = [...roster].sort((a, b) => a.competitorName.localeCompare(b.competitorName));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={hidden.size > 0 ? "secondary" : "outline"}
          size="sm"
          className="shrink-0"
        >
          <UsersIcon size={16} />
          Competitors
          {/* The ratio, not the excluded count: on a page with no cap, "6 of 14" is
              the number that says what is on screen. */}
          <span className="ml-0.5 tabular-nums text-muted-foreground">
            {shown}/{roster.length}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-[480px] w-64 overflow-y-auto" align="end">
        {sorted.map((entry) => (
          <DropdownMenuCheckboxItem
            key={entry.competitorId}
            checked={!hidden.has(entry.competitorId)}
            // Without this the menu closes on every tick, which turns picking four
            // competitors into four round-trips through the trigger.
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => onToggle(entry.competitorId)}
            className="gap-2"
          >
            <CompAvatar name={entry.competitorName} url={entry.competitorUrl} size={16} />
            <SeriesSwatch paint={paintFor(paint, entry.competitorId)} />
            <span className="min-w-0 truncate">
              {entry.competitorName}
              {entry.isSelf && <span className="text-muted-foreground"> (you)</span>}
            </span>
          </DropdownMenuCheckboxItem>
        ))}
        {hidden.size > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onShowAll} className="text-xs text-muted-foreground">
              Show all
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
