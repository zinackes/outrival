"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import { Download, ArrowRight, Radar, FlaskConical } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { api, type Signal } from "@/lib/api";
import {
  overviewSignalsQuery,
  OVERVIEW_SIGNALS_LIMIT,
  competitorsQuery,
  activityHealthQuery,
} from "@/lib/queries";
import { toCsv, downloadCsv } from "@/lib/csv";
import { formatDate } from "@/lib/format-date";
import { Button } from "@/components/ui/button";
import {
  DateRangePicker,
  lastNDays,
  type DateRange,
} from "@/components/ui/date-range-picker";
import { PageHead } from "./page-head";
import { useSetAskContext } from "./ask-context";
import { catLabel } from "./cat-pill";
import { OnboardingChecklistCard } from "./onboarding-checklist";
import { LandscapeSection } from "./landscape";
import { OverviewLead, type PulseData } from "./overview-lead";
import { OverviewMovers } from "./overview-movers";
import { OverviewQueue, type QueueItem } from "./overview-queue";
import { OverviewMeasured } from "./overview-measured";
import { OverviewArtifacts } from "./overview-artifacts";
import { OverviewSkeleton } from "./overview-skeleton";
import { EmptyState } from "./empty-state";
import { SampleBanner } from "./sample-banner";
import { useSampleMode } from "@/hooks/use-sample-mode";
import { getSampleData } from "@/lib/sample-data";
import { ListError } from "@/components/outrival/list-error";
import { OnboardingAnalysisPanel } from "@/components/onboarding/onboarding-analysis-panel";
import { useOnboardingStreaming } from "@/hooks/use-onboarding-streaming";
import { toastApiError } from "@/lib/error-helpers";

const SEV_RANK: Record<Signal["severity"], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// Bars in the pulse rail. Enough to show a shape, few enough that each one stays
// readable in a 264px column (a 90 day range buckets into 14, not 90 slivers).
const MAX_BARS = 14;

// Buckets signals across the selected [from, to] window into `buckets` equal
// slices, so the bars span the picked range rather than a fixed tail.
function trendBuckets(
  signals: Signal[],
  fromMs: number,
  toMs: number,
  buckets: number,
): number[] {
  const span = Math.max(1, toMs - fromMs);
  const slice = span / buckets;
  const out = new Array<number>(buckets).fill(0);
  for (const s of signals) {
    const t = new Date(s.createdAt).getTime();
    if (t < fromMs || t > toMs) continue;
    const i = Math.min(buckets - 1, Math.floor((t - fromMs) / slice));
    out[i]!++;
  }
  return out;
}

// One label per bucket for the bars' hover. A bucket is a single day while the range
// fits in MAX_BARS; past that it spans several, and the label says so rather than
// naming only its first day.
function bucketLabels(fromMs: number, toMs: number, buckets: number): string[] {
  const day = (ms: number) => formatDate(new Date(ms), { month: "short", day: "numeric" });
  const slice = Math.max(1, toMs - fromMs) / buckets;
  const wide = slice > 1.5 * 86_400_000;
  return Array.from({ length: buckets }, (_, i) => {
    const start = fromMs + i * slice;
    return wide ? `${day(start)} to ${day(start + slice - 86_400_000)}` : day(start);
  });
}

