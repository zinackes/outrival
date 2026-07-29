"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ArrowUpIcon, ArrowDownIcon, CaretRightIcon } from "@/components/icons";
import { formatDistanceToNow } from "date-fns";
import { PRICING_STATUS_LABELS } from "@outrival/shared";
import { Fact, FactStrip } from "@/components/outrival/data-marks";
import {
  api,
  type Competitor,
  type PricingHistoryPoint,
  type MyProductPricingTier,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { convertCurrency, useFx } from "@/lib/fx";
import { TabCard, TabSection } from "@/components/outrival/tab-shell";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import { CompetitorPricingCard } from "@/components/outrival/competitor-pricing-card";
import { myProductQuery } from "@/lib/queries";
import { buildPricingSeries } from "./charts";
import { PricingPlansEditor } from "./pricing-plans-editor";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTierPrice, annualPerMonthLabel } from "./helpers";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Empty,
  TabLoading,
  MonitorEmptyState,
  SourceSummary,
  scrapeActivity,
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
  // Scoped to the active product (patch-28): without it the comparison always shows
  // the PRIMARY SKU's pricing, even while viewing a competitor of another product.
  // Reuses the shared myProductQuery factory so the cache key matches the rest of
  // the app (["myProduct"] primary / ["myProduct", productId] scoped).
  const productScope = useProductScope() ?? undefined;
  const myProductQ = useQuery({
    ...myProductQuery(productScope),
    placeholderData: keepPreviousData,
    retry: false,
  });
  // Resolved current plans (detected batch + the user's per-plan overlay). Shared
  // key with the PricingPlansEditor (one fetch) so a manual edit flows into the
  // "you vs them" comparison too, not just the plan list.
  // Fetch the FULL payload ({ detected, overrides, resolved }) — the same shape the
  // PricingPlansEditor's query returns. Both observers share this key so they share
  // one fetch/cache; if this queryFn narrowed to `.resolved`, the editor (which reads
  // `.resolved`/`.detected` off the shared value) would see `undefined` and render
  // "No plans captured yet" even though the comparison shows the tiers.
  const pricingPlansQuery = useQuery({
    queryKey: ["competitor", competitorId, "pricingPlans"],
    queryFn: () => api.getCompetitorPricingPlans(competitorId),
    placeholderData: keepPreviousData,
  });

  const history = historyQuery.data ?? null;
  const myProduct = myProductQ.data ?? null;
  const resolvedTiers = pricingPlansQuery.data?.resolved ?? null;
  // The competitor's plans in the comparison's PricingHistoryPoint shape, sourced
  // from the overlay when loaded (falls back to the raw latest batch while loading).
  const theirTiers = (latest: PricingHistoryPoint[]): PricingHistoryPoint[] =>
    resolvedTiers
      ? resolvedTiers.map((r) => ({
          plan_name: r.planName,
          price: r.price,
          currency: r.currency,
          billing_period: r.billingPeriod,
          unit: r.unit,
          includedQuantity: r.includedQuantity,
          recorded_at: "",
        }))
      : latest;

  // The trend chart plots ONE billing period at a time. A `yearly` row holds the
  // annual TOTAL, and the toggle-capture scrape stores both periods of the same
  // plan in one batch under the same plan name — so a single line per plan mixed
  // two quantities an order of magnitude apart and drew a 10x cliff on whichever
  // row happened to be written last. Default to whichever period was captured
  // more, so a competitor priced only annually still gets a chart.
  const [periodChoice, setPeriodChoice] = useState<PeriodChoice | null>(null);
  const periodCounts = useMemo(() => {
    const counts = { monthly: 0, yearly: 0 };
    for (const p of history ?? []) {
      if (p.billing_period === "monthly") counts.monthly++;
      else if (p.billing_period === "yearly") counts.yearly++;
    }
    return counts;
  }, [history]);
  const chartPeriod: PeriodChoice =
    periodChoice ?? (periodCounts.yearly > periodCounts.monthly ? "yearly" : "monthly");
  const series = useMemo(
    () => (history ? buildPricingSeries(history.filter((p) => isChartable(p, chartPeriod))) : null),
    [history, chartPeriod],
  );

  // A pricing scrape in flight (client-triggered or server-side, refresh-safe)
  // lets the card say where the request actually is instead of a bare empty state.
  const pricingMonitor = monitors.find((m) => m.sourceType === "pricing");
  const capture = pricingMonitor
    ? scrapeActivity(pricingMonitor, scrapingIds.has(pricingMonitor.id))
    : null;
  const hasCapturedTiers = (history?.length ?? 0) > 0;

  if (historyQuery.isError)
    return <Empty text="Couldn't load this data right now. Try again in a moment." />;
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
              capture={capture}
              summary={pricingMonitor?.aiSummary}
              summaryUpdatedAt={pricingMonitor?.aiSummaryUpdatedAt}
            />
          </TabSection>
          {/* Reachable with nothing detected: gated/demo pricing → add plans by hand. */}
          <PricingPlansEditor competitorId={competitorId} history={history} onSaved={onRefresh} />
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
  for (const p of sorted) latestByPlan.set(p.plan_name, p);

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

  // Permanent free plan (detect-free-plan) — a page-level fact on the latest batch.
  // The extractor only captures priced cards, so a free tier written on the page but
  // not priced (e.g. a "Free" comparison column) never lands as a $0 plan row. Show
  // the badge only when we DIDN'T already capture a $0 tier, so it fills the gap
  // instead of restating a "Free — 0" row the list already shows.
  const hasCapturedFreeTier = Array.from(latestByPlan.values()).some((p) => p.price === 0);
  const showFreePlanBadge = latestRow?.has_free_plan === true && !hasCapturedFreeTier;

  // The competitor's current tiers (overlay-resolved), split so usage rates never
  // enter the price-ranked comparison — they're shown as a separate line instead.
  const allTheirTiers = theirTiers(Array.from(latestByPlan.values()));

  // A single capture is a one-dot line — not worth a 260px chart. The per-plan
  // list also has no deltas yet on first capture, so it just restates current
  // prices; we keep it full-width then (it's the only structured tier view),
  // unless a "you vs them" comparison already shows those same prices above.
  const hasTrend = series.points.length >= 2;

  // Counts for the fold's summary line, off the shared pricingPlans cache the
  // editor already reads, so opening it costs no extra request.
  const planCount = pricingPlansQuery.data?.resolved.length ?? latestByPlan.size;
  const editedCount = pricingPlansQuery.data?.overrides.length ?? 0;

  // The tab's answer, stated before the evidence. It lived inside the comparison,
  // so a workspace with no product of its own captured got no verdict at all.
  // Same-currency only here: a converted comparison keeps its ≈ marker down in the
  // ladder, where the footnote naming the rate sits next to it.
  const theirEntry = allTheirTiers
    .filter((t) => t.billing_period !== "usage" && t.price != null && t.price > 0)
    .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0];
  const ourEntry = (myProduct?.pricing.tiers ?? [])
    .filter((t) => t.price != null && t.price > 0)
    .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0];
  const verdict = (() => {
    if (!theirEntry) {
      return competitor.pricingStatus && competitor.pricingStatus !== "public"
        ? `${competitor.name} doesn't publish a price you can compare.`
        : null;
    }
    if (ourEntry && ourEntry.currency === theirEntry.currency && ourEntry.price && theirEntry.price) {
      const pct = ((ourEntry.price - theirEntry.price) / theirEntry.price) * 100;
      if (Math.abs(pct) >= 1) {
        return pct > 0
          ? `They undercut your entry tier by ${Math.round(pct)}%.`
          : `You undercut their entry tier by ${Math.round(Math.abs(pct))}%.`;
      }
      return "Your entry tiers are priced within a percent of each other.";
    }
    return `Their entry tier is ${formatTierPrice(theirEntry)}.`;
  })();

  // A price that moved in the last fortnight is the fact worth a mark in the strip.
  const changedRecently =
    !!pricingMonitor?.lastChangedAt &&
    Date.now() - new Date(pricingMonitor.lastChangedAt).getTime() < 14 * 86_400_000;

  return (
    <TabCard>
      {verdict && (
        <TabSection>
          <h3 className="text-xl font-semibold leading-snug tracking-tight text-balance">
            {verdict}
          </h3>
        </TabSection>
      )}

      {/* Four attributes of one object are a table, not a row of tinted chips. */}
      <TabSection>
        <FactStrip>
          <Fact label="Free trial" tone={latestTrial?.hasTrial ? "good" : undefined} muted={!latestTrial?.hasTrial}>
            {latestTrial == null
              ? "Not detected"
              : latestTrial.hasTrial
                ? trialLabel(latestTrial)
                : "None"}
          </Fact>
          <Fact label="Free plan" muted={!showFreePlanBadge && !hasCapturedFreeTier}>
            {showFreePlanBadge || hasCapturedFreeTier ? "Yes" : "None"}
          </Fact>
          <Fact label="Price visibility">
            {PRICING_STATUS_LABELS[competitor.pricingStatus ?? "unknown"]}
          </Fact>
          <Fact
            label="Last change"
            tone={changedRecently ? "warn" : undefined}
            muted={!pricingMonitor?.lastChangedAt}
          >
            {pricingMonitor?.lastChangedAt
              ? formatDistanceToNow(new Date(pricingMonitor.lastChangedAt), { addSuffix: true })
              : "No change captured"}
          </Fact>
        </FactStrip>
      </TabSection>
      <SourceSummary
        summary={pricingMonitor?.aiSummary}
        updatedAt={pricingMonitor?.aiSummaryUpdatedAt}
      />

      {myProduct && (
        <TabSection>
          <PricingComparison
            competitorName={competitor.name}
            competitorPricingStatus={competitor.pricingStatus}
            ours={myProduct.pricing.tiers}
            theirs={allTheirTiers.filter((t) => t.billing_period !== "usage")}
            usageTiers={allTheirTiers.filter((t) => t.billing_period === "usage")}
          />
        </TabSection>
      )}
      {/* Analysis and editing are different modes and no longer share a row: the
          chart takes the full width it needs, the form follows it. */}
      {hasTrend && (
        <TabSection
          title="Price over time"
          action={
            periodCounts.monthly > 0 && periodCounts.yearly > 0 ? (
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={chartPeriod}
                onValueChange={(v) => v && setPeriodChoice(v as PeriodChoice)}
                aria-label="Billing period plotted"
              >
                <ToggleGroupItem value="monthly" className="text-xs">
                  Monthly
                </ToggleGroupItem>
                <ToggleGroupItem value="yearly" className="text-xs">
                  Yearly
                </ToggleGroupItem>
              </ToggleGroup>
            ) : null
          }
        >
          <MultiLineChart data={series.points} seriesKeys={numericPlans} height={260} />
        </TabSection>
      )}

      {/* Editing is reference work, so it folds away. The summary line carries the
          counts, which is what a reader wants before deciding to open a form. */}
      <details className="details-smooth group">
        <summary className="flex cursor-pointer list-none items-center gap-2 p-5 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
          <CaretRightIcon
            size={16}
            aria-hidden
            className="shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
          />
          <span className="text-content font-semibold leading-tight tracking-tight">
            Plan detail and manual overrides
          </span>
          <span className="ml-auto text-xs text-muted-foreground">
            {planCount} {planCount === 1 ? "plan" : "plans"}
            {editedCount > 0 && `, ${editedCount} edited by hand`}
          </span>
        </summary>
        <PricingPlansEditor competitorId={competitorId} history={history} onSaved={onRefresh} />
      </details>

      {/* Provenance last: how the numbers were obtained is meta, and it used to
          open the tab ahead of what they say. The card keeps every capability it
          had (honest status when no tier was captured, manual entry, re-detect,
          the source summary); only its position changed. */}
      <TabSection>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {pricingMonitor?.pageUrl && (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              Captured from
              <a
                href={pricingMonitor.pageUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="truncate text-link hover:underline"
              >
                {pricingMonitor.pageUrl.replace(/^https?:\/\//, "")}
              </a>
            </span>
          )}
          {pricingMonitor?.lastRunAt && (
            <span>
              last check{" "}
              {formatDistanceToNow(new Date(pricingMonitor.lastRunAt), { addSuffix: true })}
            </span>
          )}
          {pricingMonitor?.lastChangedAt && (
            <span>
              changed{" "}
              {formatDistanceToNow(new Date(pricingMonitor.lastChangedAt), { addSuffix: true })}
            </span>
          )}
        </div>
      </TabSection>
    </TabCard>
  );
}

// Free-trial value for the fact strip (patch-33). The strip states the trial
// whether or not there is one, so unlike the old pill this needs no gate: an
// absent trial is a fact about their pricing, not a missing badge.
function trialLabel(trial: {
  days: number | null;
  requiresCard: boolean | null;
}): string {
  const parts = [
    trial.days != null ? `${trial.days} days` : "Yes",
    trial.requiresCard === false
      ? "no card"
      : trial.requiresCard === true
        ? "card required"
        : null,
  ].filter(Boolean);
  return parts.join(", ");
}

type TierLite = { price: number | null; currency: string; billing_period: string };

// The competitor's price expressed in our currency, e.g. "≈ €89/mo" — the concrete
// number the "converted to EUR" footnote otherwise only promises. Null when there's
// nothing to convert (same currency, quote-based/free tier, or no rate loaded yet).
function convertedLabel(
  tier: TierLite,
  to: string,
  rates: Record<string, number> | null,
): string | null {
  if (!to || tier.currency === to || tier.price == null || tier.price <= 0) return null;
  const converted = convertCurrency(tier.price, tier.currency, to, rates);
  if (converted === null) return null;
  // Whole euros for the usual double-digit competitor prices; cents only when small.
  const rounded = converted >= 10 ? Math.round(converted) : Math.round(converted * 100) / 100;
  return `≈ ${formatTierPrice({ price: rounded, currency: to, billing_period: tier.billing_period })}`;
}

type PeriodChoice = "monthly" | "yearly";

/**
 * Whether a captured tier belongs on the trend chart for a given period.
 *
 * Two kinds of row are kept off it. A `usage` rate ($0.10 / API call) shares no
 * axis with a $99 plan, and on a hybrid plan its overage row zig-zags the plan's
 * own line. And the OTHER period's rows: a `yearly` price is the annual total, so
 * plotting it on the same per-plan line as its monthly twin draws a 10-12x jump
 * that is a unit change, not a price change. Period-neutral tiers (one_time /
 * custom) have no twin to collide with, so they show in either view.
 */
function isChartable(p: { billing_period: string }, period: PeriodChoice): boolean {
  if (p.billing_period === "usage") return false;
  if (p.billing_period === "monthly" || p.billing_period === "yearly") {
    return p.billing_period === period;
  }
  return true;
}

// One offer billed monthly and the same offer billed yearly are the SAME plan,
// not two tiers — but the toggle-capture scrape stores them as two rows, so
// without this they'd rank as two separate tiers (Starter at Entry, its yearly
// variant several rows up). Collapse tiers sharing a plan name to one row and
// pick the variant for the active period. Period-neutral tiers (custom/one_time)
// and plans that only exist in the other period are kept so nothing disappears
// when the toggle flips.
function collapseByPlan<
  T extends { plan_name: string; price: number | null; billing_period: string },
>(tiers: T[], period: PeriodChoice): T[] {
  const other = period === "monthly" ? "yearly" : "monthly";
  const groups = new Map<string, T[]>();
  for (const t of tiers) {
    const key = t.plan_name.trim().toLowerCase();
    const group = groups.get(key);
    if (group) group.push(t);
    else groups.set(key, [t]);
  }
  return Array.from(groups.values(), (group) => {
    const active = group.find((t) => t.billing_period === period);
    if (active) return active;
    const neutral = group.find(
      (t) => t.billing_period !== "monthly" && t.billing_period !== "yearly",
    );
    return neutral ?? group.find((t) => t.billing_period === other) ?? group[0]!;
  });
}

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
    return { pct: null, reason: "Quote-based tier, no public price to compare" };
  }
  if (mine.billing_period !== theirs.billing_period) {
    return {
      pct: null,
      reason: `Different billing period (theirs ${theirs.billing_period}, yours ${mine.billing_period})`,
    };
  }
  if (theirs.price <= 0) {
    return { pct: null, reason: "Their tier is free, no baseline to compute a %" };
  }
  const sameCurrency = mine.currency === theirs.currency;
  const theirInOurs = sameCurrency
    ? theirs.price
    : convertCurrency(theirs.price, theirs.currency, mine.currency, rates);
  if (theirInOurs === null) {
    return {
      pct: null,
      reason: `Different currency (theirs ${theirs.currency}, yours ${mine.currency}), no exchange rate available`,
    };
  }
  return { pct: ((mine.price - theirInOurs) / theirInOurs) * 100, converted: !sameCurrency };
}

