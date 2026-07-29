"use client";

import dynamic from "next/dynamic";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ArrowUpIcon, ArrowDownIcon, CaretRightIcon, ArrowSquareOutIcon } from "@/components/icons";
import { formatDistanceToNow } from "date-fns";
import { Fact, FactStrip } from "@/components/outrival/data-marks";
import { api, type CompetitorSignal } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/dashboard/sparkline";
import { TabCard, TabSection } from "@/components/outrival/tab-shell";
import { buildJobTrend, mergeTrendsByDate } from "./charts";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SENIORITY_RANK,
  SENIOR_PLUS_THRESHOLD,
  formatMoney,
  salaryLabel,
  capitalize,
} from "./helpers";
import {
  Empty,
  TabLoading,
  MonitorEmptyState,
  SourceSummary,
  scrapeActivity,
  type MonitorSourceProps,
  type ScrapeActivity,
} from "./shared";

// recharts is heavy + client-only: lazy-load the chart so it stays off this
// route's first-load bundle (F7).
const MultiLineChart = dynamic(() => import("./chart-line"), {
  ssr: false,
  loading: () => <Skeleton className="h-[240px] w-full" />,
});

export function HiringTab({
  competitorId,
  signals,
  monitors,
  scrapingIds,
  onRun,
  onEnable,
}: {
  competitorId: string;
  /** Already on the page; carries the hiring-shift anchor the chart marks. */
  signals: CompetitorSignal[];
} & MonitorSourceProps) {
  // The shared QueryClient serves the cache instantly on tab re-switch (no skeleton
  // flash); keepPreviousData keeps the last result during a refetch. A forced
  // re-scan invalidates ["competitor", id] from the detail view.
  const jobsQuery = useQuery({
    queryKey: ["competitor", competitorId, "jobs"],
    queryFn: () => api.getCompetitorJobs(competitorId),
    placeholderData: keepPreviousData,
  });
  const trendsQuery = useQuery({
    queryKey: ["competitor", competitorId, "jobTrends"],
    queryFn: () => api.getCompetitorJobTrends(competitorId).then((t) => t.trends),
    placeholderData: keepPreviousData,
  });
  // Per-department weekly velocity (sparklines). Secondary enrichment — the tab
  // never blocks or errors on it; it just doesn't render when there's no series.
  const velocityQuery = useQuery({
    queryKey: ["competitor", competitorId, "hiringVelocity"],
    queryFn: () => api.getCompetitorHiringVelocity(competitorId).then((v) => v.velocity),
    placeholderData: keepPreviousData,
  });

  const jobs = jobsQuery.data ?? null;
  const trends = trendsQuery.data ?? null;
  // Need ≥2 weeks for a sparkline to mean anything.
  const allVelocity = velocityQuery.data ?? [];

  if (jobsQuery.isError || trendsQuery.isError)
    return <Empty text="Couldn't load this data right now. Try again in a moment." />;
  if (!jobs || !trends) return <TabLoading />;
  if (jobs.total === 0) {
    return (
      <MonitorEmptyState
        source="jobs"
        label="hiring"
        monitors={monitors}
        scrapingIds={scrapingIds}
        onRun={onRun}
        onEnable={onEnable}
      />
    );
  }

  const trendByDept = buildJobTrend(trends);
  const jobsMonitor = monitors.find((m) => m.sourceType === "jobs");

  // Flatten every open role and surface the senior bets first. Each role carries
  // its department so it stays readable inside its group.
  const allRoles = jobs.departments
    .flatMap((d) => d.jobs.map((j) => ({ ...j, dept: d.department })))
    .sort(
      (a, b) =>
        (SENIORITY_RANK[b.seniority ?? ""] ?? 0) - (SENIORITY_RANK[a.seniority ?? ""] ?? 0) ||
        a.title.localeCompare(b.title),
    );

  // Strategic recap (patch-32 enrichment): how many senior+ bets, and the salary
  // band the ATS disclosed. Both are leading indicators of budget and maturity, so
  // they belong in the headline strip rather than in a 12px line above a list.
  const seniorPlus = allRoles.filter(
    (r) => (SENIORITY_RANK[r.seniority ?? ""] ?? 0) >= SENIOR_PLUS_THRESHOLD,
  ).length;
  const withSalary = allRoles.filter((r) => r.salaryMin != null || r.salaryMax != null);
  const salaryLows = withSalary
    .map((r) => r.salaryMin ?? r.salaryMax)
    .filter((n): n is number => n != null);
  const salaryHighs = withSalary
    .map((r) => r.salaryMax ?? r.salaryMin)
    .filter((n): n is number => n != null);
  const salaryBand =
    salaryLows.length > 0
      ? `${formatMoney(Math.min(...salaryLows), withSalary[0]!.salaryCurrency)} to ${formatMoney(
          Math.max(...salaryHighs),
          withSalary[0]!.salaryCurrency,
        )}`
      : null;

  const hasTrend = Object.keys(trendByDept).length > 0;

  // Net movement across the whole board over the captured window. The board total
  // is the number that says "are they accelerating"; the per-department deltas
  // below say where.
  const totalDelta = Object.values(trendByDept).reduce((acc, series) => {
    const first = series[0]?.count;
    const last = series[series.length - 1]?.count;
    return acc + (first != null && last != null ? last - first : 0);
  }, 0);

  // The velocity series is keyed by canonical bucket; departments come off the ATS
  // verbatim. Match on the label so a department gets its shape when we have one,
  // and simply renders without a sparkline when we don't.
  const velocityByLabel = new Map(
    allVelocity.map((v) => [v.label.toLowerCase(), v] as const),
  );

  // Buckets we track that currently hold nothing. Absence is a read in competitive
  // intelligence: a company launching a paid tier with an empty sales bucket is
  // building it before selling it. The data was always there and never shown.
  const emptyBuckets = allVelocity
    .filter((v) => v.current === 0)
    .map((v) => v.label)
    .filter((labelText) => !jobs.departments.some((d) => d.department.toLowerCase() === labelText.toLowerCase()));

  const sortedDepartments = [...jobs.departments].sort((a, b) => b.count - a.count);

  // Which department drove the net movement. "They added three roles" is a fact;
  // "and all of it is engineering" is the read.
  const deltaByDept = Object.entries(trendByDept)
    .map(([dept, s]) => {
      const first = s[0]?.count;
      const last = s[s.length - 1]?.count;
      return { dept, delta: first != null && last != null ? last - first : 0 };
    })
    .filter((d) => d.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const driver = deltaByDept[0] ?? null;
  const driverShare =
    driver && totalDelta !== 0 ? Math.abs(driver.delta) / Math.abs(totalDelta) : 0;

  const verdict = (() => {
    if (jobs.total === 0) return null;
    if (totalDelta === 0) {
      return `Their board has held at ${jobs.total} open ${jobs.total === 1 ? "role" : "roles"}.`;
    }
    const verb = totalDelta > 0 ? "opened" : "closed";
    const n = Math.abs(totalDelta);
    const where =
      driver && driverShare >= 0.99
        ? `, all of it ${driver.dept.toLowerCase()}`
        : driver && driverShare >= 0.5
          ? `, mostly ${driver.dept.toLowerCase()}`
          : "";
    return `They ${verb} ${n} ${n === 1 ? "role" : "roles"}${where}.`;
  })();

  // Where detect-hiring-velocity-shifts fired. The signal carries the date; the
  // chart's X axis is a formatted label, so the marker snaps to the nearest
  // captured point rather than inventing a tick between two of them.
  const chartPoints = mergeTrendsByDate(trends);
  const shiftMarkers = signals
    .filter((sig) => sig.sourceType === "hiring_shift")
    .map((sig) => {
      const at = new Date(sig.createdAt).getTime();
      const nearest = chartPoints.reduce<{ x: string; gap: number } | null>((best, pt) => {
        const label = String(pt.date);
        const gap = Math.abs(new Date(`${label} ${new Date(at).getFullYear()}`).getTime() - at);
        if (Number.isNaN(gap)) return best;
        return !best || gap < best.gap ? { x: label, gap } : best;
      }, null);
      return nearest ? { x: nearest.x, label: "Inflection signalled" as const } : null;
    })
    .filter((m): m is { x: string; label: "Inflection signalled" } => m !== null)
    .slice(0, 1);

  return (
    <TabCard>
      {verdict && (
        <TabSection>
          <h3 className="text-xl font-semibold leading-snug tracking-tight text-balance">
            {verdict}
          </h3>
        </TabSection>
      )}

      <TabSection>
        <FactStrip>
          <Fact label="Open roles">
            <span className="font-mono tabular-nums">{jobs.total}</span>
          </Fact>
          <Fact label="Senior or above" muted={seniorPlus === 0}>
            {seniorPlus > 0 ? (
              <>
                <span className="font-mono tabular-nums">{seniorPlus}</span> of{" "}
                <span className="font-mono tabular-nums">{allRoles.length}</span>
              </>
            ) : (
              "None posted"
            )}
          </Fact>
          <Fact label="Salary observed" muted={!salaryBand}>
            {salaryBand ? (
              <span className="font-mono tabular-nums">{salaryBand}</span>
            ) : (
              "No bands posted"
            )}
          </Fact>
          <Fact
            label="Net change"
            tone={totalDelta > 0 ? "warn" : undefined}
            muted={totalDelta === 0}
          >
            {totalDelta === 0 ? (
              "Flat"
            ) : (
              <span className="font-mono tabular-nums">
                {totalDelta > 0 ? `+${totalDelta}` : totalDelta}
              </span>
            )}
          </Fact>
        </FactStrip>
      </TabSection>

      <SourceSummary
        summary={jobsMonitor?.aiSummary}
        updatedAt={jobsMonitor?.aiSummaryUpdatedAt}
      />

      {hasTrend && (
        <TabSection
          title="Open roles over time"
          action={
            <span className="shrink-0 text-xs text-muted-foreground">by department</span>
          }
        >
          {/* Stacked: these are parts of one board, so the top edge is the total.
              Independent series sharing an axis (plan prices) must not stack. */}
          <MultiLineChart
            data={chartPoints}
            seriesKeys={Object.keys(trendByDept)}
            height={240}
            yAllowDecimals={false}
            stacked
            markers={shiftMarkers}
          />
        </TabSection>
      )}

      {/* One department hierarchy. This used to be three: a multi-line chart, a
          count-and-delta table, and a weekly sparkline list, all drawing the same
          axis, with the roles in a separate 30rem scroll cage below them. Each row
          now carries the count, the shape and the delta, and opens onto its roles. */}
      <div>
        {sortedDepartments.map((d) => {
          const series = trendByDept[d.department] ?? [];
            const first = series[0]?.count ?? d.count;
            const last = series[series.length - 1]?.count ?? d.count;
            const delta = last - first;
            const spark = velocityByLabel.get(d.department.toLowerCase());
            return (
            <details
              key={d.department}
              className="details-smooth group border-t border-border first:border-t-0"
            >
              {/* Fixed columns, so name, count, shape and delta line up down the
                  list instead of drifting with each department's name length. */}
              <summary
                className={cn(
                  "grid cursor-pointer list-none items-center gap-3.5 px-5 py-3",
                  "grid-cols-[0.875rem_minmax(0,1fr)_auto_4.25rem] sm:grid-cols-[0.875rem_minmax(0,1fr)_4.5rem_6rem_4.25rem]",
                  "transition-colors hover:bg-surface-2",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  "[&::-webkit-details-marker]:hidden",
                )}
              >
                <CaretRightIcon
                  size={16}
                  aria-hidden
                  className="shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                />
                <span className="min-w-0 truncate text-sm font-medium">{d.department}</span>
                <span className="text-right text-dense text-muted-foreground">
                  <span className="font-mono font-semibold tabular-nums text-foreground">
                    {d.count}
                  </span>{" "}
                  open
                </span>
                <span className="hidden justify-self-end sm:block">
                  {spark && spark.series.length >= 2 && (
                    <Sparkline
                      data={spark.series}
                      w={88}
                      h={22}
                      color="var(--link)"
                      fill
                      valueLabel="roles"
                    />
                  )}
                </span>
                <span
                  className={cn(
                    "text-right font-mono text-dense tabular-nums",
                    delta === 0
                      ? "text-muted-foreground"
                      : delta > 0
                        ? "text-high"
                        : "text-positive",
                  )}
                >
                  {delta === 0 ? (
                    "flat"
                  ) : (
                    <span className="inline-flex items-center justify-end gap-0.5">
                      {delta > 0 ? <ArrowUpIcon className="size-3.5" /> : <ArrowDownIcon className="size-3.5" />}
                      {Math.abs(delta)}
                    </span>
                  )}
                </span>
              </summary>
              <ul className="flex flex-col pb-3 pl-[2.875rem] pr-5">
                  {d.jobs.map((role) => {
                    const salary = salaryLabel(role);
                    return (
                      <li
                        key={role.id}
                        className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 border-t border-border py-2.5 first:border-t-0"
                      >
                        <span className="col-start-1 min-w-0 text-sm">
                          {role.url ? (
                            <a
                              href={role.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                            >
                              {role.title}
                              <ArrowSquareOutIcon size={16} className="shrink-0 text-muted-foreground" />
                            </a>
                          ) : (
                            role.title
                          )}
                        </span>
                        <span className="col-start-1 text-xs text-muted-foreground">
                          {[
                            role.location,
                            // A posting's age separates a real bet from one that has
                            // been sitting there. postedAt shipped with patch-32 and
                            // was never rendered.
                            role.postedAt
                              ? `posted ${formatDistanceToNow(new Date(role.postedAt), { addSuffix: true })}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        <span className="col-span-1 col-start-2 row-span-2 row-start-1 flex items-center gap-2.5">
                          {salary && (
                            <span className="font-mono text-xs tabular-nums text-muted-foreground">
                              {salary}
                            </span>
                          )}
                          {role.seniority && (
                            <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-meta font-medium text-muted-foreground">
                              {capitalize(role.seniority)}
                            </span>
                          )}
                        </span>
                      </li>
                  );
                })}
              </ul>
            </details>
          );
        })}
      </div>

      {emptyBuckets.length > 0 && (
        <p className="px-5 py-3 text-dense text-muted-foreground">
          Nothing open in{" "}
          <span className="text-foreground">{emptyBuckets.join(", ").toLowerCase()}</span>. A
          department they track but are not hiring into is a read of its own.
        </p>
      )}

      {/* Provenance last, matching Pricing: which board, when it was last read. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-xs text-muted-foreground">
        {jobsMonitor?.pageUrl && (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            Captured from
            <a
              href={jobsMonitor.pageUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="truncate text-link hover:underline"
            >
              {jobsMonitor.pageUrl.replace(/^https?:\/\//, "")}
            </a>
          </span>
        )}
        {jobsMonitor?.lastRunAt && (
          <span>
            last check {formatDistanceToNow(new Date(jobsMonitor.lastRunAt), { addSuffix: true })}
          </span>
        )}
        {jobsMonitor && (
          <RescanLink
            activity={scrapeActivity(jobsMonitor, scrapingIds.has(jobsMonitor.id))}
            onRun={() => onRun(jobsMonitor.id)}
          />
        )}
      </div>
    </TabCard>
  );
}

/**
 * Re-scan affordance for the jobs board. Three states, because "Scanning…" over a
 * job that is still waiting for a free scanner is the claim that made a long queue
 * look like a stalled scrape.
 */
function RescanLink({
  activity,
  onRun,
}: {
  activity: ScrapeActivity;
  onRun: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onRun}
      disabled={activity !== null}
      className="ml-auto text-link hover:underline disabled:opacity-60"
    >
      {activity === "scraping" ? "Scanning…" : activity === "queued" ? "Queued" : "Re-scan now"}
    </button>
  );
}
