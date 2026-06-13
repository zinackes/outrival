"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Loader2, Plus, Play } from "lucide-react";
import type { SourceType } from "@outrival/shared";
import type { Monitor } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartSkeleton } from "@/components/dashboard/skeletons";

// A monitor scrape can run longer than this before we stop treating a stale
// scrapeStartedAt as "in progress".
export const POLL_TIMEOUT_MS = 300_000;

// A monitor is "running" from the server's point of view when its scrape was
// started after the last terminal event (success or failure) and hasn't blown
// past the poll timeout. This lets the in-progress state survive a page refresh
// even though the client-side `scrapingIds` set is reset on reload.
export function isServerScraping(m: Monitor): boolean {
  if (!m.scrapeStartedAt) return false;
  const started = new Date(m.scrapeStartedAt).getTime();
  const lastRun = m.lastRunAt ? new Date(m.lastRunAt).getTime() : 0;
  const lastFailed = m.lastFailedAt ? new Date(m.lastFailedAt).getTime() : 0;
  if (started <= lastRun || started <= lastFailed) return false;
  return Date.now() - started < POLL_TIMEOUT_MS;
}

export type MonitorSourceProps = {
  monitors: Monitor[];
  scrapingIds: Set<string>;
  onRun: (id: string) => void;
  onEnable?: (source: SourceType, url?: string) => Promise<void>;
};

export function MonitorEmptyState({
  source,
  label,
  monitors,
  scrapingIds,
  onRun,
  onEnable,
}: {
  source: SourceType;
  label: string;
} & MonitorSourceProps) {
  const [enabling, setEnabling] = useState(false);
  const monitor = monitors.find((m) => m.sourceType === source);
  if (!monitor) {
    return (
      <Card className="px-6 py-10 text-center border-dashed flex flex-col items-center gap-3">
        <p className="text-sm font-semibold text-foreground">
          No {label} monitoring yet
        </p>
        <p className="text-sm text-muted-foreground max-w-md">
          This competitor isn&apos;t tracking {label} yet. Enable it to start
          capturing {label} data — we&apos;ll run the first scrape right away.
          Requires a plan that includes this source.
        </p>
        {onEnable && (
          <Button
            size="sm"
            onClick={async () => {
              setEnabling(true);
              try {
                await onEnable(source);
              } finally {
                setEnabling(false);
              }
            }}
            disabled={enabling}
          >
            {enabling ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Enabling…
              </>
            ) : (
              <>
                <Plus size={12} /> Enable {label} monitoring
              </>
            )}
          </Button>
        )}
      </Card>
    );
  }
  const running = scrapingIds.has(monitor.id);
  return (
    <Card className="px-6 py-10 text-center border-dashed flex flex-col items-center gap-3">
      <p className="text-sm font-semibold text-foreground">No {label} data yet</p>
      <p className="text-sm text-muted-foreground max-w-md">
        {monitor.lastRunAt
          ? `Monitor was scraped ${formatDistanceToNow(new Date(monitor.lastRunAt), { addSuffix: true })}, but no ${label} data was extracted. The source page may not expose this data.`
          : `This monitor has never been scraped. Run it now to extract ${label} data.`}
      </p>
      <Button
        size="sm"
        variant={running ? "secondary" : "default"}
        onClick={() => onRun(monitor.id)}
        disabled={running}
      >
        {running ? (
          <>
            <Loader2 size={12} className="animate-spin" /> Scraping…
          </>
        ) : (
          <>
            <Play size={12} /> Scrape now
          </>
        )}
      </Button>
    </Card>
  );
}

export function TabLoading() {
  return (
    <div className="flex flex-col gap-4">
      <ChartSkeleton height={260} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-3 flex flex-col gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-3 w-20" />
          </Card>
        ))}
      </div>
    </div>
  );
}

export function Empty({ text, hint }: { text: string; hint?: string }) {
  return (
    <Card className="px-6 py-10 text-center border-dashed text-muted-foreground">
      <p className="text-sm">{text}</p>
      {hint && <p className="text-xs mt-2 max-w-md mx-auto text-muted-foreground">{hint}</p>}
    </Card>
  );
}