// The Δ cell: a signed % (prefixed ≈ when it came from a currency conversion), or
// a dash whose tooltip explains why the pair isn't comparable.
function DeltaCell({ cmp, from, to }: { cmp: TierCmp | null; from?: string; to?: string }) {
  // An unpairable row said "—" and hid its reason in a title attribute, so the
  // most common cell in the table was a dash nobody could act on. The reason is
  // short; it belongs on screen.
  if (!cmp) return <span className="text-center text-xs text-muted-foreground">no pair</span>;
  if (cmp.pct === null) {
    return (
      <span className="text-balance text-center text-xs leading-snug text-muted-foreground">
        {cmp.reason}
      </span>
    );
  }
  if (Math.abs(cmp.pct) < 1) {
    return <span className="text-center text-xs text-muted-foreground">within 1%</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-sm px-2 py-0.5 font-mono text-dense font-semibold tabular-nums",
        cmp.pct < 0
          ? "bg-positive/16 text-positive"
          : "bg-critical/16 text-critical",
      )}
      title={cmp.converted ? `Converted ${from} to ${to} at the ECB reference rate` : undefined}
    >
      {cmp.converted && <span className="opacity-70">≈</span>}
      {cmp.pct < 0 ? <ArrowDownIcon className="size-4" /> : <ArrowUpIcon className="size-4" />}
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
  usageTiers = [],
}: {
  competitorName: string;
  competitorPricingStatus: Competitor["pricingStatus"];
  ours: MyProductPricingTier[];
  theirs: PricingHistoryPoint[];
  // Metered/usage rates ($0.10 / API call) — shown as a line, never price-ranked.
  usageTiers?: PricingHistoryPoint[];
}) {
  // Called before the early return so the hook order stays stable (rules of hooks).
  const fx = useFx();
  const [period, setPeriod] = useState<PeriodChoice>("monthly");
  // A toggle only makes sense when both periods exist somewhere; otherwise the
  // collapse falls back to whatever period each plan has and we hide the switch.
  const bothPeriods =
    [...ours, ...theirs].some((t) => t.billing_period === "monthly") &&
    [...ours, ...theirs].some((t) => t.billing_period === "yearly");
  const oursSorted = collapseByPlan(ours, period).sort(byPriceAsc);
  const theirsSorted = collapseByPlan(theirs, period).sort(byPriceAsc);

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

  // Nothing of theirs left to rank: the manual overlay can hide every captured
  // plan, and the ladder below reads theirsSorted[0] as their entry tier. An
  // empty list threw there and took the whole tab down with it (the state a user
  // lands in right after saving a plan edit that removed every row), so say there
  // is nothing to compare instead.
  if (theirsSorted.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Pricing comparison</p>
        <p className="text-dense text-muted-foreground">
          No current plans for {competitorName} to compare against. Add them under
          &ldquo;Plan detail and manual overrides&rdquo; below.
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

  // Honest summary lines for what the captured data actually supports. The entry
  // comparison itself is no longer one of them: it is the headline above.
  const lines: string[] = [];
  const entryCmp = compareTiers(ourEntry, theirEntry, rates);
  // Their free tier = a captured $0 plan OR a free plan detected on the page but not
  // priced as a card (detect-free-plan) — otherwise a "Free" comparison column the
  // extractor skipped would make us wrongly claim they have no free tier.
  const theyHaveFree = theirEntry.price === 0 || theirs.some((t) => t.has_free_plan === true);
  const weHaveFree = ourEntry.price === 0;
  if (theyHaveFree && !weHaveFree) {
    lines.push(`${competitorName} offers a free tier and you don't.`);
  } else if (weHaveFree && !theyHaveFree) {
    lines.push(`You offer a free tier and ${competitorName} doesn't.`);
  }
  if (
    competitorPricingStatus === "public_partial" ||
    competitorPricingStatus === "gated_demo" ||
    competitorPricingStatus === "gated_signup"
  ) {
    lines.push(`${competitorName}'s top tier is sales-gated, so not every price is public.`);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-sm font-medium">Pricing comparison</p>
        <div className="flex items-center gap-3">
          {bothPeriods && (
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={period}
              onValueChange={(v) => v && setPeriod(v as PeriodChoice)}
              aria-label="Billing period"
            >
              <ToggleGroupItem value="monthly" className="text-xs">
                Monthly
              </ToggleGroupItem>
              <ToggleGroupItem value="yearly" className="text-xs">
                Yearly
              </ToggleGroupItem>
            </ToggleGroup>
          )}
          <p className="truncate text-xs text-muted-foreground">
            You vs {competitorName}
          </p>
        </div>
      </div>

      {/* A ladder with a spine, not a four-column table whose difference column was
          a bare % header full of dashes explaining themselves only in a title attr.
          Ours reads right-aligned into the centre, theirs left-aligned out of it. */}
      <div>
        <div className="grid grid-cols-1 items-center gap-x-4 pb-1.5 text-xs text-muted-foreground sm:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)]">
          <span className="text-right max-sm:hidden">You</span>
          <span aria-hidden />
          <span className="truncate max-sm:hidden">{competitorName}</span>
        </div>
        {rows.map(({ mine, theirs, cmp }, i) => (
          <div
            key={i}
            className="grid grid-cols-1 items-center gap-x-4 gap-y-1 border-t border-border py-2.5 sm:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)]"
          >
            <div className="sm:text-right">
              {mine ? (
                <TierCell tier={mine} align="end" />
              ) : (
                <span className="text-sm text-muted-foreground">no equivalent</span>
              )}
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="text-meta uppercase tracking-wide text-muted-foreground">
                {rankLabel(i)}
              </span>
              <DeltaCell cmp={cmp} from={theirs?.currency} to={mine?.currency} />
            </div>
            <div>
              {theirs ? (
                <TierCell tier={theirs} convertedTo={ourCurrency} rates={rates} />
              ) : (
                <span className="text-sm text-muted-foreground">no equivalent</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Said out loud, because leaving it implicit lets a reader conclude that
          their second-cheapest tier does what your second-cheapest tier does. */}
      <p className="text-xs text-muted-foreground">
        Tiers line up by price rank, not by feature parity.
      </p>

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

      {usageTiers.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {competitorName} also meters usage:{" "}
          {usageTiers.map((t, i) => (
            <span key={i}>
              {i > 0 ? " · " : ""}
              <span className="text-foreground">{formatTierPrice(t)}</span>
              {t.plan_name ? ` (${t.plan_name})` : ""}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

// One side's tier in the comparison table: price (bold) + plan name inline (muted).
// When the tier is in a foreign currency, a second muted line shows what it costs in
// our currency — the actual number a raw "149 AUD/mo" leaves the reader guessing at.
function TierCell({
  tier,
  convertedTo,
  rates,
  align = "start",
}: {
  align?: "start" | "end";
  tier: {
    plan_name: string;
    price: number | null;
    currency: string;
    billing_period: string;
    unit?: string | null;
    includedQuantity?: number | null;
  };
  convertedTo?: string;
  rates?: Record<string, number> | null;
}) {
  const conv = convertedTo ? convertedLabel(tier, convertedTo, rates ?? null) : null;
  const perMonth = annualPerMonthLabel(tier);
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", align === "end" && "sm:items-end")}>
      <div
        className={cn(
          "flex min-w-0 items-baseline gap-1.5",
          align === "end" && "sm:flex-row-reverse",
        )}
      >
        <span className="shrink-0 font-mono text-lead font-semibold tabular-nums">
          {formatTierPrice(tier)}
        </span>
        <span className="truncate text-xs text-muted-foreground">{tier.plan_name}</span>
      </div>
      {conv && (
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{conv}</span>
      )}
      {perMonth && (
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{perMonth}</span>
      )}
    </div>
  );
}
