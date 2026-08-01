"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  SpinnerIcon,
  ClockIcon,
  PlusIcon,
  PlayIcon,
  SparkleIcon,
  CaretDownIcon,
  LinkIcon,
  LockIcon,
} from "@/components/icons";
import {
  ANALYSIS_SCRAPE_TIMEOUT_MS,
  ANALYSIS_QUEUE_TIMEOUT_MS,
  deriveScrapeActivity,
  hasNoTargetError,
  isRefused,
  type ScrapeActivity,
  PLAN_LABELS,
  minPlanForFrequency,
  planIncludesFrequency,
  type SourceType,
  type Plan,
  type MonitorFrequency,
} from "@outrival/shared";
import type { Monitor } from "@/lib/api";
import { cn } from "@/lib/utils";
import { friendlyScrapeError, sourcePageLabel } from "@/lib/scrape-errors";
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

export type { ScrapeActivity };

// How often an in-flight job (scrape, AI summary) is re-checked.
export const POLL_INTERVAL_MS = 3000;

// Server-side truth about an open scrape request. Both stamps are cleared on every
// terminal outcome, so a stamp newer than the last success/failure means "this
// request is still open" — which survives a page refresh, unlike the client-side
// `scrapingIds` set. The reading of the stamps lives in @outrival/shared, so the
// API payloads, the analysis banner and every source row cannot drift apart.

/** A worker has the job and is fetching the site right now. */
export function isServerScraping(m: Monitor): boolean {
  return deriveScrapeActivity(m, Date.now()) === "scraping";
}

/** Requested, but no worker has taken it yet — it is sitting in the queue. */
export function isServerQueued(m: Monitor): boolean {
  return deriveScrapeActivity(m, Date.now()) === "queued";
}

/** Either of the above — for callers that only need "something is happening". */
export function isServerInFlight(m: Monitor): boolean {
  return deriveScrapeActivity(m, Date.now()) !== null;
}

/**
 * How an open scrape request should READ on screen: server state, plus this
 * client's optimistic marker for a run it just asked for.
 *
 * `tracked` (the id is in `scrapingIds`) deliberately cannot produce "scraping":
 * that set is seeded from QUEUED jobs too, since a request is tracked from the
 * moment it is enqueued. Reading it as "a worker has this" is exactly what made
 * every source row claim to be scanning a page no worker had opened yet.
 */
export function scrapeActivity(m: Monitor, tracked = false): ScrapeActivity {
  const server = deriveScrapeActivity(m, Date.now());
  if (server === "scraping") return "scraping";
  if (server === "queued" || tracked) return "queued";
  return null;
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
                <SpinnerIcon size={16} className="animate-spin" /> Enabling…
              </>
            ) : (
              <>
                <PlusIcon size={16} /> Enable {label} monitoring
              </>
            )}
          </Button>
        )}
      </Card>
    );
  }
  const activity = scrapeActivity(monitor, scrapingIds.has(monitor.id));
  const busy = activity !== null;
  // The site refused us. Say so instead of "never been scraped, run it now", which
  // reads as a chore the user forgot. The button stays: a block can be lifted, and
  // trying is the user's call — only the SCRAPE stops at a refusal, in the worker.
  const refused = isRefused(monitor);
  // A recorded "this competitor has no such surface" (no Trustpilot profile, no
  // public docs). It was being overwritten by the generic "no data was extracted",
  // which turns a fact we hold into a shrug about the competitor.
  const noSurface = !refused && hasNoTargetError(monitor.sourceType, monitor.lastError);
  // The capture never left the homepage: the jobs / pricing scrapers fall back there
  // when discovery finds nothing, and that fallback SUCCEEDS, so the old copy read
  // "the source page may not expose this data" about a page we never opened. On prod
  // that was 49 of 81 jobs monitors. Naming the page is the whole point of this
  // state: the user's next move depends on WHICH page came back empty.
  const homepageOnly = !refused && !noSurface && monitor.pageIsHomepage === true;
  const page = sourcePageLabel(monitor.sourceType);
  const pretty = monitor.pageUrl?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const canRetarget = homepageOnly || noSurface;
  return (
    <Card className="px-6 py-10 text-center border-dashed flex flex-col items-center gap-3">
      <p className="text-sm font-semibold text-foreground">
        No {label} data{refused || noSurface ? "" : " yet"}
      </p>
      <p className="text-sm text-muted-foreground max-w-md">
        {refused
          ? `${friendlyScrapeError(monitor.lastError, monitor.sourceType)} You can still try again if you think that has changed.`
          : noSurface
            ? `${friendlyScrapeError(monitor.lastError, monitor.sourceType)}`
            : activity === "queued"
              ? `This source is waiting in the scan queue. It runs as soon as a scanner is free, and ${label} data lands here on its own.`
              : homepageOnly
                ? `We've only reached their homepage so far. No ${page} turned up on this site, so there is nothing to read yet.`
                : monitor.lastRunAt
                  ? `We last read this page ${formatDistanceToNow(new Date(monitor.lastRunAt), { addSuffix: true })} and it showed no ${label} data.`
                  : `This monitor has never been scraped. Run it now to extract ${label} data.`}
      </p>
      {/* Which page that verdict is about. Without it the sentence above is a claim
          about the competitor that the user cannot check. */}
      {pretty && monitor.pageUrl && (
        <p className="text-sm text-muted-foreground">
          {homepageOnly ? "Scanned" : "Read from"}{" "}
          <a
            href={monitor.pageUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-link hover:underline"
          >
            {pretty}
          </a>
        </p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          size="sm"
          variant={busy ? "secondary" : canRetarget ? "outline" : "default"}
          onClick={() => onRun(monitor.id)}
          disabled={busy}
        >
          {activity === "scraping" ? (
            <>
              <SpinnerIcon size={16} className="animate-spin" /> Scraping…
            </>
          ) : activity === "queued" ? (
            <>
              <ClockIcon size={16} /> Queued
            </>
          ) : (
            <>
              <PlayIcon size={16} /> Scrape now
            </>
          )}
        </Button>
        {/* Re-scanning the same homepage finds the same nothing, so the primary move
            here is naming the page instead. The URL lives on the Sources tab. */}
        {canRetarget && (
          <Button size="sm" asChild>
            <Link href={`/dashboard/competitors/${monitor.competitorId}/sources`}>
              <LinkIcon size={16} /> Point us at the {page}
            </Link>
          </Button>
        )}
      </div>
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
      {locked && <LockIcon size={16} className="opacity-70" />}
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
        <SparkleIcon size={16} className="shrink-0 text-muted-foreground" />
        <span className="text-content font-semibold tracking-tight leading-tight">
          What we found
        </span>
        <CaretDownIcon
          size={16}
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
