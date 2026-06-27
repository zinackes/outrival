"use client";

import { formatDistanceToNow } from "date-fns";
import { FileText, Loader2, Play } from "lucide-react";
import type { ChangeRow, CompetitorSignal } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TabCard, TabSection } from "@/components/outrival/tab-shell";
import { ChangeCard } from "./changes";
import { Empty, type MonitorSourceProps } from "./shared";

const CONTENT_SOURCES = new Set(["homepage", "blog", "changelog"]);

export function ContentTab({
  changes,
  signals,
  monitors,
  scrapingIds,
  onRun,
  onRefresh,
  competitorUrl,
}: {
  changes: ChangeRow[];
  signals: CompetitorSignal[];
  onRefresh?: () => void;
  competitorUrl: string;
} & MonitorSourceProps) {
  const contentChanges = changes.filter((c) => CONTENT_SOURCES.has(c.sourceType));
  const contentMonitors = monitors.filter((m) => CONTENT_SOURCES.has(m.sourceType));
  // A content change that became a signal shows the strategic insight instead of
  // the plain classification summary.
  const insightByChangeId = new Map<string, string>();
  for (const s of signals) {
    if (s.changeId) insightByChangeId.set(s.changeId, s.insight);
  }

  if (contentChanges.length === 0) {
    if (contentMonitors.length === 0) {
      return (
        <Empty
          text="No content monitor configured."
          hint="Content tracking covers homepage, blog and changelog. None of these sources is enabled for this competitor."
        />
      );
    }
    const preferred =
      contentMonitors.find((m) => m.sourceType === "homepage") ??
      contentMonitors.find((m) => m.sourceType === "blog") ??
      contentMonitors[0]!;
    const running = scrapingIds.has(preferred.id);
    return (
      <EmptyState
        icon={FileText}
        title="No content changes yet"
        description={
          preferred.lastRunAt
            ? `The ${preferred.sourceType} monitor was scraped ${formatDistanceToNow(new Date(preferred.lastRunAt), { addSuffix: true })} — no change since.`
            : `The ${preferred.sourceType} monitor has never been scraped. Run it now.`
        }
        actions={
          <Button
            size="sm"
            variant={running ? "secondary" : "default"}
            onClick={() => onRun(preferred.id)}
            disabled={running}
          >
            {running ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Scraping…
              </>
            ) : (
              <>
                <Play size={12} /> Scrape {preferred.sourceType}
              </>
            )}
          </Button>
        }
      />
    );
  }

  return (
    <TabCard>
      <TabSection title="Content changes" icon={FileText}>
        <ul className="flex flex-col divide-y divide-border">
          {contentChanges.map((c) => (
            <li key={c.id} className="py-3.5 first:pt-0 last:pb-0">
              <ChangeCard
                change={c}
                onRefresh={onRefresh}
                fallbackUrl={competitorUrl}
                insight={insightByChangeId.get(c.id)}
              />
            </li>
          ))}
        </ul>
      </TabSection>
    </TabCard>
  );
}
