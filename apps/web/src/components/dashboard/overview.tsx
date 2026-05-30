"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, ArrowRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  api,
  type Signal,
  type Competitor,
  type Monitor,
} from "@/lib/api";
import { toCsv, downloadCsv } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PageHead } from "./page-head";
import { Kpi } from "./kpi";
import { Sparkline } from "./sparkline";
import { SeverityDot } from "./severity-pill";
import { CompAvatar } from "./comp-avatar";
import DashboardLoading from "@/app/dashboard/loading";

type Range = 7 | 30 | 90;

const SEV_ORDER: Record<Signal["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const CATEGORY_COLORS: Record<string, string> = {
  pricing: "var(--critical)",
  product: "var(--accent)",
  hiring: "var(--medium)",
  reviews: "var(--muted)",
  content: "var(--muted-3)",
  funding: "var(--muted-3)",
};

interface Counts {
  signals: number;
  critical: number;
  activeCompetitors: number;
  totalCompetitors: number;
}

function trendBuckets(signals: Signal[], days = 10): number[] {
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const buckets = new Array(days).fill(0);
  for (const s of signals) {
    const t = new Date(s.createdAt).getTime();
    const bucket = days - 1 - Math.floor((now - t) / day);
    if (bucket >= 0 && bucket < days) buckets[bucket]++;
  }
  return buckets;
}

function trendLabels(days = 10): string[] {
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const labels: string[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(now - (days - 1 - i) * day);
    labels.push(
      date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    );
  }
  return labels;
}

const SEV_TEXT: Record<Signal["severity"], string> = {
  critical: "text-critical",
  high: "text-high",
  medium: "text-medium",
  low: "text-muted-foreground",
};

