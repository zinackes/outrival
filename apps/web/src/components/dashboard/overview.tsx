"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, ArrowRight, Lightbulb, Target } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  api,
  type Signal,
  type Competitor,
  type Monitor,
} from "@/lib/api";
import { toCsv, downloadCsv } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import {
  DateRangePicker,
  lastNDays,
  type DateRange,
} from "@/components/ui/date-range-picker";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PageHead } from "./page-head";
import { SectionHead } from "./section-head";
import { RecentBattleCards } from "./recent-battle-cards";
import { Kpi } from "./kpi";
import { Sparkline } from "./sparkline";
import { SeverityBadge } from "./severity-pill";
import { CompAvatar } from "./comp-avatar";
import { SectoralSignalsSection } from "./sectoral-signals";
import { OnboardingChecklistCard } from "./onboarding-checklist";
import { ListError } from "@/components/outrival/list-error";
import { OnboardingAnalysisPanel } from "@/components/onboarding/onboarding-analysis-panel";
import DashboardLoading from "@/app/dashboard/loading";

const SEV_ORDER: Record<Signal["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// The category wayfinding scale (globals.css --cat-*), shared with the feed pills
// and the competitor charts. A system separate from severity and brand amber —
// the old map borrowed those hues, which mislabeled pricing as critical-red and
// spent the brand accent on a category.
const CATEGORY_COLORS: Record<string, string> = {
  pricing: "var(--cat-pricing)",
  product: "var(--cat-product)",
  hiring: "var(--cat-hiring)",
  reviews: "var(--cat-reviews)",
  content: "var(--cat-content)",
  funding: "var(--cat-funding)",
};

interface Counts {
  signals: number;
  critical: number;
  activeCompetitors: number;
  totalCompetitors: number;
}

// Scrape freshness folded into the competitor roster (replaces the standalone
// Monitor health card): green = a monitor ran recently, amber = slowing, muted =
// stale or never run / unknown.
const HEALTH_RECENT_MS = 48 * 3600 * 1000;
const HEALTH_SLOW_MS = 8 * 24 * 3600 * 1000;

function healthDot(lastRun: number | null): { className: string; label: string } {
  if (lastRun == null)
    return { className: "bg-muted-foreground/35", label: "no scrape yet" };
  const age = Date.now() - lastRun;
  const rel = formatDistanceToNow(new Date(lastRun), { addSuffix: true });
  if (age <= HEALTH_RECENT_MS)
    return { className: "bg-positive", label: `scraped ${rel}` };
  if (age <= HEALTH_SLOW_MS)
    return { className: "bg-medium", label: `scraped ${rel}` };
  return { className: "bg-muted-foreground/35", label: `stale · scraped ${rel}` };
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

export function OverviewView() {
  const router = useRouter();
  const [signals, setSignals] = useState<Signal[] | null>(null);
  const [competitors, setCompetitors] = useState<Competitor[] | null>(null);
  const [monitors, setMonitors] = useState<Monitor[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [range, setRange] = useState<DateRange>(() => lastNDays(7));
  const rangeFrom = range.from.getTime();
  const rangeTo = range.to.getTime();
  const rangeDays = Math.max(1, Math.round((rangeTo - rangeFrom) / 86_400_000));
  const inWindow = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= rangeFrom && t <= rangeTo;
  };

  const load = useCallback(() => {
    setErr(null);
    Promise.all([api.listSignals({ limit: 200 }), api.listCompetitors()])
      .then(([s, c]) => {
        setSignals(s.signals);
        setCompetitors(c.competitors);
      })
      .catch((e) => setErr(e));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function exportCsv() {
    if (!signals) return;
    const rows = signals.filter(
      (s) => inWindow(s.createdAt),
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
    downloadCsv(`outrival-overview-${rangeDays}d-${date}.csv`, csv);
  }

  // Fetch monitors for the same competitors the roster shows (top 8) so the
  // per-row health dot is accurate across every visible row.
  useEffect(() => {
    if (!competitors || competitors.length === 0) {
      setMonitors([]);
      return;
    }
    Promise.all(
      competitors.slice(0, 8).map((c) =>
        api
          .getCompetitor(c.id)
          .then((r) => r.monitors)
          .catch(() => [] as Monitor[]),
      ),
    ).then((groups) => setMonitors(groups.flat()));
  }, [competitors]);

  const counts = useMemo<Counts>(() => {
    const inRange = (signals ?? []).filter(
      (s) => inWindow(s.createdAt),
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

  // Scrape freshness + monitor count per competitor, derived from the monitors
  // we fetched above.
  const monitorHealth = useMemo(() => {
    const map = new Map<string, { count: number; lastRun: number | null }>();
    for (const m of monitors ?? []) {
      const cur = map.get(m.competitorId) ?? { count: 0, lastRun: null };
      cur.count += 1;
      const t = m.lastRunAt ? new Date(m.lastRunAt).getTime() : null;
      if (t != null) cur.lastRun = Math.max(cur.lastRun ?? 0, t);
      map.set(m.competitorId, cur);
    }
    return map;
  }, [monitors]);

  const competitorRows = useMemo(() => {
    if (!competitors || !signals) return [];
    return competitors.slice(0, 8).map((c) => {
      const compSignals = signals.filter(
        (s) =>
          s.competitorId === c.id &&
          inWindow(s.createdAt),
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
    const inRange = signals.filter(
      (s) => inWindow(s.createdAt),
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
  const [hoveredCat, setHoveredCat] = useState<string | null>(null);

  const trend7Sparkline = useMemo(
    () => (signals ? trendBuckets(signals, 10) : []),
    [signals],
  );
  const trend7Labels = useMemo(() => trendLabels(10), []);

  if (err && signals === null) {
    return (
      <div className="mt-10">
        <ListError error={err} onRetry={load} />
      </div>
    );
  }

  if (signals === null || competitors === null) {
    return <DashboardLoading />;
  }

  const rangeLabel = `last ${rangeDays} days`;

  return (
    <div className="space-y-9">
      {/* Progressive streaming right after onboarding (patch-25) — refreshes this
          view each poll so signals/competitors fill in live. Self-hides otherwise. */}
      <OnboardingAnalysisPanel onTick={load} />

      <OnboardingChecklistCard />

      <PageHead
        title="Overview"
        sub={
          counts.signals > 0
            ? `${counts.activeCompetitors} competitor${counts.activeCompetitors > 1 ? "s" : ""} moved in this period · ${counts.critical} critical signal${counts.critical > 1 ? "s" : ""} pending.`
            : `No signals in the last ${rangeDays} days.`
        }
        actions={
          <>
            <DateRangePicker value={range} onChange={setRange} />
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

      {/* KPI strip — banded surface cells, hairline dividers between them, closed
          by a light rounded border like the controls. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-border border border-border rounded-md overflow-hidden">
        <div className="bg-gradient-card">
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
        <div className="bg-gradient-card">
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
        <div className="bg-gradient-card">
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
        <div className="bg-gradient-card">
          <Kpi
            label="Last signal"
            valueClassName="text-lg"
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

      {/* Signal categories — a thin band, not a card. Self-hides with no signals. */}
      {categoryBreakdown.length > 0 && (
        <div>
          <h2 className="font-semibold text-content tracking-tight leading-tight mb-2.5">
            Signal categories
          </h2>
          <TooltipProvider delayDuration={80}>
            <div className="flex h-2 rounded-full overflow-hidden bg-background">
              {categoryBreakdown.map((c) => {
                const pct = (c.count / totalCats) * 100;
                const isActive = hoveredCat === c.name;
                const isDimmed = hoveredCat !== null && !isActive;
                return (
                  <Tooltip key={c.name}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={`${c.name}: ${c.count} signals`}
                        onMouseEnter={() => setHoveredCat(c.name)}
                        onMouseLeave={() => setHoveredCat(null)}
                        onFocus={() => setHoveredCat(c.name)}
                        onBlur={() => setHoveredCat(null)}
                        className="h-full cursor-default outline-none transition-[opacity,filter] duration-300 ease-out focus-visible:shadow-[inset_0_0_0_2px_var(--ring)]"
                        style={{
                          background: c.color,
                          width: `${pct}%`,
                          opacity: isDimmed ? 0.25 : 1,
                          filter: isActive
                            ? "brightness(1.15) saturate(1.1)"
                            : undefined,
                        }}
                      />
                    </TooltipTrigger>
                    <TooltipContent className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-sm"
                        style={{ background: c.color }}
                      />
                      <span className="capitalize font-medium">{c.name}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {c.count} · {Math.round(pct)}%
                      </span>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </TooltipProvider>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
            {categoryBreakdown.map((c) => {
              const isActive = hoveredCat === c.name;
              const isDimmed = hoveredCat !== null && !isActive;
              return (
                <span
                  key={c.name}
                  onMouseEnter={() => setHoveredCat(c.name)}
                  onMouseLeave={() => setHoveredCat(null)}
                  className="flex items-center gap-1.5 text-xs cursor-default transition-opacity duration-200"
                  style={{ opacity: isDimmed ? 0.4 : 1 }}
                >
                  <span
                    className="w-2 h-2 rounded-sm transition-transform duration-200 ease-out"
                    style={{
                      background: c.color,
                      transform: isActive ? "scale(1.4)" : undefined,
                    }}
                  />
                  <span
                    className={`capitalize text-meta transition-colors duration-200 ${
                      isActive ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {c.name}
                  </span>
                  <span className="tabular-nums font-mono">{c.count}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent signals — the hero list, closed by a light rounded border like
          the controls. */}
      <section>
        <SectionHead
          title="Recent signals"
          sub="sorted by severity then date"
          divider={false}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/signals">
                View all <ArrowRight size={11} />
              </Link>
            </Button>
          }
        />
        <TooltipProvider delayDuration={80}>
          <div className="mt-3 max-h-[440px] overflow-y-auto rounded-md border border-border">
            {recentSignals.length === 0 ? (
              <div className="px-4 py-12 text-center text-muted-foreground">
                <div className="font-semibold text-base text-foreground mb-1.5 tracking-tight">
                  No signals yet
                </div>
                <div className="text-dense max-w-[380px] mx-auto">
                  Scans run continuously. The first signals will appear here as
                  soon as a change is detected.
                </div>
              </div>
            ) : (
              recentSignals.map((s) => (
                <Link
                  key={s.id}
                  href={`/dashboard/signals?focus=${s.id}`}
                  className="grid grid-cols-[1fr_auto] gap-3 max-sm:gap-2 items-start px-4 py-3.5 max-sm:py-2.5 border-b border-border last:border-b-0 cursor-pointer hover:bg-accent/50 transition-colors"
                >
                  <div className="min-w-0 max-w-[120ch]">
                    {/* Classification header — who / severity / category grouped on
                        one meta line, kept distinct from the body prose below so the
                        eye reads "who & how bad" before "what & what to do". */}
                    <div className="flex items-center gap-2 mb-1.5 min-w-0">
                      <SeverityBadge severity={s.severity} />
                      <span className="font-medium text-dense truncate">
                        {s.competitorName}
                      </span>
                      <span className="font-mono text-meta text-muted-foreground shrink-0">
                        {s.category}
                      </span>
                    </div>
                    {/* The finding — the lead */}
                    <div className="text-content max-sm:text-sm leading-snug">
                      {s.insight}
                    </div>
                    {/* Why it matters — recedes (muted) */}
                    {s.soWhat && (
                      <div className="flex items-start gap-1.5 text-muted-foreground text-dense mt-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="mt-[3px] shrink-0 inline-flex cursor-help">
                              <Lightbulb size={13} aria-label="Why it matters" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Why it matters</TooltipContent>
                        </Tooltip>
                        <span>{s.soWhat}</span>
                      </div>
                    )}
                    {/* What to do — pops by weight, not by colour */}
                    {s.recommendedAction && (
                      <div className="flex items-start gap-1.5 text-dense font-medium mt-1.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="mt-[3px] shrink-0 inline-flex cursor-help text-muted-foreground">
                              <Target size={13} aria-label="Recommended action" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Recommended action</TooltipContent>
                        </Tooltip>
                        <span>{s.recommendedAction}</span>
                      </div>
                    )}
                  </div>
                  <span className="font-mono text-meta text-muted-foreground mt-[3px]">
                    {formatDistanceToNow(new Date(s.createdAt), {
                      addSuffix: true,
                    })}
                  </span>
                </Link>
              ))
            )}
          </div>
        </TooltipProvider>
      </section>

      {/* Sector trends — meso-level, distinct from the micro signals above */}
      <SectoralSignalsSection />

      {/* Competitors at a glance — boxless table; scrape health folded in as a
          leading dot + monitor count (replaces the Monitor health card). */}
      <section>
        <SectionHead
          title="Your competitors"
          sub={`sorted by activity · last ${rangeDays} days`}
          divider={false}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/competitors">
                View all <ArrowRight size={11} />
              </Link>
            </Button>
          }
        />
        <div className="mt-3 overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse text-dense min-w-[640px]">
            <thead>
              <tr>
                <th className="w-6 border-b border-border" aria-label="Scrape health" />
                <th className="text-left px-3.5 py-2.5 font-mono text-meta text-muted-foreground font-medium border-b border-border whitespace-nowrap">
                  Competitor
                </th>
                <th className="text-left px-3.5 py-2.5 font-mono text-meta text-muted-foreground font-medium border-b border-border whitespace-nowrap">
                  Category
                </th>
                <th className="text-left px-3.5 py-2.5 font-mono text-meta text-muted-foreground font-medium border-b border-border whitespace-nowrap">
                  Overlap
                </th>
                <th className="text-left px-3.5 py-2.5 font-mono text-meta text-muted-foreground font-medium border-b border-border whitespace-nowrap">
                  Signals {rangeDays}d
                </th>
                <th className="text-left px-3.5 py-2.5 font-mono text-meta text-muted-foreground font-medium border-b border-border whitespace-nowrap">
                  Trend
                </th>
                <th className="text-left px-3.5 py-2.5 font-mono text-meta text-muted-foreground font-medium border-b border-border whitespace-nowrap">
                  Last signal
                </th>
                <th className="border-b border-border" />
              </tr>
            </thead>
            <tbody>
              {competitorRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-7">
                    <div className="text-center text-muted-foreground text-dense">
                      No competitors. Add one to get started.
                    </div>
                  </td>
                </tr>
              )}
              {competitorRows.map((c) => {
                const health = monitorHealth.get(c.id);
                const dot = healthDot(health?.lastRun ?? null);
                return (
                  <tr
                    key={c.id}
                    onClick={() =>
                      router.push(`/dashboard/competitors/${c.id}`)
                    }
                    className="border-b border-border last:border-b-0 cursor-pointer transition-colors hover:bg-accent/50"
                  >
                    <td className="pl-1.5 align-middle">
                      <span
                        className={`block w-[7px] h-[7px] rounded-full ${dot.className}`}
                        title={dot.label}
                        aria-label={dot.label}
                      />
                    </td>
                    <td className="px-3.5 py-3 align-middle">
                      <div className="flex items-center gap-2.5">
                        <CompAvatar name={c.name} />
                        <div className="min-w-0">
                          <div className="font-medium">{c.name}</div>
                          <div className="text-muted-foreground text-meta mt-px font-mono truncate">
                            {c.url}
                            {health && health.count > 0
                              ? ` · ${health.count} monitor${health.count > 1 ? "s" : ""}`
                              : ""}
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
                              className="block h-full bg-foreground/35 rounded"
                              style={{ width: `${c.overlap}%` }}
                            />
                          </div>
                          <span className="tabular-nums font-mono text-xs text-muted-foreground">
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
                        color="var(--muted-3)"
                        interactive
                      />
                    </td>
                    <td className="px-3.5 py-3 align-middle text-muted-foreground tabular-nums font-mono text-xs">
                      {c.lastScrape}
                    </td>
                    <td className="w-8 text-right px-3.5 py-3 align-middle">
                      <ArrowRight
                        size={14}
                        className="text-muted-foreground inline"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <RecentBattleCards />
    </div>
  );
}
