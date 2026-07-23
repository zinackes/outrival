"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { FileText, Loader2, Play } from "lucide-react";
import type { ChangeRow, CompetitorSignal } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TabCard, TabSection } from "@/components/outrival/tab-shell";
import { cn } from "@/lib/utils";
import { ChangeCard } from "./changes";
import { Empty, type MonitorSourceProps } from "./shared";
import {
  PRODUCT_LENSES,
  PRODUCT_LENS_LABELS,
  PRODUCT_SOURCES,
  filterByLens,
  lensCounts,
  type ProductLens,
} from "./product-lenses";

/**
 * Product & Positioning — how a competitor describes itself, what it ships, and
 * where it's talked about. Absorbs the old Content tab plus the sources that had
 * no home (news, status, YouTube, Hacker News, the domain fingerprint, the repo).
 *
 * The chips filter the ALREADY-LOADED feed, so "All" is byte-for-byte the mixed
 * chronological list this tab has always shown — switching lenses costs no query.
 */
export function ProductTab({
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
  const [lens, setLens] = useState<ProductLens | null>(null);
  const counts = lensCounts(changes);
  const visible = filterByLens(changes, lens);
  const tabMonitors = monitors.filter((m) =>
    (PRODUCT_SOURCES as readonly string[]).includes(m.sourceType),
  );
  // A change that became a signal shows the strategic insight instead of the
  // plain classification summary.
  const insightByChangeId = new Map<string, string>();
  for (const s of signals) {
    if (s.changeId) insightByChangeId.set(s.changeId, s.insight);
  }

  if (counts.all === 0) {
    if (tabMonitors.length === 0) {
      return (
        <Empty
          text="No positioning sources configured."
          hint="This covers the homepage, blog, changelog, news, status page and community mentions. None of them is enabled for this competitor."
        />
      );
    }
    const preferred =
      tabMonitors.find((m) => m.sourceType === "homepage") ??
      tabMonitors.find((m) => m.sourceType === "blog") ??
      tabMonitors[0]!;
    const running = scrapingIds.has(preferred.id);
    return (
      <EmptyState
        icon={FileText}
        title="No changes yet"
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
      <TabSection title="Product & positioning" icon={FileText}>
        <div className="flex flex-wrap items-center gap-1.5">
          <LensChip label="All" count={counts.all} active={lens === null} onClick={() => setLens(null)} />
          {PRODUCT_LENSES.map((l) => (
            <LensChip
              key={l}
              label={PRODUCT_LENS_LABELS[l]}
              count={counts[l]}
              active={lens === l}
              onClick={() => setLens(l)}
            />
          ))}
        </div>
        {visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing under {PRODUCT_LENS_LABELS[lens!]} yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {visible.map((c) => (
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
        )}
      </TabSection>
    </TabCard>
  );
}

function LensChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "secondary" : "ghost"}
      onClick={onClick}
      aria-pressed={active}
      className={cn("h-7 gap-1.5 text-xs", !active && "text-muted-foreground")}
    >
      {label}
      <span className="font-mono tabular-nums text-meta opacity-70">{count}</span>
    </Button>
  );
}
