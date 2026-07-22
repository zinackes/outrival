"use client";

import Link from "next/link";
import { ShieldOff, SlidersHorizontal } from "lucide-react";
import {
  ALL_CONFIGURABLE_SOURCES,
  buildCoverage,
  coverageHeadline,
  sourceState,
  type DetectedTargets,
  type Plan,
  type SourceType,
} from "@outrival/shared";
import type { Monitor } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { sourceShortLabel } from "@/lib/source-labels";

const label = (s: SourceType) => sourceShortLabel(s).toLowerCase();

/** "a, b and c", capped so a well-covered competitor doesn't produce a paragraph. */
function list(sources: SourceType[], max = 4): string {
  const names = sources.slice(0, max).map(label);
  const rest = sources.length - names.length;
  if (rest > 0) names.push(`${rest} more`);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * What we cover on this competitor — stated positively. The denominator is
 * APPLICABLE sources only: a surface this competitor doesn't have (no YouTube
 * channel, no status page) is not a gap and never lowers the count, so the line
 * never turns into an anxious "6/9".
 *
 * A blocked surface is named separately, with the sources we read instead. That
 * pairing is the point: a site isn't monolithic, and the indirect surfaces (an ATS
 * jobs API, a changelog feed, a status page, Hacker News) often say more than the
 * homepage a bot wall protects.
 */
export function CompetitorCoverage({
  competitorId,
  monitors,
  plan,
  targets,
}: {
  competitorId: string;
  monitors: Monitor[];
  plan: Plan;
  targets: DetectedTargets | null;
}) {
  const bySource = new Map(monitors.map((m) => [m.sourceType, m]));
  const coverage = buildCoverage(
    ALL_CONFIGURABLE_SOURCES.map((sourceType) => ({
      sourceType,
      state: sourceState({
        sourceType,
        plan,
        monitor: bySource.get(sourceType) ?? null,
        targets,
      }),
    })),
  );

  // Sources still being captured count as fallbacks too — a competitor added a
  // minute ago shouldn't read as "blocked, and nothing else".
  const fallbacks = [...coverage.tracked, ...coverage.pending];

  return (
    <Card className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">
          {coverageHeadline(coverage, label)}
        </p>
        {coverage.blocked.length > 0 && (
          <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
            <ShieldOff size={13} className="mt-0.5 shrink-0" />
            <span>
              {coverage.blocked.length === 1
                ? `Their ${label(coverage.blocked[0]!)} blocks automated collection and we don't bypass it.`
                : `${list(coverage.blocked)} block automated collection and we don't bypass it.`}{" "}
              {fallbacks.length > 0
                ? `We're tracking ${list(fallbacks)} instead. No action needed from you.`
                : "No action needed from you."}
            </span>
          </p>
        )}
      </div>
      <Button asChild size="sm" variant="outline" className="h-7 shrink-0 text-xs">
        <Link href={`/dashboard/competitors/${competitorId}/sources`}>
          <SlidersHorizontal size={12} /> Sources
        </Link>
      </Button>
    </Card>
  );
}
