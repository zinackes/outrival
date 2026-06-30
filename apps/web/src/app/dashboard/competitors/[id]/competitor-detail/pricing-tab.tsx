"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { DollarSign, Activity, ArrowUp, ArrowDown, Percent, Clock } from "lucide-react";
import {
  api,
  type Competitor,
  type PricingHistoryPoint,
  type MyProductPricingTier,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { eyebrowClass } from "@/components/outrival/eyebrow";
import { TabCard, TabSection } from "@/components/outrival/tab-shell";
import { CompetitorPricingCard } from "@/components/outrival/competitor-pricing-card";
import { buildPricingSeries } from "./charts";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTierPrice } from "./helpers";
import {
  Empty,
  TabLoading,
  MonitorEmptyState,
  isServerScraping,
  type MonitorSourceProps,
} from "./shared";

// recharts is heavy + client-only: lazy-load the chart so it stays off this
// route's first-load bundle (F7).
const MultiLineChart = dynamic(() => import("./chart-line"), {
  ssr: false,
  loading: () => <Skeleton className="h-[260px] w-full" />,
});

export function PricingTab({
  competitor,
  competitorId,
  monitors,
  scrapingIds,
  onRun,
  onEnable,
  onRefresh,
}: {
  competitor: Competitor;
  competitorId: string;
  onRefresh: () => void;
} & MonitorSourceProps) {
  // The shared QueryClient serves the cache instantly on tab re-switch (no skeleton
  // flash); keepPreviousData keeps the last result during a refetch. A forced
  // re-scan invalidates ["competitor", id] from the detail view.
  const historyQuery = useQuery({
    queryKey: ["competitor", competitorId, "pricingHistory"],
    queryFn: () => api.getCompetitorPricingHistory(competitorId).then((r) => r.history),
    placeholderData: keepPreviousData,
  });
  // Our own product, for the You-vs-them pricing comparison (best-effort — its
  // absence just hides the comparison, it never blocks the competitor's pricing).
  const myProductQuery = useQuery({
    queryKey: ["myProduct"],
    queryFn: () => api.getMyProduct().then((r) => r.product),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const history = historyQuery.data ?? null;
  const myProduct = myProductQuery.data ?? null;
  // When our own product has no captured pricing tiers, the "you vs them"
  // comparison can't list the competitor's prices (it falls back to an
  // "add your plans" nudge), so the competitor's own plan list must stay
  // visible — see the no-trend branch below.
  const ourHasTiers = (myProduct?.pricing.tiers.length ?? 0) > 0;

  const series = useMemo(
    () => (history ? buildPricingSeries(history) : null),
    [history],
  );

  // A pricing scrape in flight (client-triggered or server-side, refresh-safe)
  // lets the card say "Capturing pricing…" instead of a bare empty state.
  const pricingMonitor = monitors.find((m) => m.sourceType === "pricing");
  const isCapturing = pricingMonitor
    ? scrapingIds.has(pricingMonitor.id) || isServerScraping(pricingMonitor)
    : false;
  const hasCapturedTiers = (history?.length ?? 0) > 0;

  if (historyQuery.isError)
    return <Empty text="Couldn't load this data right now — try again in a moment." />;
  if (history === null) return <TabLoading />;
  if (history.length === 0 || !series) {
    return (
      <div className="flex flex-col gap-4">
        <TabCard>
          <TabSection>
            <CompetitorPricingCard
              competitor={competitor}
              onUpdated={onRefresh}
              hasCapturedTiers={hasCapturedTiers}
              isCapturing={isCapturing}
              summary={pricingMonitor?.aiSummary}
              summaryUpdatedAt={pricingMonitor?.aiSummaryUpdatedAt}
            />
          </TabSection>
        </TabCard>
        <MonitorEmptyState
          source="pricing"
          label="pricing"
          monitors={monitors}
          scrapingIds={scrapingIds}
          onRun={onRun}
          onEnable={onEnable}
        />
      </div>
    );
  }

  const plans = Object.keys(series.byPlan);
  // Plans that have at least one numeric price — the only ones worth a chart line.
  // Quote-based "Custom" tiers stay in the list but never get a (flat/empty) series.
  const numericPlans = plans.filter((pl) =>
    (series.byPlan[pl] ?? []).some((p) => p.price != null),
  );
  const sorted = [...history].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime(),
  );
  const latestByPlan = new Map<string, PricingHistoryPoint>();
  const firstByPlan = new Map<string, PricingHistoryPoint>();
  for (const p of sorted) latestByPlan.set(p.plan_name, p);
  for (const p of sorted) if (!firstByPlan.has(p.plan_name)) firstByPlan.set(p.plan_name, p);

  // Free trial (patch-33) is a page-level fact stamped identically onto the latest
  // batch's rows — read it off the most recent row. null has_trial = pre-detection
  // scrape, so we show nothing rather than a misleading "No free trial".
  const latestRow = sorted[sorted.length - 1];
  const latestTrial =
    latestRow && latestRow.has_trial != null
      ? {
          hasTrial: latestRow.has_trial,
          days: latestRow.trial_days ?? null,
          requiresCard: latestRow.trial_requires_card ?? null,
        }
      : null;

  // A single capture is a one-dot line — not worth a 260px chart. The per-plan
  // list also has no deltas yet on first capture, so it just restates current
  // prices; we keep it full-width then (it's the only structured tier view),
  // unless a "you vs them" comparison already shows those same prices above.
  const hasTrend = series.points.length >= 2;
  const planList = (
    <TabSection
      title={hasTrend ? "Plan changes" : "Current plans"}
      icon={DollarSign}
      className={hasTrend ? "border-t border-border lg:border-t-0 lg:border-l" : undefined}
    >
      <ul className="flex flex-col divide-y divide-border">
        {plans.map((plan) => {
          const latest = latestByPlan.get(plan)!;
          const first = firstByPlan.get(plan)!;
          const lp = latest.price;
          const fp = first.price;
          // A delta needs a numeric price at both ends; quote-based tiers have none.
          const delta = lp != null && fp != null ? lp - fp : 0;
          const pct = lp != null && fp != null && fp > 0 ? (delta / fp) * 100 : 0;
          return (
            <li
              key={plan}
              className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <div className="flex items-baseline gap-2 min-w-0">
                {/* The plan name is the competitor's real product/brand name (often
                    non-English) — render it as content in its original case, not as an
                    uppercased eyebrow, so a name reads as a name, not scaffolding. */}
                <span className="min-w-0 truncate text-sm font-medium text-foreground">
                  {plan}
                </span>
                {lp != null ? (
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {lp} {latest.currency}
                    <span className="text-xs font-normal text-muted-foreground">
                      {" "}
                      / {latest.billing_period.replace(/_/g, "-")}
                    </span>
                  </span>
                ) : (
                  <span className="shrink-0 text-sm font-medium text-muted-foreground">
                    Custom
                  </span>
                )}
              </div>
              {delta !== 0 && (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 shrink-0 text-xs font-mono tabular-nums",
                    delta > 0 ? "text-critical" : "text-positive",
                  )}
                >
                  {delta > 0 ? (
                    <ArrowUp className="size-3" />
                  ) : (
                    <ArrowDown className="size-3" />
                  )}
                  {Math.abs(delta).toFixed(0)} {latest.currency} ({pct.toFixed(0)}%)
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </TabSection>
  );

  return (
    <TabCard>
      <TabSection>
        <CompetitorPricingCard
          competitor={competitor}
          onUpdated={onRefresh}
          hasCapturedTiers={hasCapturedTiers}
          isCapturing={isCapturing}
          summary={pricingMonitor?.aiSummary}
          summaryUpdatedAt={pricingMonitor?.aiSummaryUpdatedAt}
        />
        {latestTrial && (
          <div className="mt-3">
            <TrialBadge trial={latestTrial} />
          </div>
        )}
      </TabSection>
      {myProduct && (
        <TabSection>
          <PricingComparison
            competitorName={competitor.name}
            competitorPricingStatus={competitor.pricingStatus}
            ours={myProduct.pricing.tiers}
            theirs={Array.from(latestByPlan.values())}
          />
        </TabSection>
      )}
      {hasTrend ? (
        // Real history: chart + per-plan deltas side by side on lg — both
        // describe the competitor's price trend, so pairing the wide chart with
        // the narrow list halves the height vs stacking two full-width blocks.
        <div className="grid lg:grid-cols-2">
          <TabSection title="Price over time" icon={Activity}>
            <MultiLineChart data={series.points} seriesKeys={numericPlans} height={260} />
          </TabSection>
          {planList}
        </div>
      ) : (
        // First capture, no trend yet: skip the one-dot chart. Show the bare tier
        // list unless the comparison above already lists those prices — which it
        // only does when we have our own tiers to compare against.
        (!myProduct || !ourHasTiers) && planList
      )}
    </TabCard>
  );
}

// Free-trial pill (patch-33). A confident "No free trial" is itself useful
// comparative intel ("they don't offer one, we do"), so we render both states —
// the absent case is only filtered upstream when the scrape predates detection.
function TrialBadge({
  trial,
}: {
  trial: { hasTrial: boolean; days: number | null; requiresCard: boolean | null };
}) {
  if (!trial.hasTrial) {
    return (
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-meta font-medium text-muted-foreground">
        <Clock className="size-3.5" />
        No free trial
      </span>
    );
  }
  const parts = [
    trial.days != null ? `${trial.days}-day` : null,
    trial.requiresCard === false
      ? "no credit card"
      : trial.requiresCard === true
        ? "card required"
        : null,
  ].filter(Boolean);
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-positive/30 bg-positive/10 px-2.5 py-1 text-meta font-medium text-positive">
      <Clock className="size-3.5" />
      Free trial{parts.length > 0 ? ` · ${parts.join(" · ")}` : ""}
    </span>
  );
}

// Best-effort FX rates (units of each currency per 1 USD) from the ECB via
// frankfurter.dev — no API key, CORS-enabled (`access-control-allow-origin: *`).
// The legacy api.frankfurter.app host now 301-redirects here, and a cross-origin
// redirect breaks the browser CORS fetch, so we hit the .dev host directly.
// Cached at module scope and shared across renders; a fetch failure (offline,
// unsupported currency) leaves rates null and the comparison falls back to
// flagging the mismatch instead of inventing a cross-currency %.
type FxData = { rates: Record<string, number>; date: string };
let fxCache: FxData | null = null;
let fxPromise: Promise<FxData | null> | null = null;

function loadFx(): Promise<FxData | null> {
  if (fxCache) return Promise.resolve(fxCache);
  if (fxPromise) return fxPromise;
  fxPromise = fetch("https://api.frankfurter.dev/v1/latest?base=USD")
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { rates?: Record<string, number>; date?: string } | null) => {
      if (!d?.rates) return null;
      fxCache = { rates: { USD: 1, ...d.rates }, date: d.date ?? "" };
      return fxCache;
    })
    .catch(() => null);
  return fxPromise;
}

function useFx(): FxData | null {
  const [fx, setFx] = useState<FxData | null>(fxCache);
  useEffect(() => {
    if (fx) return;
    let alive = true;
    void loadFx().then((r) => {
      if (alive) setFx(r);
    });
    return () => {
      alive = false;
    };
  }, [fx]);
  return fx;
}

// Convert an amount between currencies using USD-based rates; null when either
// currency is missing from the rate table (or rates haven't loaded yet).
function convertCurrency(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number> | null,
): number | null {
  if (from === to) return amount;
  const rf = rates?.[from];
  const rt = rates?.[to];
  if (!rf || !rt) return null;
  return (amount * rt) / rf;
}

type TierLite = { price: number | null; currency: string; billing_period: string };

// Sort tiers by ascending price, pushing quote-based tiers (price null) last so
// the entry/top ranking reads off the numeric ones.
function byPriceAsc(a: { price: number | null }, b: { price: number | null }): number {
  if (a.price == null && b.price == null) return 0;
  if (a.price == null) return 1;
  if (b.price == null) return -1;
  return a.price - b.price;
}

// Outcome of comparing our tier to theirs: either a % (positive = we're pricier),
// flagged when it required a currency conversion, or null with a human reason the
// pair can't be compared — so the cell explains itself instead of a bare dash.
type TierCmp = { pct: number; converted: boolean } | { pct: null; reason: string };

function compareTiers(
  mine: TierLite,
  theirs: TierLite,
  rates: Record<string, number> | null,
): TierCmp {
  // A quote-based tier on either side has no number to compute a % against.
  if (mine.price == null || theirs.price == null) {
    return { pct: null, reason: "Quote-based tier — no public price to compare" };
  }
  if (mine.billing_period !== theirs.billing_period) {
    return {
      pct: null,
      reason: `Different billing period (theirs ${theirs.billing_period}, yours ${mine.billing_period})`,
    };
  }
  if (theirs.price <= 0) {
    return { pct: null, reason: "Their tier is free — no baseline to compute a %" };
  }
  const sameCurrency = mine.currency === theirs.currency;
  const theirInOurs = sameCurrency
    ? theirs.price
    : convertCurrency(theirs.price, theirs.currency, mine.currency, rates);
  if (theirInOurs === null) {
    return {
      pct: null,
      reason: `Different currency (theirs ${theirs.currency}, yours ${mine.currency}) — no exchange rate available`,
    };
  }
  return { pct: ((mine.price - theirInOurs) / theirInOurs) * 100, converted: !sameCurrency };
}

// The Δ cell: a signed % (prefixed ≈ when it came from a currency conversion), or
// a dash whose tooltip explains why the pair isn't comparable.
function DeltaCell({ cmp, from, to }: { cmp: TierCmp | null; from?: string; to?: string }) {
  if (!cmp) return <span className="text-muted-foreground/40">—</span>;
  if (cmp.pct === null) {
    return (
      <span className="cursor-help text-muted-foreground/40" title={cmp.reason}>
        —
      </span>
    );
  }
  if (Math.abs(cmp.pct) < 1) {
    return (
      <span
        className="cursor-help text-muted-foreground/40"
        title="Within 1% — effectively the same"
      >
        —
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-mono text-xs tabular-nums",
        cmp.pct < 0 ? "text-positive" : "text-critical",
      )}
      title={cmp.converted ? `Converted ${from} → ${to} at the ECB reference rate` : undefined}
    >
      {cmp.converted && <span className="text-muted-foreground">≈</span>}
      {cmp.pct < 0 ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />}
      {Math.abs(cmp.pct).toFixed(0)}%
    </span>
  );
}

// Pricing comparison (patch-29): our product's captured tiers vs the competitor's
// latest tiers, aligned by ascending price rank. No AI. A % is shown when the
// billing period matches and the currencies either match or can be converted via
// best-effort ECB rates (flagged ≈); otherwise the cell dashes and says why.
function PricingComparison({
  competitorName,
  competitorPricingStatus,
  ours,
  theirs,
}: {
  competitorName: string;
  competitorPricingStatus: Competitor["pricingStatus"];
  ours: MyProductPricingTier[];
  theirs: PricingHistoryPoint[];
}) {
  // Called before the early return so the hook order stays stable (rules of hooks).
  const fx = useFx();
  const oursSorted = [...ours].sort(byPriceAsc);
  const theirsSorted = [...theirs].sort(byPriceAsc);

  if (oursSorted.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Pricing comparison</p>
        <p className="text-dense text-muted-foreground">
          Add your own plans in{" "}
          <Link href="/dashboard/products" className="text-primary hover:underline">
            Products
          </Link>{" "}
          to see how {competitorName} stacks up against your pricing.
        </p>
      </div>
    );
  }

  const rates = fx?.rates ?? null;
  const ourCurrency = oursSorted[0]?.currency ?? theirsSorted[0]?.currency ?? "";

  const rowCount = Math.max(oursSorted.length, theirsSorted.length);
  const rankLabel = (i: number) =>
    i === 0 ? "Entry" : i === rowCount - 1 ? "Top" : `Tier ${i + 1}`;

  const rows = Array.from({ length: rowCount }, (_, i) => {
    const mine = oursSorted[i] ?? null;
    const theirs = theirsSorted[i] ?? null;
    return { mine, theirs, cmp: mine && theirs ? compareTiers(mine, theirs, rates) : null };
  });
  const anyConverted = rows.some(
    (r) => r.cmp !== null && r.cmp.pct !== null && r.cmp.converted,
  );

  const ourEntry = oursSorted[0]!;
  const theirEntry = theirsSorted[0]!;

  // Honest summary lines for what the captured data actually supports.
  const lines: string[] = [];
  const entryCmp = compareTiers(ourEntry, theirEntry, rates);
  if (entryCmp.pct !== null && Math.abs(entryCmp.pct) >= 1) {
    lines.push(
      `Your entry tier (${formatTierPrice(ourEntry)}) is ${Math.abs(entryCmp.pct).toFixed(0)}% ${
        entryCmp.pct < 0 ? "below" : "above"
      } theirs (${formatTierPrice(theirEntry)})${entryCmp.converted ? ", currency-adjusted" : ""}.`,
    );
  }
  if (theirEntry.price === 0 && ourEntry.price != null && ourEntry.price > 0) {
    lines.push(`${competitorName} offers a free tier — you don't.`);
  } else if (ourEntry.price === 0 && theirEntry.price != null && theirEntry.price > 0) {
    lines.push(`You offer a free tier — ${competitorName} doesn't.`);
  }
  if (
    competitorPricingStatus === "public_partial" ||
    competitorPricingStatus === "gated_demo" ||
    competitorPricingStatus === "gated_signup"
  ) {
    lines.push(`${competitorName}'s top tier is sales-gated — not every price is public.`);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">Pricing comparison</p>
        <p className="truncate font-mono text-xs text-muted-foreground">
          You vs {competitorName}
        </p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="w-16 py-1.5 text-left font-normal">Tier</th>
            <th className="py-1.5 text-left font-normal">You</th>
            <th className="py-1.5 text-left font-normal">
              <span className="block max-w-[140px] truncate normal-case">{competitorName}</span>
            </th>
            <th className="py-1.5 text-right font-normal">
              <Percent className="ml-auto size-3 text-muted-foreground" aria-label="Difference" />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ mine, theirs, cmp }, i) => (
            <tr key={i} className="border-t border-border">
              <td className={cn("py-1.5", eyebrowClass("micro"))}>{rankLabel(i)}</td>
              <td className="py-1.5">
                {mine ? <TierCell tier={mine} /> : <span className="text-muted-foreground">—</span>}
              </td>
              <td className="py-1.5">
                {theirs ? (
                  <TierCell tier={theirs} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="py-1.5 text-right">
                <DeltaCell cmp={cmp} from={theirs?.currency} to={mine?.currency} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {anyConverted && (
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">≈</span> competitor prices converted to {ourCurrency} at ECB
          reference rates{fx?.date ? ` (${fx.date})` : ""}.
        </p>
      )}

      {lines.length > 0 && (
        <ul className="flex flex-col gap-1 text-dense text-muted-foreground">
          {lines.map((l, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-muted-foreground">·</span>
              <span>{l}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// One side's tier in the comparison table: price (bold) and its plan name inline
// (muted) on a single line, so each row stays one line tall.
function TierCell({
  tier,
}: {
  tier: { plan_name: string; price: number | null; currency: string; billing_period: string };
}) {
  return (
    <div className="flex items-baseline gap-1.5 min-w-0">
      <span className="font-semibold tabular-nums shrink-0">{formatTierPrice(tier)}</span>
      <span className="truncate text-xs text-muted-foreground">{tier.plan_name}</span>
    </div>
  );
}
