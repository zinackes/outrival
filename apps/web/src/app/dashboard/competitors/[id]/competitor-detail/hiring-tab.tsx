"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { Briefcase, Activity, ArrowUp, ArrowDown, ExternalLink } from "lucide-react";
import { api, type JobsByDepartment, type JobTrendPoint } from "@/lib/api";
import { cn } from "@/lib/utils";
import { TabCard, TabSection } from "@/components/outrival/tab-shell";
import { buildJobTrend, mergeTrendsByDate, lineColor } from "./charts";
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

export function HiringTab({
  competitorId,
  monitors,
  scrapingIds,
  onRun,
  onEnable,
  refreshTick,
}: { competitorId: string; refreshTick?: number } & MonitorSourceProps) {
  const [jobs, setJobs] = useState<JobsByDepartment | null>(null);
  const [trends, setTrends] = useState<JobTrendPoint[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    api
      .getCompetitorJobs(competitorId)
      .then((j) => !cancelled && setJobs(j))
      .catch((e) => !cancelled && setErr(String(e)));
    api
      .getCompetitorJobTrends(competitorId)
      .then((t) => !cancelled && setTrends(t.trends))
      .catch((e) => !cancelled && setErr(String(e)));
    return () => {
      cancelled = true;
    };
  }, [competitorId, refreshTick]);

  if (err) return <Empty text="Couldn't load this data right now — try again in a moment." />;
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
  // its department so the flat list stays readable without the grouping.
  const allRoles = jobs.departments
    .flatMap((d) => d.jobs.map((j) => ({ ...j, dept: d.department })))
    .sort(
      (a, b) =>
        (SENIORITY_RANK[b.seniority ?? ""] ?? 0) - (SENIORITY_RANK[a.seniority ?? ""] ?? 0) ||
        a.title.localeCompare(b.title),
    );

  // Strategic recap (patch-32 enrichment): how many senior+ bets, and the salary
  // band the ATS disclosed. Both are leading indicators of budget / maturity —
  // hiring Staff/Principal or posting high bands signals a serious build.
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
      ? `${formatMoney(Math.min(...salaryLows), withSalary[0]!.salaryCurrency)}–${formatMoney(
          Math.max(...salaryHighs),
          withSalary[0]!.salaryCurrency,
        )}`
      : null;

  const hasTrend = Object.keys(trendByDept).length > 0;

  // Department breakdown: current open count + 90-day delta. Paired with the
  // trend chart on lg (border-l), so the two department views sit side by side
  // instead of stacking — the narrow table fills the column the wide chart frees.
  const deptTable = (
    <TabSection
      title="By department"
      icon={Briefcase}
      className={hasTrend ? "border-t border-border lg:border-t-0 lg:border-l" : undefined}
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="text-left py-2">Department</th>
            <th className="text-right py-2">Active</th>
            <th className="text-right py-2">Trend 90d</th>
          </tr>
        </thead>
        <tbody>
          {jobs.departments
            .sort((a, b) => b.count - a.count)
            .map((d) => {
              const series = trendByDept[d.department] ?? [];
              const first = series[0]?.count ?? d.count;
              const last = series[series.length - 1]?.count ?? d.count;
              const delta = last - first;
              return (
                <tr key={d.department} className="border-t border-border">
                  <td className="py-2">{d.department}</td>
                  <td className="py-2 text-right tabular-nums font-mono">{d.count}</td>
                  <td
                    className={cn(
                      "py-2 text-right tabular-nums font-mono",
                      delta === 0
                        ? "text-muted-foreground"
                        : delta > 0
                          ? "text-positive"
                          : "text-critical",
                    )}
                  >
                    {delta === 0 ? (
                      "—"
                    ) : (
                      <span className="inline-flex items-center justify-end gap-0.5">
                        {delta > 0 ? (
                          <ArrowUp className="size-3" />
                        ) : (
                          <ArrowDown className="size-3" />
                        )}
                        {delta > 0 ? `+${delta}` : delta}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </TabSection>
  );

  return (
    <TabCard>
      <SourceSummary
        summary={jobsMonitor?.aiSummary}
        updatedAt={jobsMonitor?.aiSummaryUpdatedAt}
      />

      {hasTrend ? (
        <div className="grid lg:grid-cols-2">
          <TabSection title="90-day trend" icon={Activity}>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={mergeTrendsByDate(trends)}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="var(--muted)" fontSize={11} />
                <YAxis stroke="var(--muted)" fontSize={11} allowDecimals={false} />
                <ChartTooltip
                  contentStyle={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {Object.keys(trendByDept).map((dept, i) => (
                  <Line
                    key={dept}
                    type="monotone"
                    dataKey={dept}
                    stroke={lineColor(i)}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </TabSection>
          {deptTable}
        </div>
      ) : (
        deptTable
      )}

      <TabSection title="Roles" icon={Briefcase}>
        {(seniorPlus > 0 || salaryBand) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground tabular-nums">{seniorPlus}</span> of{" "}
              <span className="tabular-nums">{allRoles.length}</span> senior+
            </span>
            {salaryBand && (
              <span>
                Salary observed:{" "}
                <span className="font-medium text-foreground tabular-nums font-mono">
                  {salaryBand}
                </span>
              </span>
            )}
          </div>
        )}
        {/* Two columns on sm+: the flat role list is the tallest block, so
            splitting it across columns roughly halves the tab's height. */}
        <ul className="grid gap-x-8 sm:grid-cols-2">
          {allRoles.map((role) => {
            const salary = salaryLabel(role);
            return (
              <li
                key={role.id}
                className="flex items-start justify-between gap-3 border-b border-border py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {role.url ? (
                      <a
                        href={role.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium hover:underline underline-offset-2 inline-flex items-center gap-1"
                      >
                        {role.title}
                        <ExternalLink size={12} className="text-muted-foreground shrink-0" />
                      </a>
                    ) : (
                      <span className="text-sm font-medium">{role.title}</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {[role.dept, role.location].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {salary && (
                    <span className="tabular-nums font-mono text-xs text-foreground/85">
                      {salary}
                    </span>
                  )}
                  {role.seniority && (
                    <span className="rounded-md border border-border bg-card px-1.5 py-0.5 text-xs text-muted-foreground">
                      {capitalize(role.seniority)}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </TabSection>
    </TabCard>
  );
}
