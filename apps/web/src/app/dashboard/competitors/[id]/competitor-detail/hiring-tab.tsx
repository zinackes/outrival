"use client";

import dynamic from "next/dynamic";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Briefcase, Activity, ArrowUp, ArrowDown, ChevronRight, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Fact, FactStrip } from "@/components/outrival/data-marks";
import { api } from "@/lib/api";
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
  type MonitorSourceProps,
} from "./shared";

// recharts is heavy + client-only: lazy-load the chart so it stays off this
// route's first-load bundle (F7).
const MultiLineChart = dynamic(() => import("./chart-line"), {
  ssr: false,
  loading: () => <Skeleton className="h-[240px] w-full" />,
});

export function HiringTab({
  competitorId,
  monitors,
  scrapingIds,
  onRun,
  onEnable,
}: { competitorId: string } & MonitorSourceProps) {
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

  return (
    <TabCard>
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
        <TabSection title="Open roles over time" icon={Activity}>
          <MultiLineChart
            data={mergeTrendsByDate(trends)}
            seriesKeys={Object.keys(trendByDept)}
            height={240}
            yAllowDecimals={false}
          />
        </TabSection>
      )}

      {/* One department hierarchy. This used to be three: a multi-line chart, a
          count-and-delta table, and a weekly sparkline list, all drawing the same
          axis, with the roles in a separate 30rem scroll cage below them. Each row
          now carries the count, the shape and the delta, and opens onto its roles. */}
      <TabSection title="By department" icon={Briefcase}>
        <div className="-mx-1">
          {sortedDepartments.map((d) => {
            const series = trendByDept[d.department] ?? [];
            const first = series[0]?.count ?? d.count;
            const last = series[series.length - 1]?.count ?? d.count;
            const delta = last - first;
            const spark = velocityByLabel.get(d.department.toLowerCase());
            return (
              <details key={d.department} className="group border-t border-border first:border-t-0">
                <summary
                  className={cn(
                    "flex cursor-pointer list-none items-center gap-3 px-1 py-2.5",
                    "transition-colors hover:bg-surface-2",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    "[&::-webkit-details-marker]:hidden",
                  )}
                >
                  <ChevronRight
                    size={13}
                    aria-hidden
                    className="shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {d.department}
                  </span>
                  <span className="shrink-0 text-dense text-muted-foreground">
                    <span className="font-mono font-semibold tabular-nums text-foreground">
                      {d.count}
                    </span>{" "}
                    open
                  </span>
                  {spark && spark.series.length >= 2 && (
                    <span className="hidden shrink-0 sm:block">
                      <Sparkline
                        data={spark.series}
                        w={88}
                        h={22}
                        color="var(--link)"
                        fill
                        valueLabel="roles"
                      />
                    </span>
                  )}
                  <span
                    className={cn(
                      "w-16 shrink-0 text-right font-mono text-dense tabular-nums",
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
                        {delta > 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
                        {Math.abs(delta)}
                      </span>
                    )}
                  </span>
                </summary>
                <ul className="flex flex-col pb-2 pl-7 pr-1">
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
                              <ExternalLink size={11} className="shrink-0 text-muted-foreground" />
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
          <p className="text-dense text-muted-foreground">
            Nothing open in{" "}
            <span className="text-foreground">{emptyBuckets.join(", ").toLowerCase()}</span>. A
            department they track but are not hiring into is a read of its own.
          </p>
        )}
      </TabSection>
    </TabCard>
  );
}
