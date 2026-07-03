"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import { Download, ArrowRight, Radar, FlaskConical } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { type Signal } from "@/lib/api";
import { signalsQuery, competitorsQuery } from "@/lib/queries";
import { toCsv, downloadCsv } from "@/lib/csv";
import { formatDate } from "@/lib/format-date";
import { Button } from "@/components/ui/button";
import {
  DateRangePicker,
  lastNDays,
  type DateRange,
} from "@/components/ui/date-range-picker";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PageHead } from "./page-head";
import { useSetAskContext } from "./ask-context";
import { SectionHead } from "./section-head";
import { RecentBattleCards } from "./recent-battle-cards";
import { Kpi } from "./kpi";
import { SeverityBadge } from "./severity-pill";
import { CatPill } from "./cat-pill";
import { OnboardingChecklistCard } from "./onboarding-checklist";
import { LandscapeSection } from "./landscape";
import { EmptyState } from "./empty-state";
import { SampleBanner } from "./sample-banner";
import { useSampleMode } from "@/hooks/use-sample-mode";
import { getSampleData } from "@/lib/sample-data";
import { ListError } from "@/components/outrival/list-error";
import { OnboardingAnalysisPanel } from "@/components/onboarding/onboarding-analysis-panel";
import { useOnboardingStreaming } from "@/hooks/use-onboarding-streaming";
import DashboardLoading from "@/app/dashboard/dashboard-skeleton";

const SEV_ORDER: Record<Signal["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

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
    labels.push(formatDate(date, { month: "short", day: "numeric" }));
  }
  return labels;
}

export function OverviewView() {
  useSetAskContext({ kind: "view", label: "Overview dashboard" });
  const queryClient = useQueryClient();
  // patch-28 — active product scope (cookie-backed switcher, URL ?product= overrides).
  const productId = useProductScope() ?? undefined;
  // Server-seeded on first paint (see app/dashboard/page.tsx) → useQuery reads the
  // hydrated cache instead of fetching; falls back to a client fetch when the seed
  // was missing or the server prefetch failed.
  // Poll every 30s (matching the competitors list / sidebar roster). The global
  // QueryClient is staleTime 60s + refetchOnWindowFocus:false, so without an interval
  // the "Recent signals" list — and the watching→populated flip that gates on the first
  // signal landing in signalsQ — never refresh on their own, while the count surfaces do.
  const signalsQ = useQuery({ ...signalsQuery({ limit: 200, productId }), refetchInterval: 30_000 });
  const competitorsQ = useQuery({ ...competitorsQuery(productId), refetchInterval: 30_000 });
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
    void queryClient.refetchQueries({
      queryKey: signalsQuery({ limit: 200, productId }).queryKey,
    });
    void queryClient.refetchQueries({ queryKey: competitorsQuery(productId).queryKey });
  }, [queryClient, productId]);

  // Lifted here (single poller) so the Overview can stagger its first-run
  // surfaces: while the first analysis streams in, only the analysis panel shows
  // — the "Get set up" checklist below it waits until analysis settles.
  const analysis = useOnboardingStreaming(load);
  const analysisActive = analysis.active && analysis.total > 0;

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
      {!sample && <OnboardingAnalysisPanel state={analysis} />}

      {!sample && !analysisActive && <OnboardingChecklistCard />}

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
        // Day-0 landscape (post-onboarding activation): competitors exist but no
        // signal yet — deliver the first-scrape "state of the world" instead of a
        // bare wait state. Falls back to the wait empty-state on fetch error.
        <LandscapeSection productId={productId} competitorCount={comps.length} />
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

      {/* Recent battle cards — discreet surface, self-hides when the org has no
          cards. Restores the pre-landing-overhaul section: with signals present the
          overview otherwise reads as just KPIs + one list. */}
      {!sample && <RecentBattleCards />}

        </>
      )}
    </div>
  );
}
