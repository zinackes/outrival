"use client";

import Link from "next/link";
import {
  Loader2,
  Lock,
  Play,
  Power,
  PowerOff,
  RefreshCw,
  ShieldOff,
  SlidersHorizontal,
} from "lucide-react";
import {
  ALL_CONFIGURABLE_SOURCES,
  MONITOR_FREQUENCIES,
  PLAN_LABELS,
  buildCoverage,
  coverageHeadline,
  minPlanForFrequency,
  planIncludesFrequency,
  sourceState,
  type DetectedTargets,
  type MonitorFrequency,
  type Plan,
  type SourceType,
} from "@outrival/shared";
import type { Monitor } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { sourceShortLabel } from "@/lib/source-labels";
import { friendlyScrapeError } from "@/lib/scrape-errors";
import { isServerScraping } from "./shared";
import {
  SourceStatusIcon,
  lastScanLabel,
  monitorStatus,
  nextScanLabel,
  type MonitorStatus,
} from "./monitor-status";

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
 *
 * Under the headline sits one chip per configured source — status, freshness and
 * the everyday actions (run, pause, cadence). The full per-source configuration
 * (URL, enabling a source, custom pages, the not-applicable states) stays on the
 * Sources sub-page; this strip is the at-a-glance layer the page lost.
 */
export function CompetitorCoverage({
  competitorId,
  monitors,
  plan,
  targets,
  scrapingIds,
  runningAll,
  monitoringPaused,
  onRun,
  onRunAll,
  onResume,
  onSetActive,
  onEdit,
  onLockedFrequency,
}: {
  competitorId: string;
  monitors: Monitor[];
  plan: Plan;
  targets: DetectedTargets | null;
  scrapingIds: Set<string>;
  runningAll: boolean;
  monitoringPaused: boolean;
  onRun: (id: string) => void;
  onRunAll: () => void;
  onResume: (id: string) => void;
  onSetActive: (id: string, active: boolean) => void;
  onEdit: (id: string, patch: { url?: string; frequency?: MonitorFrequency }) => Promise<void>;
  onLockedFrequency: (freq: MonitorFrequency) => void;
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
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
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
        <div className="flex shrink-0 items-center gap-1.5">
          {monitors.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={onRunAll}
              disabled={runningAll}
            >
              {runningAll ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Play size={12} />
              )}
              Scan all
            </Button>
          )}
          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
            <Link href={`/dashboard/competitors/${competitorId}/sources`}>
              <SlidersHorizontal size={12} /> Sources
            </Link>
          </Button>
        </div>
      </div>

      {monitors.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-2.5">
          {monitors.map((m) => {
            const running = scrapingIds.has(m.id) || isServerScraping(m);
            return (
              <SourceChip
                key={m.id}
                competitorId={competitorId}
                monitor={m}
                running={running}
                status={monitorStatus(m, running)}
                monitoringPaused={monitoringPaused}
                plan={plan}
                onRun={onRun}
                onResume={onResume}
                onSetActive={onSetActive}
                onEdit={onEdit}
                onLockedFrequency={onLockedFrequency}
              />
            );
          })}
        </div>
      )}
    </Card>
  );
}

