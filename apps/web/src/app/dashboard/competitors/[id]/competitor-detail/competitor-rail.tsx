"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  SpinnerIcon,
  ClockIcon,
  LockIcon,
  PlayIcon,
  PowerIcon,
  PauseCircleIcon,
  ArrowsClockwiseIcon,
  ShieldSlashIcon,
  SlidersHorizontalIcon,
  SparkleIcon,
} from "@/components/icons";
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
import type { Competitor, Monitor } from "@/lib/api";
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
import { StatusDot } from "@/components/outrival/data-marks";
import { sourceShortLabel } from "@/lib/source-labels";
import { friendlyScrapeError } from "@/lib/scrape-errors";
import { scrapeActivity } from "./shared";
import { lastScanLabel, monitorStatus, nextScanLabel, type MonitorStatus } from "./monitor-status";

const label = (s: SourceType) => sourceShortLabel(s).toLowerCase();

/** "a, b and c", capped so a well-covered competitor doesn't produce a paragraph. */
function list(sources: SourceType[], max = 4): string {
  const names = sources.slice(0, max).map(label);
  const rest = sources.length - names.length;
  if (rest > 0) names.push(`${rest} more`);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Compact relative age for a dense row ("2m" / "5h" / "3d"). */
function shortAge(d: Date): string {
  const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * The page's context rail: what we watch, and what we understand of it.
 *
 * This is page chrome, not tab content, so it sits outside every tab panel and
 * stays pinned across all six. It is also deliberately the SHORTER column: when
 * the rail outgrows the reading column its overhang reads as a hole under the
 * content, which is exactly what the old three-card rail produced. Two cards is
 * the ceiling here; anything wider (the tech stack, the source catalogue) belongs
 * in the reading column or on the Sources page.
 */
export function CompetitorRail({
  competitor,
  monitors,
  plan,
  targets,
  scrapingIds,
  runningAll,
  monitoringPaused,
  summaryGenerating,
  onRun,
  onRunAll,
  onResume,
  onSetActive,
  onEdit,
  onLockedFrequency,
  onGenerateSummary,
}: {
  competitor: Competitor;
  monitors: Monitor[];
  plan: Plan;
  targets: DetectedTargets | null;
  scrapingIds: Set<string>;
  runningAll: boolean;
  monitoringPaused: boolean;
  summaryGenerating: boolean;
  onRun: (id: string) => void;
  onRunAll: () => void;
  onResume: (id: string) => void;
  onSetActive: (id: string, active: boolean) => void;
  onEdit: (id: string, patch: { url?: string; frequency?: MonitorFrequency }) => Promise<void>;
  onLockedFrequency: (freq: MonitorFrequency) => void;
  onGenerateSummary: () => void;
}) {
  const bySource = new Map(monitors.map((m) => [m.sourceType, m]));
  const coverage = buildCoverage(
    ALL_CONFIGURABLE_SOURCES.map((sourceType) => ({
      sourceType,
      state: sourceState({ sourceType, plan, monitor: bySource.get(sourceType) ?? null, targets }),
    })),
  );
  // Sources still being captured count as fallbacks too: a competitor added a
  // minute ago shouldn't read as "blocked, and nothing else".
  const fallbacks = [...coverage.tracked, ...coverage.pending];
  const queuedCount = monitors.filter(
    (m) => scrapeActivity(m, scrapingIds.has(m.id)) === "queued",
  ).length;

  // `top` clears the 52px sticky topbar plus the page gutter, so a pinned card
  // parks below the header instead of sliding under its blur.
  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-[4.25rem]">
      <Card className="overflow-hidden rounded-lg">
        <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2">
          <h3 className="text-content font-semibold leading-tight tracking-tight">Sources</h3>
          {monitors.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="-mr-1.5 h-7 text-xs text-muted-foreground"
              onClick={onRunAll}
              disabled={runningAll}
            >
              {runningAll ? <SpinnerIcon size={16} className="animate-spin" /> : <PlayIcon size={16} />}
              Scan all
            </Button>
          )}
        </div>

        {/* "Checking 3 sources…" reads as work already under way, and a queue that
            routinely runs half an hour deep is not that. When nothing has been
            captured yet and every source is still waiting, the card says so
            outright; otherwise the queued count rides along the coverage line. */}
        <p className="px-4 pb-2 text-sm text-muted-foreground">
          {queuedCount > 0 && coverage.tracked.length === 0
            ? `${queuedCount} source${queuedCount === 1 ? "" : "s"} queued, waiting for a free scanner`
            : queuedCount > 0
              ? `${coverageHeadline(coverage, label)} · ${queuedCount} queued`
              : coverageHeadline(coverage, label)}
        </p>

        {monitors.length > 0 && (
          <div className="px-4">
            {monitors.map((m) => {
              const activity = scrapeActivity(m, scrapingIds.has(m.id));
              return (
                <SourceRow
                  key={m.id}
                  competitorId={competitor.id}
                  monitor={m}
                  busy={activity !== null}
                  status={monitorStatus(m, activity === "scraping", activity === "queued")}
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

        {coverage.blocked.length > 0 && (
          <p className="mt-2 flex items-start gap-1.5 border-t border-border px-4 py-2.5 text-sm text-muted-foreground">
            <ShieldSlashIcon size={16} className="mt-0.5 shrink-0" />
            <span>
              {coverage.blocked.length === 1
                ? `Their ${label(coverage.blocked[0]!)} blocks automated collection and we don't bypass it.`
                : `${list(coverage.blocked)} block automated collection and we don't bypass it.`}{" "}
              {fallbacks.length > 0
                ? `We're reading ${list(fallbacks)} instead. No action needed from you.`
                : "No action needed from you."}
            </span>
          </p>
        )}

        <div className="border-t border-border px-4 py-2.5">
          <Link
            href={`/dashboard/competitors/${competitor.id}/sources`}
            className="inline-flex items-center gap-1.5 text-xs text-link hover:underline"
          >
            <SlidersHorizontalIcon size={14} /> Manage sources
          </Link>
        </div>
      </Card>

      <RailSummary
        competitor={competitor}
        generating={summaryGenerating}
        onGenerate={onGenerateSummary}
      />
    </aside>
  );
}

/**
 * How long a summary can sit before it stops describing the competitor we're
 * actually watching. Past this the card says so rather than presenting a
 * three-week-old paragraph as current.
 */
const SUMMARY_STALE_DAYS = 21;

function RailSummary({
  competitor,
  generating,
  onGenerate,
}: {
  competitor: Competitor;
  generating: boolean;
  onGenerate: () => void;
}) {
  const updatedAt = competitor.aiSummaryUpdatedAt
    ? new Date(competitor.aiSummaryUpdatedAt)
    : null;
  const ageDays = updatedAt ? (Date.now() - updatedAt.getTime()) / 86_400_000 : null;
  const stale = ageDays !== null && ageDays > SUMMARY_STALE_DAYS;

  if (!competitor.aiSummary) {
    return (
      <Card className="flex flex-col gap-2.5 rounded-lg border-dashed px-4 py-3.5">
        <div className="flex items-start gap-2 text-sm text-muted-foreground">
          <SparkleIcon size={16} className="mt-0.5 shrink-0" />
          <span>No summary yet.</span>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={onGenerate}
          disabled={generating}
          className="h-7 w-fit text-xs"
        >
          {generating ? <SpinnerIcon size={16} className="animate-spin" /> : <SparkleIcon size={16} />}
          {generating ? "Generating…" : "Generate now"}
        </Button>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-2.5 rounded-lg px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-content font-semibold leading-tight tracking-tight">Summary</h3>
        {updatedAt && (
          <StatusDot tone={stale ? "warn" : "neutral"}>
            {stale ? "stale, " : ""}
            {formatDistanceToNow(updatedAt)}
          </StatusDot>
        )}
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{competitor.aiSummary}</p>
      <Button
        size="sm"
        variant="ghost"
        onClick={onGenerate}
        disabled={generating}
        className="-ml-2 h-7 w-fit text-xs text-muted-foreground"
      >
        {generating ? (
          <SpinnerIcon size={16} className="animate-spin" />
        ) : (
          <ArrowsClockwiseIcon size={16} />
        )}
        {generating ? "Refreshing" : "Refresh"}
      </Button>
    </Card>
  );
}

/**
 * One source as a row: status, name, age. The facts (last scan, next scan,
 * failure reason) and the everyday actions stay in a dropdown, exactly as the
 * old chip strip had them, so nothing is lost by moving into the rail.
 */
function SourceRow({
  competitorId,
  monitor: m,
  busy,
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
  /** Scraping OR queued: either way there is an open request, so no second run. */
  busy: boolean;
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
  const off = status === "disabled" || status === "paused";
  const tone = failed ? "bad" : off ? "neutral" : status === "ok" ? "good" : "warn";
  const age =
    status === "running"
      ? "…"
      : status === "queued"
        ? "queued"
        : off
        ? "off"
        : failed
          ? "failed"
          : status === "ok" && m.lastRunAt
            ? shortAge(new Date(m.lastRunAt))
            : "never";
  const nextText = nextScanLabel(m, status, monitoringPaused);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 border-t border-border py-2 text-left text-dense transition-colors first:border-t-0 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              tone === "bad"
                ? "bg-critical"
                : tone === "good"
                  ? "bg-positive"
                  : tone === "warn"
                    ? "bg-medium"
                    : "bg-muted-foreground",
            )}
          />
          <span className={cn("min-w-0 flex-1 truncate", off && "text-muted-foreground")}>
            {sourceShortLabel(m.sourceType)}
          </span>
          <span
            className={cn(
              "shrink-0 text-meta tabular-nums",
              failed ? "text-critical" : "text-muted-foreground",
            )}
          >
            {age}
          </span>
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
        {status === "disabled" && (
          <p className="break-words px-2 pb-1.5 text-sm leading-relaxed text-muted-foreground">
            We stopped scraping this source after repeated failures. Resume to try again.
          </p>
        )}
        {status === "paused" && (
          <p className="break-words px-2 pb-1.5 text-sm leading-relaxed text-muted-foreground">
            Paused. This source won&apos;t be scraped until you enable it.
          </p>
        )}

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
                  {locked && <LockIcon size={16} className="opacity-70" />}
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
        {status === "disabled" ? (
          <DropdownMenuItem onClick={() => onResume(m.id)} disabled={busy}>
            {busy ? <SpinnerIcon size={16} className="animate-spin" /> : <ArrowsClockwiseIcon size={16} />}
            {busy ? "Resuming…" : "Resume monitoring"}
          </DropdownMenuItem>
        ) : status === "paused" ? (
          <DropdownMenuItem onClick={() => onSetActive(m.id, true)}>
            <PowerIcon size={16} /> Enable monitoring
          </DropdownMenuItem>
        ) : (
          <>
            {/* A queued source already has a run coming: the item states that
                instead of offering a second one that would only join the same
                queue behind the first. */}
            <DropdownMenuItem onClick={() => onRun(m.id)} disabled={busy}>
              {status === "running" ? (
                <SpinnerIcon size={16} className="animate-spin" />
              ) : status === "queued" ? (
                <ClockIcon size={16} />
              ) : (
                <PlayIcon size={16} />
              )}
              {status === "running"
                ? "Scraping…"
                : status === "queued"
                  ? "Queued, waiting for a scanner"
                  : "Run now"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSetActive(m.id, false)} disabled={busy}>
              <PauseCircleIcon size={16} /> Pause monitoring
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem asChild>
          <Link href={`/dashboard/competitors/${competitorId}/sources`}>
            <SlidersHorizontalIcon size={16} /> All source settings
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