export function OverviewView() {
  const router = useRouter();
  const [signals, setSignals] = useState<Signal[] | null>(null);
  const [competitors, setCompetitors] = useState<Competitor[] | null>(null);
  const [monitors, setMonitors] = useState<Monitor[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [range, setRange] = useState<Range>(7);

  useEffect(() => {
    Promise.all([api.listSignals({ limit: 200 }), api.listCompetitors()])
      .then(([s, c]) => {
        setSignals(s.signals);
        setCompetitors(c.competitors);
      })
      .catch((e) => setErr(String(e)));
  }, []);

  function exportCsv() {
    if (!signals) return;
    const since = Date.now() - range * 24 * 3600 * 1000;
    const rows = signals.filter(
      (s) => new Date(s.createdAt).getTime() >= since,
    );
    if (!rows.length) return;
    const csv = toCsv(rows, [
      { key: "createdAt", label: "Date" },
      { key: "severity", label: "Severity" },
      { key: "category", label: "Category" },
      { key: "competitorName", label: "Competitor" },
      { key: "insight", label: "Insight" },
      { key: "soWhat", label: "So what" },
      { key: "recommendedAction", label: "Recommended action" },
    ]);
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(`outrival-overview-${range}d-${date}.csv`, csv);
  }

  useEffect(() => {
    if (!competitors || competitors.length === 0) {
      setMonitors([]);
      return;
    }
    Promise.all(
      competitors.slice(0, 5).map((c) =>
        api
          .getCompetitor(c.id)
          .then((r) => r.monitors)
          .catch(() => [] as Monitor[]),
      ),
    ).then((groups) => setMonitors(groups.flat()));
  }, [competitors]);

  const counts = useMemo<Counts>(() => {
    const since = Date.now() - range * 24 * 3600 * 1000;
    const inRange = (signals ?? []).filter(
      (s) => new Date(s.createdAt).getTime() >= since,
    );
    const critical = inRange.filter(
      (s) => s.severity === "critical" && !s.isRead,
    ).length;
    const activeIds = new Set(inRange.map((s) => s.competitorId));
    return {
      signals: inRange.length,
      critical,
      activeCompetitors: activeIds.size,
      totalCompetitors: competitors?.length ?? 0,
    };
  }, [signals, competitors, range]);

  const recentSignals = useMemo(() => {
    if (!signals) return [];
    return [...signals]
      .sort((a, b) => {
        const s = SEV_ORDER[a.severity] - SEV_ORDER[b.severity];
        if (s !== 0) return s;
        return (
          new Date(b.createdAt).getTime() -
          new Date(a.createdAt).getTime()
        );
      })
      .slice(0, 5);
  }, [signals]);

  const competitorRows = useMemo(() => {
    if (!competitors || !signals) return [];
    const since = Date.now() - range * 24 * 3600 * 1000;
    return competitors.slice(0, 8).map((c) => {
      const compSignals = signals.filter(
        (s) =>
          s.competitorId === c.id &&
          new Date(s.createdAt).getTime() >= since,
      );
      const trend = trendBuckets(compSignals, 10);
      const last = compSignals[0]?.createdAt
        ? formatDistanceToNow(new Date(compSignals[0].createdAt), {
            addSuffix: true,
          })
        : "—";
      return {
        id: c.id,
        name: c.name,
        url: c.url,
        category: c.category ?? "—",
        overlap: c.overlapScore != null ? Math.round(c.overlapScore) : null,
        signals7d: compSignals.length,
        trend,
        lastScrape: last,
      };
    });
  }, [competitors, signals, range]);

  const categoryBreakdown = useMemo(() => {
    if (!signals) return [];
    const since = Date.now() - range * 24 * 3600 * 1000;
    const inRange = signals.filter(
      (s) => new Date(s.createdAt).getTime() >= since,
    );
    const map: Record<string, number> = {};
    for (const s of inRange) {
      map[s.category] = (map[s.category] ?? 0) + 1;
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({
        name,
        count,
        color: CATEGORY_COLORS[name] ?? "var(--muted-3)",
      }));
  }, [signals, range]);

  const totalCats = categoryBreakdown.reduce((a, b) => a + b.count, 0) || 1;

  const trend7Sparkline = useMemo(
    () => (signals ? trendBuckets(signals, 10) : []),
    [signals],
  );
  const trend7Labels = useMemo(() => trendLabels(10), []);

  if (err) {
    return <p className="text-sm text-muted-foreground">Error: {err}</p>;
  }

  if (signals === null || competitors === null) {
    return <DashboardLoading />;
  }

  const rangeLabel = range === 7 ? "last 7 days" : range === 30 ? "last 30 days" : "last 90 days";

  return (
    <div className="space-y-[22px]">
      <PageHead
        title="Overview"
        sub={
          counts.signals > 0
            ? `${counts.activeCompetitors} competitor${counts.activeCompetitors > 1 ? "s" : ""} moved in this period · ${counts.critical} critical signal${counts.critical > 1 ? "s" : ""} pending.`
            : `No signals in the last ${range} days.`
        }
        actions={
          <>
            <ToggleGroup
              type="single"
              value={String(range)}
              onValueChange={(v) => v && setRange(Number(v) as Range)}
              variant="outline"
              size="sm"
              aria-label="Range"
            >
              {[7, 30, 90].map((r) => (
                <ToggleGroupItem key={r} value={String(r)}>
                  {r} days
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Button
              variant="outline"
              size="sm"
              onClick={exportCsv}
              disabled={!signals || counts.signals === 0}
            >
              <Download size={13} /> Export
            </Button>
          </>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-border border border-border rounded-md overflow-hidden">
        <div className="bg-surface">
          <Kpi
            label="Signals"
            value={counts.signals}
            delta={counts.signals > 0 ? rangeLabel : "—"}
            deltaKind="pos"
            spark={trend7Sparkline}
            sparkColor="var(--accent)"
            sparkLabels={trend7Labels}
            sparkValueLabel="signals"
          />
        </div>
        <div className="bg-surface">
          <Kpi
            label="Critical pending"
            value={counts.critical}
            deltaKind={counts.critical > 0 ? "neg" : "neutral"}
            delta={counts.critical > 0 ? "action required" : "nothing to handle"}
            meta={
              counts.critical > 0
                ? recentSignals
                    .filter((s) => s.severity === "critical")
                    .slice(0, 2)
                    .map((s) => `${s.competitorName} · ${s.category}`)
                    .join(" · ") || undefined
                : undefined
            }
          />
        </div>
        <div className="bg-surface">
          <Kpi
            label="Active competitors"
            value={counts.activeCompetitors}
            suffix={`/ ${counts.totalCompetitors}`}
            deltaKind="neutral"
            delta={
              counts.activeCompetitors < counts.totalCompetitors
                ? "some silent"
                : "all active"
            }
            meta={
              monitors ? `${monitors.length} monitors` : "monitors —"
            }
          />
        </div>
        <div className="bg-surface">
          <Kpi
            label="Last signal"
            value={
              recentSignals[0]
                ? formatDistanceToNow(new Date(recentSignals[0].createdAt), {
                    addSuffix: true,
                  })
                : "—"
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-[18px]">
        {/* Recent signals */}
        <Card>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border gap-3">
            <div>
              <div className="font-semibold text-[13px] tracking-tight">
                Recent signals
              </div>
              <div className="text-muted-foreground/80 text-[11px] font-mono">
                sorted by severity then date
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/signals">
                View all <ArrowRight size={11} />
              </Link>
            </Button>
          </div>
          <div>
            {recentSignals.length === 0 ? (
              <div className="px-6 py-12 text-center text-muted-foreground">
                <div className="font-semibold text-base text-foreground mb-1.5 tracking-tight">
                  No signals yet
                </div>
                <div className="text-[13px] max-w-[380px] mx-auto">
                  Scans run continuously. The first signals will appear here
                  as soon as a change is detected.
                </div>
              </div>
            ) : (
              recentSignals.map((s) => (
                <Link
                  key={s.id}
                  href="/dashboard/signals"
                  className="grid grid-cols-[12px_1fr_auto] gap-3 max-sm:gap-2 items-start px-3.5 py-3 max-sm:px-3 max-sm:py-2.5 border-b border-border last:border-b-0 cursor-pointer hover:bg-accent/50 transition-colors"
                >
                  <span className="mt-[6px]">
                    <SeverityDot severity={s.severity} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] max-sm:text-[12.5px] leading-snug">
                      <b className="font-semibold">{s.competitorName}.</b>{" "}
                      {s.insight}
                    </div>
                    {s.soWhat && (
                      <div className="text-muted-foreground text-xs mt-1">
                        → {s.soWhat}
                      </div>
                    )}
                    <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      <span>{s.category}</span>
                      <span className="text-muted-foreground/40">·</span>
                      <span className={SEV_TEXT[s.severity]}>{s.severity}</span>
                    </div>
                  </div>
                  <span className="font-mono text-[11px] text-muted-foreground/80 mt-[3px]">
                    {formatDistanceToNow(new Date(s.createdAt), {
                      addSuffix: true,
                    })}
                  </span>
                </Link>
              ))
            )}
          </div>
        </Card>

        {/* Right column */}
        <div className="space-y-[14px]">
          <Card>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border gap-3">
              <div className="font-semibold text-[13px] tracking-tight">
                Categories — {range}d
              </div>
            </div>
            <div className="px-5 py-[18px]">
              {categoryBreakdown.length === 0 ? (
                <p className="text-muted-foreground text-[13px]">
                  No signals in the last {range} days.
                </p>
              ) : (
                <>
                  <div className="flex h-2.5 rounded overflow-hidden bg-background mb-4">
                    {categoryBreakdown.map((c) => (
                      <div
                        key={c.name}
                        title={`${c.name}: ${c.count}`}
                        style={{
                          background: c.color,
                          width: `${(c.count / totalCats) * 100}%`,
                        }}
                      />
                    ))}
                  </div>
                  <div className="grid gap-2">
                    {categoryBreakdown.map((c) => (
                      <div
                        key={c.name}
                        className="flex items-center gap-2.5 text-xs"
                      >
                        <span
                          className="w-2 h-2 rounded-sm"
                          style={{ background: c.color }}
                        />
                        <span className="flex-1 text-muted-foreground font-mono uppercase text-[10px] tracking-widest">
                          {c.name}
                        </span>
                        <span className="tabular-nums font-mono">
                          {c.count}
                        </span>
                        <span className="text-muted-foreground/80 text-[11px] w-9 text-right tabular-nums font-mono">
                          {Math.round((c.count / totalCats) * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border gap-3">
              <div>
                <div className="font-semibold text-[13px] tracking-tight">
                  Monitor health
                </div>
                <div className="text-muted-foreground/80 text-[11px] font-mono">
                  {monitors ? `${monitors.length} monitors` : "loading…"}
                </div>
              </div>
            </div>
            <div>
              {(monitors ?? []).slice(0, 5).map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-2.5 px-4 py-[11px] border-b border-border last:border-b-0"
                >
                  <span className="tabular-nums font-mono text-muted-foreground text-[11px]">
                    {m.sourceType}
                  </span>
                  <div className="flex-1 text-[13px] font-medium">
                    {competitors?.find((c) => c.id === m.competitorId)?.name ??
                      "—"}
                  </div>
                  <span className="tabular-nums font-mono text-muted-foreground/80 text-[11px]">
                    {m.lastRunAt
                      ? formatDistanceToNow(new Date(m.lastRunAt), { addSuffix: true })
                      : "never"}
                  </span>
                </div>
              ))}
              {monitors?.length === 0 && (
                <div className="p-5 text-muted-foreground text-[13px]">
                  No monitors configured.
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Competitors at a glance */}
      <Card>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border gap-3">
          <div>
            <div className="font-semibold text-[13px] tracking-tight">
              Your competitors
            </div>
            <div className="text-muted-foreground/80 text-[11px] font-mono">
              sorted by activity · last {range} days
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/competitors">
              View all <ArrowRight size={11} />
            </Link>
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px] min-w-[640px]">
            <thead className="bg-background">
              <tr>
                <th className="text-left px-3.5 py-2.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground font-medium border-b border-border whitespace-nowrap">
                  Competitor
                </th>
                <th className="text-left px-3.5 py-2.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground font-medium border-b border-border whitespace-nowrap">
                  Category
                </th>
                <th className="text-left px-3.5 py-2.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground font-medium border-b border-border whitespace-nowrap">
                  Overlap
                </th>
                <th className="text-left px-3.5 py-2.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground font-medium border-b border-border whitespace-nowrap">
                  Signals {range}d
                </th>
                <th className="text-left px-3.5 py-2.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground font-medium border-b border-border whitespace-nowrap">
                  Trend
                </th>
                <th className="text-left px-3.5 py-2.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground font-medium border-b border-border whitespace-nowrap">
                  Last signal
                </th>
                <th className="border-b border-border" />
              </tr>
            </thead>
            <tbody>
              {competitorRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-7">
                    <div className="text-center text-muted-foreground text-[13px]">
                      No competitors. Add one to get started.
                    </div>
                  </td>
                </tr>
              )}
              {competitorRows.map((c) => (
                <tr
                  key={c.id}
                  onClick={() =>
                    router.push(`/dashboard/competitors/${c.id}`)
                  }
                  className="border-b border-border last:border-b-0 cursor-pointer transition-colors hover:bg-accent/50"
                >
                  <td className="px-3.5 py-3 align-middle">
                    <div className="flex items-center gap-2.5">
                      <CompAvatar name={c.name} />
                      <div>
                        <div className="font-medium">{c.name}</div>
                        <div className="text-muted-foreground/80 text-[11px] mt-px font-mono">
                          {c.url}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3.5 py-3 align-middle text-muted-foreground">
                    {c.category}
                  </td>
                  <td className="px-3.5 py-3 align-middle">
                    {c.overlap != null ? (
                      <div className="flex items-center gap-2.5 min-w-[140px]">
                        <div className="h-1.5 w-20 bg-background rounded border border-border overflow-hidden">
                          <span
                            className="block h-full bg-primary rounded"
                            style={{ width: `${c.overlap}%` }}
                          />
                        </div>
                        <span className="tabular-nums font-mono text-xs">
                          {c.overlap}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3.5 py-3 align-middle">
                    <span className="tabular-nums font-mono font-semibold">
                      {c.signals7d}
                    </span>
                  </td>
                  <td className="px-3.5 py-3 align-middle">
                    <Sparkline
                      data={c.trend}
                      labels={trend7Labels}
                      valueLabel="signals"
                      w={80}
                      h={24}
                      color="var(--accent)"
                      interactive
                    />
                  </td>
                  <td className="px-3.5 py-3 align-middle text-muted-foreground tabular-nums font-mono text-xs">
                    {c.lastScrape}
                  </td>
                  <td className="w-8 text-right px-3.5 py-3 align-middle">
                    <ArrowRight
                      size={14}
                      className="text-muted-foreground/80 inline"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