// Compact relative age for the source chips ("2m" / "5h" / "3d") — the long
// "about 2 hours ago" reads fine in a row but is too wide for a dense chip strip.
function shortAge(d: Date): string {
  const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// One source as a chip: status + name + age at a glance, with the facts (last
// scan, next scan, failure reason) and the everyday actions in a dropdown. A
// failed source carries the critical hue so it stays loud in the strip.
function SourceChip({
  competitorId,
  monitor: m,
  running,
  status,
  monitoringPaused,
  plan,
  onRun,
  onResume,
  onSetActive,
  onEdit,
  onLockedFrequency,
}: {
  competitorId: string;
  monitor: Monitor;
  running: boolean;
  status: MonitorStatus;
  monitoringPaused: boolean;
  plan: Plan;
  onRun: (id: string) => void;
  onResume: (id: string) => void;
  onSetActive: (id: string, active: boolean) => void;
  onEdit: (id: string, patch: { url?: string; frequency?: MonitorFrequency }) => Promise<void>;
  onLockedFrequency: (freq: MonitorFrequency) => void;
}) {
  const failed = status === "failed";
  const isDisabled = status === "disabled";
  const isPaused = status === "paused";
  // Both the auto-pause and the manual pause read as a muted "off" chip.
  const off = isDisabled || isPaused;
  const ageLabel =
    status === "running"
      ? "…"
      : failed
        ? null
        : off
          ? "off"
          : status === "ok" && m.lastRunAt
            ? shortAge(new Date(m.lastRunAt))
            : "never";
  const nextText = nextScanLabel(m, status, monitoringPaused);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-dense transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            failed
              ? "border-critical/40 text-critical hover:bg-critical/10"
              : off
                ? "border-border text-muted-foreground hover:bg-accent"
                : "border-border text-foreground hover:bg-accent",
          )}
        >
          <SourceStatusIcon status={status} />
          <span className="font-medium">{sourceShortLabel(m.sourceType)}</span>
          {ageLabel && (
            <span
              className={cn("text-meta", failed ? "text-critical/70" : "text-muted-foreground")}
            >
              {ageLabel}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-sm font-semibold normal-case tracking-normal text-foreground">
          {sourceShortLabel(m.sourceType)}
        </DropdownMenuLabel>
        <p
          className={cn(
            "px-2 pb-1 text-xs",
            failed ? "font-medium text-critical" : "text-muted-foreground",
          )}
        >
          {lastScanLabel(m, status)}
        </p>
        {nextText && <p className="px-2 pb-1 text-xs text-muted-foreground">{nextText}</p>}
        {failed && m.lastError && (
          <p className="break-words px-2 pb-1.5 text-sm leading-relaxed text-muted-foreground">
            {friendlyScrapeError(m.lastError, m.sourceType)}
          </p>
        )}
        {isDisabled && (
          <p className="break-words px-2 pb-1.5 text-sm leading-relaxed text-muted-foreground">
            We stopped scraping this source after repeated failures. Resume to try again.
          </p>
        )}
        {isPaused && (
          <p className="break-words px-2 pb-1.5 text-sm leading-relaxed text-muted-foreground">
            Paused. This source won&apos;t be scraped until you enable it.
          </p>
        )}

        {/* Check cadence — the one setting worth changing without leaving the page.
            A frequency above the plan routes to the paywall instead of selecting,
            which would only fail server-side on save. Plain buttons (not menu
            items) so picking one doesn't close the menu mid-decision. */}
        <div className="px-2 pb-1.5 pt-1">
          <p className="pb-1 text-meta font-medium uppercase tracking-wide text-muted-foreground">
            Check frequency
          </p>
          <div className="flex flex-wrap gap-1">
            {MONITOR_FREQUENCIES.map((freq) => {
              const locked = !planIncludesFrequency(plan, freq);
              return (
                <Button
                  key={freq}
                  type="button"
                  size="sm"
                  variant={m.frequency === freq ? "secondary" : "ghost"}
                  aria-pressed={m.frequency === freq}
                  className="h-6 gap-1 text-meta capitalize text-muted-foreground"
                  onClick={() =>
                    locked ? onLockedFrequency(freq) : void onEdit(m.id, { frequency: freq })
                  }
                >
                  {locked && <Lock size={9} className="opacity-70" />}
                  {freq}
                </Button>
              );
            })}
          </div>
          {!planIncludesFrequency(plan, "realtime") && (
            <p className="pt-1 text-meta text-muted-foreground">
              Faster checks on the {PLAN_LABELS[minPlanForFrequency("realtime")]} plan.
            </p>
          )}
        </div>

        <DropdownMenuSeparator />
        {isDisabled ? (
          <DropdownMenuItem onClick={() => onResume(m.id)} disabled={running}>
            {running ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {running ? "Resuming…" : "Resume monitoring"}
          </DropdownMenuItem>
        ) : isPaused ? (
          <DropdownMenuItem onClick={() => onSetActive(m.id, true)}>
            <Power size={13} /> Enable monitoring
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onClick={() => onRun(m.id)} disabled={running}>
              {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              {running ? "Scraping…" : "Run now"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSetActive(m.id, false)} disabled={running}>
              <PowerOff size={13} /> Pause monitoring
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem asChild>
          <Link href={`/dashboard/competitors/${competitorId}/sources`}>
            <SlidersHorizontal size={13} /> All source settings
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
