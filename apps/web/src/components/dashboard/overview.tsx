"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  ArrowRight,
  ExternalLink,
  Radar,
  FlaskConical,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { type Signal } from "@/lib/api";
import { signalsQuery, competitorsQuery } from "@/lib/queries";
import { toCsv, downloadCsv } from "@/lib/csv";
import { prettyUrl } from "@/lib/utils";
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
import { useSetAskContext } from "./ask-context";
import { SectionHead } from "./section-head";
import { RecentBattleCards } from "./recent-battle-cards";
import { Kpi } from "./kpi";
import { SeverityBadge } from "./severity-pill";
import { CatPill } from "./cat-pill";
import { CompAvatar } from "./comp-avatar";
import { CategoryBar, CategoryKey } from "./category-bar";
import { DeltaPill, computeDelta } from "./delta-pill";
import { SectoralSignalsSection } from "./sectoral-signals";
import { OnboardingChecklistCard } from "./onboarding-checklist";
import { EmptyState } from "./empty-state";
import { SampleBanner } from "./sample-banner";
import { useSampleMode } from "@/hooks/use-sample-mode";
import { getSampleData } from "@/lib/sample-data";
import { ListError } from "@/components/outrival/list-error";
import { OnboardingAnalysisPanel } from "@/components/onboarding/onboarding-analysis-panel";
import DashboardLoading from "@/app/dashboard/dashboard-skeleton";