export function OverviewView() {
  useSetAskContext({ kind: "view", label: "Overview dashboard" });
  const queryClient = useQueryClient();
  // patch-28 — active product scope (cookie-backed switcher, URL ?product= overrides).
  const productId = useProductScope() ?? undefined;
  // Server-seeded on first paint (see app/dashboard/page.tsx) → useQuery reads the
  // hydrated cache instead of fetching; falls back to a client fetch when the seed
  // was missing or the server prefetch failed.
  // Poll every 60s (not 30s): the signals query pulls the newest 200 with
  // insight/so_what/narrative (~100KB) and criticals already arrive live via
  // SSE/alerts, so a tighter idle poll just burns bandwidth on an idle tab.
  //
  // sort:"recent" (not the default threat order) because every number on this page
  // is windowed: the period count, its comparison against the period before, the
  // per-bucket bars. A threat-ranked page of 200 is an arbitrary sample of the
  // calendar, so those numbers were quietly wrong for any org past 200 signals. The
  // lead is still chosen by threatScore, which every row carries.
  const signalsQ = useQuery({
    ...overviewSignalsQuery(productId),
    refetchInterval: 60_000,
  });
  const competitorsQ = useQuery({
    ...competitorsQuery(productId),
    refetchInterval: 60_000,
  });
  // Source health feeds one rail stat and the "next scan" line in the cleared
  // queue. Best-effort: a failure just drops those two, never the page.
  const healthQ = useQuery(activityHealthQuery(productId));
  const signals = signalsQ.data ?? null;
  const competitors = competitorsQ.data ?? null;
  const err = signalsQ.error ?? competitorsQ.error;
  const [range, setRange] = useState<DateRange>(() => lastNDays(7));
  const rangeFrom = range.from.getTime();
  const rangeTo = range.to.getTime();
  const rangeDays = Math.max(1, Math.round((rangeTo - rangeFrom) / 86_400_000));
  const rangeLabel = `last ${rangeDays} days`;

  // Sample / demo mode (Step 0 cold-start): when on, every computation below
  // reads a fixed fictional dataset instead of the org's data, so a brand-new
  // user can explore a populated interface without writing anything. The raw
  // fetch states stay untouched so exiting sample restores the real view.
  const [sample, setSample] = useSampleMode();
  const sampleData = useMemo(() => getSampleData(), []);
  const dsSignals = sample ? sampleData.signals : signals;
  const dsCompetitors = sample ? sampleData.competitors : competitors;

  // Refresh both feeds — used by the error retry (a one-off, so an eager
  // invalidate is fine here; it immediately refetches since both queries are
  // active). Invalidate the exact keys so the cache stays the single source of
  // truth (no parallel useState to keep in sync).
  const load = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: overviewSignalsQuery(productId).queryKey,
    });
    void queryClient.invalidateQueries({ queryKey: competitorsQuery(productId).queryKey });
  }, [queryClient, productId]);

  // Clears the lead without leaving the page. Optimistic on the exact cache entry
  // this view reads, so the band advances to the next signal immediately.
  const markRead = useCallback(
    async (id: string) => {
      const key = overviewSignalsQuery(productId).queryKey;
      const prev = queryClient.getQueryData<Signal[]>(key);
      queryClient.setQueryData<Signal[]>(key, (rows) =>
        rows?.map((s) => (s.id === id ? { ...s, isRead: true } : s)),
      );
      try {
        await api.markSignalRead(id);
      } catch (e) {
        queryClient.setQueryData(key, prev);
        toastApiError(e);
      }
    },
    [queryClient, productId],
  );

  // Lifted here (single poller) so the Overview can stagger its first-run
  // surfaces: while the first analysis streams in, only the analysis panel shows
  // — the "Get set up" checklist below it waits until analysis settles. The hook
  // reads/writes the shared competitorsQuery cache directly (see
  // use-onboarding-streaming.ts), so this view's own useQuery above just
  // observes the same key — no onTick callback needed.
  const analysis = useOnboardingStreaming(productId);
  const analysisActive = analysis.active && analysis.total > 0;

  // Everything the blocks read, derived once. `window` is the picked period,
  // `prev` the period of the same length immediately before it (the comparison).
  const derived = useMemo(() => {
    const all = dsSignals ?? [];
    const span = rangeTo - rangeFrom;
    const inWindow: Signal[] = [];
    let prevCount = 0;
    let oldest = Number.POSITIVE_INFINITY;
    for (const s of all) {
      const t = new Date(s.createdAt).getTime();
      if (t < oldest) oldest = t;
      if (t >= rangeFrom && t <= rangeTo) inWindow.push(s);
      else if (t >= rangeFrom - span && t < rangeFrom) prevCount++;
    }
    // The fetch returns the NEWEST page. When it is full and its oldest row still
    // lands after the previous window opened, that window is only partly fetched —
    // so the comparison is withheld instead of being understated.
    const comparable = all.length < OVERVIEW_SIGNALS_LIMIT || oldest <= rangeFrom - span;

    const byThreat = [...inWindow].sort(
      (a, b) =>
        Number(a.isRead) - Number(b.isRead) ||
        b.threatScore - a.threatScore ||
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const lead = byThreat[0] ?? null;

    // The queue is keyed on state, not severity: what has not been looked at, and
    // what the user has claimed. The lead is excluded so the page never says the
    // same thing twice.
    const queue: QueueItem[] = inWindow
      .filter((s) => s.id !== lead?.id)
      .map((s): QueueItem | null => {
        const sev = s.severityOverride ?? s.severity;
        if (s.actionStatus === "todo") return { signal: s, reason: "todo" };
        if (s.actionStatus === "doing") return { signal: s, reason: "doing" };
        if (!s.isRead && sev === "critical") return { signal: s, reason: "critical" };
        if (!s.isRead && sev === "high") return { signal: s, reason: "high" };
        return null;
      })
      .filter((i): i is QueueItem => i !== null)
      .sort(
        (a, b) =>
          SEV_RANK[b.signal.severityOverride ?? b.signal.severity] -
            SEV_RANK[a.signal.severityOverride ?? a.signal.severity] ||
          new Date(b.signal.createdAt).getTime() - new Date(a.signal.createdAt).getTime(),
      )
      .slice(0, 4);

    const criticals = inWindow.filter(
      (s) => (s.severityOverride ?? s.severity) === "critical" && !s.isRead,
    );
    // Counted against the roster only. The feed also carries self-product signals
    // ("your own page changed"), which the roster endpoint excludes — left
    // unfiltered the masthead could claim "6 of 5 competitors moved".
    const roster = new Set((dsCompetitors ?? []).map((c) => c.id));
    const movers = new Set(
      inWindow.filter((s) => roster.has(s.competitorId)).map((s) => s.competitorId),
    );

    // The window's dominant category, only when one genuinely dominates. Below
    // this the masthead says nothing rather than promoting a two-signal tie.
    const catCounts = new Map<string, number>();
    for (const s of inWindow) catCounts.set(s.category, (catCounts.get(s.category) ?? 0) + 1);
    let dominant: string | null = null;
    for (const [cat, n] of catCounts) {
      if (n >= 3 && n / inWindow.length >= 0.4) {
        if (dominant === null || n > (catCounts.get(dominant) ?? 0)) dominant = cat;
      }
    }

    const buckets = Math.min(MAX_BARS, Math.max(3, rangeDays));
    return {
      inWindow,
      prevCount,
      comparable,
      lead,
      queue,
      criticals,
      moverCount: movers.size,
      dominant,
      bars: trendBuckets(inWindow, rangeFrom, rangeTo, buckets),
      barLabels: bucketLabels(rangeFrom, rangeTo, buckets),
    };
  }, [dsSignals, dsCompetitors, rangeFrom, rangeTo, rangeDays]);

  function exportCsv() {
    const rows = derived.inWindow;
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

  // Loading / error gates apply to the live fetch only — sample data is always
  // ready, so demo mode renders immediately even before the real fetch settles.
  if (!sample && err && (signals === null || competitors === null)) {
    return (
      <div className="mt-10">
        <ListError error={err} onRetry={load} />
      </div>
    );
  }

  if (!sample && (signals === null || competitors === null)) {
    return <OverviewSkeleton />;
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

  // First use — lead with one setup prompt + safe exploration, skip the empty grid.
  if (!sample && !hasCompetitors) {
    return (
      <div className="space-y-9">
        <OnboardingChecklistCard />
        <PageHead
          title="Overview"
          sub="Track every competitor move (pricing, hiring, product, content) as it happens."
        />
        <EmptyState
          icon={Radar}
          title="Start tracking your first competitor"
          description="Outrival watches competitor pricing, hiring, product and content, then turns each change into a signal with the context to act on it. Add a competitor to begin, or explore the interface with sample data first."
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

  const health = healthQ.data ?? null;
  // Competitor sources only: the org's own product is not something the user is
  // watching for movement.
  const watched = health ? health.sources.filter((s) => !s.isSelf) : [];
  const sources = health
    ? {
        total: watched.length,
        ok: watched.filter((s) => s.status === "ok").length,
        failing: watched.filter((s) => s.status === "failing" || s.status === "unscrapable")
          .length,
        paused: watched.filter((s) => s.status === "paused").length,
      }
    : null;
  const nextRun = health?.upcoming[0]?.nextRunAt ?? null;

  const pulse: PulseData = {
    count: derived.inWindow.length,
    prevCount: derived.prevCount,
    comparable: derived.comparable,
    bars: derived.bars,
    barLabels: derived.barLabels,
    criticals: derived.criticals.length,
    criticalLead: derived.criticals[0]
      ? `${derived.criticals[0].competitorName}, ${catLabel(derived.criticals[0].category)}`
      : null,
    sources: sample ? null : sources,
  };

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
          watching ? (
            `Watching ${comps.length} competitor${comps.length > 1 ? "s" : ""}.`
          ) : (
            // The verdict, not the tally: who moved, on what, and whether anything
            // is still unhandled. Composed from counts we already hold, so it costs
            // no model call and can never contradict the blocks below it.
            <span className="text-foreground">
              {derived.inWindow.length === 0 ? (
                <>No competitor moved in the {rangeLabel}.</>
              ) : (
                <>
                  {derived.moverCount} of {comps.length} competitor
                  {comps.length > 1 ? "s" : ""} moved
                  {derived.dominant ? `, mostly on ${catLabel(derived.dominant)}` : ""}.
                </>
              )}{" "}
              <span className="text-muted-foreground">
                {derived.criticals.length > 0
                  ? `${derived.criticals.length} critical still open.`
                  : derived.inWindow.length > 0
                    ? "Nothing critical open."
                    : nextRun
                      ? `Next scan ${formatDistanceToNow(new Date(nextRun), { addSuffix: true })}.`
                      : ""}
              </span>
            </span>
          )
        }
        actions={
          <>
            <DateRangePicker value={range} onChange={setRange} />
            <Button
              variant="outline"
              size="sm"
              onClick={exportCsv}
              disabled={derived.inWindow.length === 0}
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
          {derived.lead ? (
            <OverviewLead
              signal={derived.lead}
              pulse={pulse}
              rangeLabel={rangeLabel}
              onMarkRead={sample ? undefined : markRead}
            />
          ) : (
            // Signals exist, but none in this window. The range is the thing to
            // change, so say that rather than showing a dead band.
            <div className="rounded-lg border border-border bg-card px-5 py-8 text-sm text-muted-foreground">
              No signals in the {rangeLabel}. Widen the range to see history.
            </div>
          )}

          <OverviewMovers competitors={comps} />

          <OverviewQueue
            items={derived.queue}
            windowCount={derived.inWindow.length}
            rangeLabel={rangeLabel}
            nextRunLabel={
              nextRun
                ? formatDistanceToNow(new Date(nextRun), { addSuffix: true })
                : null
            }
          />

          {!sample && <OverviewMeasured range={range} productId={productId} />}

          {!sample && <OverviewArtifacts />}
        </>
      )}
    </div>
  );
}
