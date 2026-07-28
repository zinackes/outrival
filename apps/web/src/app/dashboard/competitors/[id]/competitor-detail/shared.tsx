"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  CircleNotchIcon,
  PlusIcon,
  PlayIcon,
  SparkleIcon,
  CaretDownIcon,
  LockIcon,
} from "@phosphor-icons/react/ssr";
import {
  ANALYSIS_SCRAPE_TIMEOUT_MS,
  ANALYSIS_QUEUE_TIMEOUT_MS,
  PLAN_LABELS,
  minPlanForFrequency,
  planIncludesFrequency,
  type SourceType,
  type Plan,
  type MonitorFrequency,
} from "@outrival/shared";
import type { Monitor } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartSkeleton } from "@/components/dashboard/skeletons";
import { TabSection } from "@/components/outrival/tab-shell";

// How long a scrape a worker has PICKED UP is still believed to be running, and
// how long one that is merely enqueued is still believed to be waiting. They differ
// by an order of magnitude on purpose: fetching a site takes seconds to minutes,
// but waiting for a free scanner routinely takes half an hour when the hourly
// fan-out is ahead of you. Both mirror the shared analysis-status ceilings so the
// source row and the analysis banner never contradict each other.
export const POLL_TIMEOUT_MS = ANALYSIS_SCRAPE_TIMEOUT_MS;
export const QUEUE_TIMEOUT_MS = ANALYSIS_QUEUE_TIMEOUT_MS;

// How often an in-flight job (scrape, AI summary) is re-checked.
export const POLL_INTERVAL_MS = 3000;

// Is this monitor's scrape request still open — enqueued or running — from the
// server's point of view? Both stamps are cleared on every terminal outcome, so a
// stamp newer than the last success/failure means "this request is still open".
// Survives a page refresh, unlike the client-side `scrapingIds` set.
function inFlightSince(m: Monitor): number | null {
  if (!m.scrapeStartedAt) return null;
  const started = new Date(m.scrapeStartedAt).getTime();
  const lastRun = m.lastRunAt ? new Date(m.lastRunAt).getTime() : 0;
  const lastFailed = m.lastFailedAt ? new Date(m.lastFailedAt).getTime() : 0;
  if (started <= lastRun || started <= lastFailed) return null;
  return started;
}

/** A worker has the job and is fetching the site right now. */
export function isServerScraping(m: Monitor): boolean {
  if (inFlightSince(m) === null || !m.scrapePickedUpAt) return false;
  return Date.now() - new Date(m.scrapePickedUpAt).getTime() < POLL_TIMEOUT_MS;
}

/** Requested, but no worker has taken it yet — it is sitting in the queue. */
export function isServerQueued(m: Monitor): boolean {
  const started = inFlightSince(m);
  if (started === null || m.scrapePickedUpAt) return false;
  return Date.now() - started < QUEUE_TIMEOUT_MS;
}

/** Either of the above — for callers that only need "something is happening". */
export function isServerInFlight(m: Monitor): boolean {
  return isServerScraping(m) || isServerQueued(m);
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
          capturing {label} data, and we&apos;ll run the first scrape right away.
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
                <CircleNotchIcon size={12} className="animate-spin" /> Enabling…
              </>
            ) : (
              <>
                <PlusIcon size={12} /> Enable {label} monitoring
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
            <CircleNotchIcon size={12} className="animate-spin" /> Scraping…
          </>
        ) : (
          <>
            <PlayIcon size={12} /> Scrape now
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

export function FrequencyButton({
  freq,
  plan,
  selected,
  disabled,
  onSelect,
  onLocked,
}: {
  freq: MonitorFrequency;
  plan: Plan;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  onLocked: () => void;
}) {
  const locked = !planIncludesFrequency(plan, freq);
  return (
    <Button
      type="button"
      size="sm"
      variant={selected ? "default" : "outline"}
      onClick={() => (locked ? onLocked() : onSelect())}
      disabled={disabled}
      className="h-7 gap-1.5 text-xs capitalize"
    >
      {locked && <LockIcon size={10} className="opacity-70" />}
      {freq}
      {locked && (
        <span className="inline-flex items-center rounded bg-muted-foreground/15 px-1 py-0.5 text-meta font-medium uppercase leading-none tracking-wide text-muted-foreground">
          {PLAN_LABELS[minPlanForFrequency(freq)]}
        </span>
      )}
    </Button>
  );
}

export function SourceSummary({
  summary,
  updatedAt,
}: {
  summary: string | null | undefined;
  updatedAt: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  if (!summary) return null;
  return (
    <TabSection>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <SparkleIcon size={14} className="shrink-0 text-muted-foreground" />
        <span className="text-content font-semibold tracking-tight leading-tight">
          What we found
        </span>
        <CaretDownIcon
          size={14}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
        {updatedAt && (
          <span className="ml-auto text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(updatedAt), { addSuffix: true })}
          </span>
        )}
      </button>
      {open && (
        <p className="text-content leading-relaxed text-foreground/90">{summary}</p>
      )}
    </TabSection>
  );
}