const SEV_ORDER: Record<Signal["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// The category wayfinding scale (globals.css --cat-*), shared with the feed pills
// and the competitor charts. A system separate from severity and brand cyan —
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

// Header cell style, shared verbatim with the Competitors page table so the two
// rosters read as one system.
const TH =
  "text-left px-3.5 py-2.5 text-xs text-muted-foreground font-medium border-b border-border whitespace-nowrap";

interface Counts {
  signals: number;
  critical: number;
  activeCompetitors: number;
  totalCompetitors: number;
}

// Buckets signals across the selected [from, to] window into `buckets` equal
// slices, so the sparkline spans the picked range rather than a fixed 10-day tail.
function trendBuckets(
  signals: Signal[],
  fromMs: number,
  toMs: number,
  buckets: number,
): number[] {
  const span = Math.max(1, toMs - fromMs);
  const slice = span / buckets;
  const out = new Array(buckets).fill(0);
  for (const s of signals) {
    const t = new Date(s.createdAt).getTime();
    if (t < fromMs || t > toMs) continue;
    const i = Math.min(buckets - 1, Math.floor((t - fromMs) / slice));
    out[i]++;
  }
  return out;
}

function trendLabels(fromMs: number, toMs: number, buckets: number): string[] {
  const span = Math.max(1, toMs - fromMs);
  const slice = span / buckets;
  const labels: string[] = [];
  for (let i = 0; i < buckets; i++) {
    const date = new Date(fromMs + i * slice);
    labels.push(
      date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    );
  }
  return labels;
}

export function OverviewView() {
  const router = useRouter();
  useSetAskContext({ kind: "view", label: "Overview dashboard" });
  const queryClient = useQueryClient();
  // Server-seeded on first paint (see app/dashboard/page.tsx) → useQuery reads the
  // hydrated cache instead of fetching; falls back to a client fetch when the seed
  // was missing or the server prefetch failed.
  const signalsQ = useQuery(signalsQuery({ limit: 200 }));
  const competitorsQ = useQuery(competitorsQuery());
  const signals = signalsQ.data ?? null;
  const competitors = competitorsQ.data ?? null;
  const err = signalsQ.error ?? competitorsQ.error;
  const [range, setRange] = useState<DateRange>(() => lastNDays(7));
  const rangeFrom = range.from.getTime();
  const rangeTo = range.to.getTime();
  const rangeDays = Math.max(1, Math.round((rangeTo - rangeFrom) / 86_400_000));
  const inWindow = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= rangeFrom && t <= rangeTo;
  };

  // Sample / demo mode (Step 0 cold-start): when on, every computation below
  // reads a fixed fictional dataset instead of the org's data, so a brand-new
  // user can explore a populated interface without writing anything. The raw
  // fetch states stay untouched so exiting sample restores the real view.
  const [sample, setSample] = useSampleMode();
  const sampleData = useMemo(() => getSampleData(), []);
  const dsSignals = sample ? sampleData.signals : signals;
  const dsCompetitors = sample ? sampleData.competitors : competitors;

  // Refresh both feeds — used by the error retry and the onboarding analysis
  // panel's poll. Refetch the exact keys so the cache stays the single source of
  // truth (no parallel useState to keep in sync).
  const load = useCallback(() => {
    void queryClient.refetchQueries({ queryKey: signalsQuery({ limit: 200 }).queryKey });
    void queryClient.refetchQueries({ queryKey: competitorsQuery().queryKey });
  }, [queryClient]);

  function exportCsv() {
    if (!dsSignals) return;
    const rows = dsSignals.filter(
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

  const counts = useMemo<Counts>(() => {
    const inRange = (dsSignals ?? []).filter(
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
      totalCompetitors: dsCompetitors?.length ?? 0,
    };
  }, [dsSignals, dsCompetitors, range]);

  const recentSignals = useMemo(() => {
    if (!dsSignals) return [];
    return dsSignals
      .filter((s) => inWindow(s.createdAt))
      .sort((a, b) => {
        const s = SEV_ORDER[a.severity] - SEV_ORDER[b.severity];
        if (s !== 0) return s;
        return (
          new Date(b.createdAt).getTime() -
          new Date(a.createdAt).getTime()
        );
      })
      .slice(0, 5);
  }, [dsSignals, range]);

  // Top-8 competitor roster, windowed to the selected range so the whole page
  // follows the date picker. Per-competitor counts / delta / category mix are
  // recomputed from the loaded signal set (same ≤200-signal cap as the KPIs, so
  // the two stay internally consistent — may differ slightly from the dedicated
  // Competitors page, which uses uncapped server-side 7d stats). "Last signal"
  // is recency, range-independent: latest loaded signal, falling back to the
  // server stat when a competitor's last move predates the loaded tail.
  const competitorRows = useMemo(() => {
    if (!dsCompetitors) return [];
    const sigs = dsSignals ?? [];
    const span = Math.max(1, rangeTo - rangeFrom);
    const prevFrom = rangeFrom - span;
    const curByComp: Record<string, Signal[]> = {};
    const prevByComp: Record<string, number> = {};
    const lastByComp: Record<string, number> = {};
    for (const s of sigs) {
      const t = new Date(s.createdAt).getTime();
      if (t > (lastByComp[s.competitorId] ?? 0)) lastByComp[s.competitorId] = t;
      if (t >= rangeFrom && t <= rangeTo) {
        (curByComp[s.competitorId] ??= []).push(s);
      } else if (t >= prevFrom && t < rangeFrom) {
        prevByComp[s.competitorId] = (prevByComp[s.competitorId] ?? 0) + 1;
      }
    }
    return [...dsCompetitors]
      .map((c) => {
        const inRange = curByComp[c.id] ?? [];
        const categoryCounts: Record<string, number> = {};
        for (const s of inRange) {
          categoryCounts[s.category] = (categoryCounts[s.category] ?? 0) + 1;
        }
        const last = lastByComp[c.id];
        return {
          id: c.id,
          name: c.name,
          url: c.url,
          category: c.category ?? "—",
          overlap: c.overlapScore != null ? Math.round(c.overlapScore) : null,
          signals: inRange.length,
          delta: computeDelta(inRange.length, prevByComp[c.id] ?? 0),
          categoryCounts,
          lastSignal: last
            ? new Date(last).toISOString()
            : (c.stats?.lastSignalAt ?? null),
        };
      })
      .sort((a, b) => b.signals - a.signals)
      .slice(0, 8);
  }, [dsCompetitors, dsSignals, range]);

  // Scale for the in-row magnitude bar behind the signals value (Plausible
  // pattern): a tinted fill ∝ value, so the column reads as a chart at a glance.
  const maxSignals = useMemo(
    () => competitorRows.reduce((m, c) => Math.max(m, c.signals), 0),
    [competitorRows],
  );

  const categoryBreakdown = useMemo(() => {
    if (!dsSignals) return [];
    const inRange = dsSignals.filter(
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
  }, [dsSignals, range]);

  const totalCats = categoryBreakdown.reduce((a, b) => a + b.count, 0) || 1;
  const [hoveredCat, setHoveredCat] = useState<string | null>(null);

  // One daily bucket per day in the range (≥2 points so a sparkline still reads,
  // capped at 60 so long ranges don't produce sub-pixel bars).
  const sparkBuckets = Math.min(60, Math.max(2, rangeDays));
  const trendSpark = useMemo(
    () =>
      dsSignals
        ? trendBuckets(dsSignals, rangeFrom, rangeTo, sparkBuckets)
        : [],
    [dsSignals, rangeFrom, rangeTo, sparkBuckets],
  );
  const trendSparkLabels = useMemo(
    () => trendLabels(rangeFrom, rangeTo, sparkBuckets),
    [rangeFrom, rangeTo, sparkBuckets],
  );

  // Loading / error gates apply to the live fetch only — sample data is always
  // ready, so demo mode renders immediately even before the real fetch settles.
  if (!sample && err && signals === null) {
    return (
      <div className="mt-10">
        <ListError error={err} onRetry={load} />
      </div>
    );
  }

  if (!sample && (signals === null || competitors === null)) {
    return <DashboardLoading />;
  }

  // Past the gates the effective data is non-null (real fetch resolved, or sample).
  const comps = dsCompetitors ?? [];
  const sigs = dsSignals ?? [];
  const hasCompetitors = comps.length > 0;
  const everHadSignals = sigs.length > 0;
  // Cold-start regimes (NN/g — first-use vs no-results vs populated):
  //  • no competitors      → a setup hero, nothing else (every cell would be empty);
  //  • competitors, no signal yet (`watching`) → a confident wait state instead of
  //    a strip of bare "0" KPIs that reads as broken;
  //  • populated           → the full dashboard.
  const watching = hasCompetitors && !everHadSignals;
  const rangeLabel = `last ${rangeDays} days`;

  // First use — lead with one setup prompt + safe exploration, skip the empty grid.
  if (!sample && !hasCompetitors) {
    return (
      <div className="space-y-9">
        <OnboardingChecklistCard />
        <PageHead
          title="Overview"
          sub="Track every competitor move — pricing, hiring, product, content — as it happens."
        />
        <EmptyState
          icon={Radar}
          title="Start tracking your first competitor"
          description="Outrival watches competitor pricing, hiring, product and content, then turns each change into a signal with the context to act on it. Add a competitor to begin — or explore the interface with sample data first."
          actions={
            <>
              <Button asChild size="sm">
                <Link href="/dashboard/competitors">
                  Add a competitor <ArrowRight size={11} />
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard/discovery">Find competitors</Link>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSample(true)}>
                <FlaskConical size={13} /> Explore with sample data
              </Button>
            </>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-9">
      {/* Progressive streaming right after onboarding (patch-25) — refreshes this
          view each poll so signals/competitors fill in live. Self-hides otherwise. */}
      {!sample && <OnboardingAnalysisPanel onTick={load} />}

      {!sample && <OnboardingChecklistCard />}

      <SampleBanner />

      <PageHead
        title="Overview"
        sub={
          watching
            ? `Watching ${comps.length} competitor${comps.length > 1 ? "s" : ""}.`
            : counts.signals > 0
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
              disabled={counts.signals === 0}
            >
              <Download size={13} /> Export
            </Button>
          </>
        }
      />

      {watching ? (
        <EmptyState
          icon={Radar}
          title={`Outrival is watching ${comps.length} competitor${comps.length > 1 ? "s" : ""}`}
          description="Scans run continuously. Your first signals — pricing, hiring, product and content moves — land here the moment something changes."
          actions={
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard/competitors">
                Review competitors <ArrowRight size={11} />
              </Link>
            </Button>
          }
        />
      ) : (
        <>

      {/* KPI strip — banded surface cells, hairline dividers between them, closed
          by a light rounded border like the controls. */}
      <TooltipProvider delayDuration={80}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-border border border-border rounded-md overflow-hidden">
        <div className="bg-card">
          <Kpi
            label="Signals"
            value={counts.signals}
            delta={counts.signals > 0 ? rangeLabel : "—"}
            deltaKind="pos"
            spark={trendSpark}
            sparkColor="var(--accent)"
            sparkLabels={trendSparkLabels}
            sparkValueLabel="signals"
          />
        </div>
        <div className="bg-card">
          <Kpi
            label="Critical pending"
            value={counts.critical}
            href={
              counts.critical > 0 ? "/dashboard/signals?view=critical" : undefined
            }
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
        <div className="bg-card">
          <Kpi
            label="Active competitors"
            value={counts.activeCompetitors}
            suffix={`/ ${counts.totalCompetitors}`}
            hint={`Competitors that produced at least one signal in the selected period, out of the ${counts.totalCompetitors} you track. Not your plan's competitor limit.`}
            deltaKind="neutral"
            delta={
              counts.activeCompetitors < counts.totalCompetitors
                ? "some silent"
                : "all active"
            }
          />
        </div>
        <div className="bg-card">
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
      </TooltipProvider>

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
              // Reached only in the populated view if the top-5 is momentarily
              // empty — first-use / watching are handled upstream.
              <div className="px-4 py-10 text-sm text-muted-foreground">
                No signals in the {rangeLabel}. Widen the range to see history.
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
                      <span className="font-semibold text-content truncate">
                        {s.competitorName}
                      </span>
                      <SeverityBadge severity={s.severity} />
                      <CatPill size="compact">{s.category}</CatPill>
                    </div>
                    {/* The finding — the lead, clamped to one line */}
                    <div className="text-content leading-snug line-clamp-1">
                      {s.insight}
                    </div>
                    {/* Why it matters — one muted supporting line, clamped */}
                    {s.soWhat && (
                      <div className="text-muted-foreground text-sm mt-1 line-clamp-1">
                        {s.soWhat}
                      </div>
                    )}
                  </div>
                  <span className="text-meta text-muted-foreground mt-[3px]">
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

      {/* Signal categories — a thin band, not a card. Self-hides with no signals. */}
      {categoryBreakdown.length > 0 && (
        <div>
          <h2 className="font-semibold text-lg tracking-tight leading-tight mb-2.5">
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

      {/* Sector trends — meso-level, distinct from the micro signals above.
          Self-fetches real org data, so it's hidden while exploring sample data. */}
      {!sample && <SectoralSignalsSection />}
        </>
      )}

      {/* Top-8 competitor roster — a condensed mirror of the Competitors page
          table: same server stats, same columns, same look. */}
      <section>
        <SectionHead
          title="Your competitors"
          sub={`sorted by activity · ${rangeLabel}`}
          divider={false}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/competitors">
                View all <ArrowRight size={11} />
              </Link>
            </Button>
          }
        />
        <TooltipProvider delayDuration={80}>
        <div className="mt-3 overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse text-dense min-w-[760px]">
            <thead>
              <tr>
                <th className={`${TH} w-8`} />
                <th className={TH}>Competitor</th>
                <th className={TH}>Category</th>
                <th className={TH}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center gap-1 cursor-help">
                        Overlap
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      How closely this competitor overlaps with your product
                      (0–100).
                    </TooltipContent>
                  </Tooltip>
                </th>
                <th className={`${TH} text-right`}>Signals {rangeDays}d</th>
                <th className={`${TH} text-right`}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center gap-1 cursor-help">
                        {rangeDays}d trend
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      Signals in the last {rangeDays} days vs the previous{" "}
                      {rangeDays} days
                    </TooltipContent>
                  </Tooltip>
                </th>
                <th className={TH}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center gap-1 cursor-help">
                        Signal mix ({rangeDays}d)
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="mb-1.5 font-medium normal-case tracking-normal">
                        Share of the last {rangeDays} days&apos; signals by
                        category
                      </p>
                      <CategoryKey />
                    </TooltipContent>
                  </Tooltip>
                </th>
                <th className={TH}>Last signal</th>
                <th className={`${TH} w-8`} />
              </tr>
            </thead>
            <tbody>
              {competitorRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-7">
                    <div className="text-center text-muted-foreground text-dense">
                      No competitors. Add one to get started.
                    </div>
                  </td>
                </tr>
              )}
              {competitorRows.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => router.push(`/dashboard/competitors/${c.id}`)}
                  className="border-b border-border last:border-b-0 cursor-pointer transition-colors hover:bg-accent/50"
                >
                  <td className="px-3.5 py-3 align-middle">
                    <CompAvatar name={c.name} url={c.url} />
                  </td>
                  <td className="px-3.5 py-3 align-middle">
                    <div className="font-medium">
                      <Link
                        href={`/dashboard/competitors/${c.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        {c.name}
                      </Link>
                    </div>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="group/url inline-flex items-center gap-1 mt-px w-fit max-w-full font-mono text-meta text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <span className="truncate underline-offset-2 group-hover/url:underline">
                        {prettyUrl(c.url)}
                      </span>
                      <ExternalLink
                        size={10}
                        className="shrink-0 opacity-0 transition-opacity group-hover/url:opacity-100"
                      />
                    </a>
                  </td>
                  <td className="px-3.5 py-3 align-middle text-muted-foreground">
                    {c.category}
                  </td>
                  <td className="px-3.5 py-3 align-middle">
                    {c.overlap != null ? (
                      <div className="flex items-center gap-2.5">
                        <div className="h-1.5 w-[70px] bg-background rounded border border-border overflow-hidden">
                          <span
                            className="block h-full bg-primary rounded"
                            style={{ width: `${c.overlap}%` }}
                          />
                        </div>
                        <span className="tabular-nums font-mono text-xs w-6">
                          {c.overlap}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="relative px-3.5 py-3 align-middle text-right tabular-nums font-mono font-semibold">
                    {maxSignals > 0 && c.signals > 0 && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-y-1.5 left-1 rounded-sm bg-muted-foreground/10"
                        style={{
                          width: `calc(${(c.signals / maxSignals) * 100}% - 8px)`,
                        }}
                      />
                    )}
                    <span className="relative">{c.signals}</span>
                  </td>
                  <td className="px-3.5 py-3 align-middle text-right">
                    <DeltaPill delta={c.delta} />
                  </td>
                  <td className="px-3.5 py-3 align-middle">
                    <CategoryBar counts={c.categoryCounts} w={110} />
                  </td>
                  <td className="px-3.5 py-3 align-middle text-muted-foreground tabular-nums font-mono text-xs">
                    {c.lastSignal
                      ? formatDistanceToNow(new Date(c.lastSignal), {
                          addSuffix: true,
                        })
                      : "—"}
                  </td>
                  <td className="w-8 text-right px-3.5 py-3 align-middle">
                    <ArrowRight
                      size={14}
                      className="text-muted-foreground inline"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </TooltipProvider>
      </section>

      {!sample && <RecentBattleCards />}
    </div>
  );
}
