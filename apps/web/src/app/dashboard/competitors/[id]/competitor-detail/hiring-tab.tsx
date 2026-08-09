"use client";

import dynamic from "next/dynamic";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ArrowUpIcon, ArrowDownIcon, CaretRightIcon, ArrowSquareOutIcon } from "@/components/icons";
import { formatDistanceToNow } from "date-fns";
import { Fact, FactStrip } from "@/components/outrival/data-marks";
import {
  api,
  type CompetitorSignal,
  type HiringGeoData,
  type HiringSalaryData,
} from "@/lib/api";
import { HIRING_GEO_RESERVED_LABELS } from "@outrival/shared";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/dashboard/sparkline";
import { TabCard, TabSection } from "@/components/outrival/tab-shell";
import { buildJobTrend, mergeTrendsByDate } from "./charts";
import { Skeleton } from "@/components/ui/skeleton";
import { SENIORITY_RANK, SENIOR_PLUS_THRESHOLD, capitalize } from "./helpers";
import { formatMoney, salaryLabel } from "@/lib/format-money";
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
  // Where the open roles are. Same contract as velocity: secondary enrichment, so
  // the tab never blocks or errors on it — it simply doesn't render without data.
  const geoQuery = useQuery({
    queryKey: ["competitor", competitorId, "hiringGeo"],
    queryFn: () => api.getCompetitorHiringGeo(competitorId),
    placeholderData: keepPreviousData,
  });
  // What they pay. Same contract again: secondary enrichment, never blocking.
  const salaryQuery = useQuery({
    queryKey: ["competitor", competitorId, "hiringSalary"],
    queryFn: () => api.getCompetitorHiringSalary(competitorId),
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
            <span className="tabular-nums">{jobs.total}</span>
          </Fact>
          <Fact label="Senior or above" muted={seniorPlus === 0}>
            {seniorPlus > 0 ? (
              <>
                <span className="tabular-nums">{seniorPlus}</span> of{" "}
                <span className="tabular-nums">{allRoles.length}</span>
              </>
            ) : (
              "None posted"
            )}
          </Fact>
          <Fact label="Salary observed" muted={!salaryBand}>
            {salaryBand ? (
              <span className="tabular-nums">{salaryBand}</span>
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
              <span className="tabular-nums">
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

      <WhereTheyHire geo={geoQuery.data ?? null} />

      <Salaries salary={salaryQuery.data ?? null} />

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
                  <span className="font-semibold tabular-nums text-foreground">
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
                    "text-right text-dense tabular-nums",
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
                            // Only when it adds something the location doesn't
                            // already say ("Remote — EU" needs no badge).
                            role.remoteMode &&
                            !role.location?.toLowerCase().includes(role.remoteMode)
                              ? capitalize(role.remoteMode)
                              : null,
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
                        {/* What this description states about their stack and
                            their plans. Every value here was quoted from the JD
                            and substring-checked against it before it was stored,
                            so the badge is showing their words, not a summary. */}
                        {role.facts.length > 0 && (
                          <span className="col-start-1 row-start-3 mt-1 flex flex-wrap gap-1.5">
                            {role.facts.slice(0, 5).map((f) => (
                              <span
                                key={`${f.kind}-${f.value}`}
                                title={f.evidenceSnippet}
                                className={cn(
                                  "rounded-sm px-1.5 py-0.5 text-meta font-medium",
                                  f.kind === "product_hint"
                                    ? "bg-high/10 text-high"
                                    : "bg-surface-2 text-muted-foreground",
                                )}
                              >
                                {f.value}
                              </span>
                            ))}
                          </span>
                        )}
                        <span className="col-span-1 col-start-2 row-span-2 row-start-1 flex items-center gap-2.5">
                          {salary && (
                            <span className="text-xs tabular-nums text-muted-foreground">
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

/** How many countries the list shows before it says how many it is holding back. */
const GEO_ROWS = 10;

/**
 * Where a competitor's open roles are, for the latest captured week.
 *
 * A list, not a map: the question is "which countries, how many roles, and is any
 * of it new", and a choropleth answers none of those at this scale while costing a
 * rendering library and a topology file.
 *
 * The postings whose location could not be turned into a country are shown on the
 * same axis as the countries, at the bottom. They are the reason to trust or
 * distrust everything above them, and a footprint chart that quietly drops them
 * reads as complete when it is not.
 */
function WhereTheyHire({ geo }: { geo: HiringGeoData | null }) {
  if (!geo || (geo.countries.length === 0 && geo.other.length === 0)) return null;

  const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
  const label = (code: string) => {
    if (HIRING_GEO_RESERVED_LABELS[code]) return HIRING_GEO_RESERVED_LABELS[code];
    try {
      return regionNames.of(code) ?? code;
    } catch {
      return code;
    }
  };

  const shown = geo.countries.slice(0, GEO_ROWS);
  const hidden = geo.countries.length - shown.length;
  const rows = [
    ...shown.map((r) => ({ ...r, muted: false })),
    ...geo.other.map((r) => ({ ...r, isNew: false, muted: true })),
  ];
  // One scale across countries and unplaced roles, so the bars can be compared.
  const max = Math.max(...rows.map((r) => r.openCount), 1);
  const newCount = geo.countries.filter((r) => r.isNew).length;

  return (
    <TabSection
      title="Where they hire"
      action={
        newCount > 0 ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            <span className="tabular-nums">{newCount}</span> new in the last 30 days
          </span>
        ) : undefined
      }
    >
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li
            key={row.code}
            className="grid grid-cols-[minmax(7rem,1fr)_minmax(0,2fr)_2.5rem] items-center gap-3"
          >
            <span
              className={cn(
                "min-w-0 truncate text-sm",
                row.muted ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {label(row.code)}
              {row.isNew && (
                <span className="ml-2 rounded-sm bg-high/10 px-1.5 py-0.5 text-meta font-medium text-high">
                  new
                </span>
              )}
            </span>
            <span className="h-1.5 rounded-full bg-track" aria-hidden>
              <span
                className={cn(
                  "block h-full rounded-full",
                  row.muted ? "bg-muted-foreground" : "bg-link",
                )}
                style={{ width: `${Math.max((row.openCount / max) * 100, 4)}%` }}
              />
            </span>
            <span className="text-right text-dense tabular-nums text-muted-foreground">
              {row.openCount}
            </span>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <p className="pt-2 text-xs text-muted-foreground">
          <span className="tabular-nums">{hidden}</span> more{" "}
          {hidden === 1 ? "country" : "countries"} with fewer open roles.
        </p>
      )}
    </TabSection>
  );
}

/** Column header, every row, and the axis ride the same track so they line up. */
const SALARY_GRID = "grid grid-cols-[minmax(6rem,1fr)_minmax(0,2fr)_auto] gap-x-3";

/**
 * What a competitor pays, per department and per currency.
 *
 * Two rules give this card its shape, and both are visible in it. Bands are drawn
 * PER CURRENCY — one group, one scale, one axis — so a competitor hiring in Paris
 * and New York gets two blocks and no bar spans both, because an FX rate is a
 * number we do not capture and a "median" that moves with the euro would read as a
 * pay change. And the role count is on every row, because a median over three
 * roles and a median over thirty are different kinds of claim.
 *
 * Every quantity the bar encodes is also written next to it: a band drawn on a
 * shared scale says which department pays more, but only the figures say how much,
 * and the bar is unreadable without the axis that anchors it at zero.
 */
function Salaries({ salary }: { salary: HiringSalaryData | null }) {
  if (!salary) return null;
  const { bands, disclosure } = salary;
  if (bands.length === 0 && disclosure.total === 0) return null;

  const byCurrency = new Map<string, HiringSalaryData["bands"]>();
  for (const b of bands) {
    const rows = byCurrency.get(b.currency);
    if (rows) rows.push(b);
    else byCurrency.set(b.currency, [b]);
  }
  const groups = [...byCurrency.entries()];

  return (
    <TabSection
      title="Salaries"
      action={
        <span
          className={cn(
            "shrink-0 rounded-sm px-1.5 py-0.5 text-meta font-medium tabular-nums",
            disclosure.verdict === "yes"
              ? "bg-positive/10 text-positive"
              : disclosure.verdict === "partial"
                ? "bg-surface-2 text-foreground"
                : "bg-surface-2 text-muted-foreground",
          )}
        >
          {/* The fraction alone was the whole badge and carried no unit: "12/40" next
              to a pay card reads as an amount before it reads as a count. */}
          {disclosure.total === 0
            ? "No roles show pay"
            : `${disclosure.disclosed} of ${disclosure.total} ${
                disclosure.total === 1 ? "role shows" : "roles show"
              } pay`}
        </span>
      }
    >
      {bands.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {disclosure.disclosed > 0
            ? "Pay is published, but not in a form that can be compared — hourly rates, or amounts with no currency stated."
            : "Not one of their open roles states a salary."}
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map(([currency, rows]) => {
            // One scale per group: the widest p75 in that currency anchors the axis.
            const max = Math.max(...rows.map((r) => r.p75));
            return (
              <div key={currency} className="flex flex-col gap-2">
                <div className={cn(SALARY_GRID, "text-meta text-muted-foreground")}>
                  <span className="min-w-0 truncate">
                    {/* The currency belongs to the whole group, not to a suffix on
                        each label — without it two engineering rows read as a bug. */}
                    {groups.length > 1 ? `Department · ${currency}` : "Department"}
                  </span>
                  <span>Middle half of posted pay</span>
                  <span className="justify-self-end">Median</span>
                </div>
                <ul className="flex flex-col gap-3">
                  {rows.map((b) => {
                    const left = (b.p25 / max) * 100;
                    const width = Math.max(((b.p75 - b.p25) / max) * 100, 1.5);
                    const marker = (b.p50 / max) * 100;
                    return (
                      <li
                        key={`${b.bucket}-${b.currency}`}
                        className={cn(SALARY_GRID, "items-center gap-y-0.5")}
                      >
                        <span className="row-span-2 min-w-0 truncate text-sm">{b.label}</span>
                        <span className="relative flex h-4 items-center">
                          <span className="h-1.5 w-full rounded-full bg-track" aria-hidden />
                          <span
                            className="absolute h-1.5 rounded-full bg-link"
                            style={{ left: `${left}%`, width: `${width}%` }}
                            aria-hidden
                          />
                          {/* The median tick lands ON the p25-p75 band, so it needs to read
                              against the band as well as the gutter. bg-foreground clears the
                              gutter (12:1) but only 2.5:1 on the band in dark; the track-coloured
                              ring gives it an edge that separates from any fill by construction. */}
                          <span
                            className="absolute h-3 w-0.5 rounded-full bg-foreground ring-1 ring-track"
                            style={{ left: `calc(${marker}% - 1px)` }}
                            aria-hidden
                          />
                        </span>
                        <span className="flex items-center gap-2 justify-self-end">
                          {b.series.length >= 2 && (
                            <Sparkline
                              data={b.series}
                              w={56}
                              h={18}
                              color="var(--link)"
                              valueLabel={b.currency}
                            />
                          )}
                          <span className="text-dense tabular-nums">
                            {formatMoney(b.p50, b.currency)}
                          </span>
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {formatMoney(b.p25, b.currency)}–{formatMoney(b.p75, b.currency)}
                        </span>
                        <span className="justify-self-end text-xs tabular-nums text-muted-foreground">
                          {b.n} {b.n === 1 ? "role" : "roles"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <div className={cn(SALARY_GRID, "text-meta text-muted-foreground")}>
                  <span />
                  <span className="flex justify-between border-t border-border pt-1 tabular-nums">
                    <span>0</span>
                    <span>{formatMoney(max, currency)}</span>
                  </span>
                  <span />
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="pt-2 text-xs text-muted-foreground">
        Each bar spans the middle half of the annual ranges they publish — a quarter of
        the roles pay less, a quarter pay more — and the tick marks the median. Bars share
        one scale within a currency and none across: hourly roles are excluded, and nothing
        is converted between currencies.
      </p>
    </TabSection>
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
