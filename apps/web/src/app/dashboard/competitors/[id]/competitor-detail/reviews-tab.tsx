"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import dynamic from "next/dynamic";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { LockIcon, PlusIcon, SpinnerIcon, LinkIcon } from "@/components/icons";
import {
  PLAN_LABELS,
  planIncludesSource,
  minPlanForSource,
  validateReviewUrl,
  type Plan,
  type SourceType,
  type ReviewSourceType,
} from "@outrival/shared";
import { api, type CompetitorSignal } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TabCard, TabSection } from "@/components/outrival/tab-shell";
import { Fact, FactStrip } from "@/components/outrival/data-marks";

// Prevalence is ordinal with three bands; these drive the width of its track.
// Read through helpers so an unknown band degrades to the quietest step rather
// than to undefined (noUncheckedIndexedAccess).
const PREVALENCE_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 };
const PREVALENCE_LABEL: Record<string, string> = {
  high: "Mentioned often",
  medium: "Regularly",
  low: "Occasionally",
};
const prevalenceWeight = (p: string) => PREVALENCE_WEIGHT[p] ?? 1;
const prevalenceLabel = (p: string) => PREVALENCE_LABEL[p] ?? p;
import { buildReviewScoreSeries } from "./charts";
import { Skeleton } from "@/components/ui/skeleton";
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
  loading: () => <Skeleton className="h-[220px] w-full" />,
});

// Reviews v2 (2026-07-15) + Shopify (2026-08-04): the scraped aggregators
// (G2/Capterra/Trustpilot) are retired for legal reasons. What is left are the two
// URL-based sources whose pages are open to us: Apple's public RSS feed and the
// Shopify App Store listing. Trustpilot survives as the surface-only
// `trustpilot_public` (official-API score/trend, no user URL) with its own enable
// UX — it is intentionally NOT in this "paste a review-page URL" picker.
const REVIEW_SOURCE_OPTIONS: {
  value: ReviewSourceType;
  label: string;
  host: string;
  placeholder: string;
}[] = [
  {
    value: "appstore_reviews",
    label: "App Store",
    host: "apps.apple.com",
    placeholder: "https://apps.apple.com/us/app/<slug>/id000000000",
  },
  {
    value: "shopify_reviews",
    label: "Shopify",
    host: "apps.shopify.com",
    placeholder: "https://apps.shopify.com/<app-handle>",
  },
];

/** Shape the worker stores under `competitors.metadata.shopifyApp`. */
export interface ShopifyAppFact {
  handle: string;
  url: string;
}

/** Pull the Shopify listing the homepage detector found out of the metadata. */
export function readShopifyApp(
  metadata: Record<string, unknown> | null | undefined,
): ShopifyAppFact | null {
  const raw = metadata?.shopifyApp as ShopifyAppFact | undefined;
  if (!raw || typeof raw !== "object" || !raw.url) return null;
  return raw;
}

function ReviewEnableState({
  plan,
  onEnable,
  onLockedSource,
  detectedAppStoreUrl,
  detectedShopifyUrl,
}: {
  plan: Plan;
  onEnable?: (source: SourceType, url?: string) => Promise<void>;
  onLockedSource?: (source: ReviewSourceType) => void;
  // Listings already detected on their site, so the field starts filled instead of
  // asking the user to go and find the app id or handle themselves.
  detectedAppStoreUrl?: string | null;
  detectedShopifyUrl?: string | null;
}) {
  // Default to a source the plan actually covers so the form is usable out of the
  // gate; falls back to the first option when the plan covers none — then the form
  // is locked and the primary CTA routes to the paywall.
  const firstAllowed =
    REVIEW_SOURCE_OPTIONS.find((o) => planIncludesSource(plan, o.value))?.value ??
    REVIEW_SOURCE_OPTIONS[0]!.value;
  const [source, setSource] = useState<ReviewSourceType>(firstAllowed);
  // Only prefill what actually validates: a detection that somehow produced a
  // malformed URL must not seed a field the user then has to notice and clear.
  const prefillFor = (candidate: ReviewSourceType) => {
    const detected =
      candidate === "appstore_reviews" ? detectedAppStoreUrl : detectedShopifyUrl;
    return detected && validateReviewUrl(candidate, detected).ok ? detected : "";
  };
  const prefill = prefillFor(source);
  const [url, setUrl] = useState(() => prefillFor(firstAllowed));
  const [busy, setBusy] = useState(false);
  const active = REVIEW_SOURCE_OPTIONS.find((o) => o.value === source)!;
  const sourceLocked = !planIncludesSource(plan, source);
  const trimmed = url.trim();
  const valid = trimmed.length > 0 && validateReviewUrl(source, trimmed).ok;

  return (
    <Card className="px-6 py-8 border-dashed flex flex-col items-center gap-4 text-center">
      <div className="flex flex-col items-center gap-1">
        <p className="text-sm font-semibold text-foreground">Track reviews</p>
        <p className="text-sm text-muted-foreground max-w-md">
          Pick a review source and paste this competitor&apos;s review-page URL. We&apos;ll
          capture ratings, praises and complaints, and run the first scrape right away.
        </p>
      </div>

      <div className="w-full max-w-md space-y-4 text-left">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-foreground">Review source</p>
          <ToggleGroup
            type="single"
            value={source}
            onValueChange={(v) => {
              if (!v) return;
              const next = v as ReviewSourceType;
              if (!planIncludesSource(plan, next)) {
                onLockedSource?.(next);
                return;
              }
              setSource(next);
              // An App Store URL can never validate as a Shopify one, so carrying the
              // field over would only ever show the user an error they didn't cause.
              setUrl(prefillFor(next));
            }}
            variant="outline"
            size="sm"
            className="w-full"
          >
            {REVIEW_SOURCE_OPTIONS.map((o) => {
              const locked = !planIncludesSource(plan, o.value);
              return (
                <ToggleGroupItem
                  key={o.value}
                  value={o.value}
                  className="grow basis-0 gap-1.5"
                  title={
                    locked ? `Requires ${PLAN_LABELS[minPlanForSource(o.value)]}` : undefined
                  }
                >
                  {locked && <LockIcon size={16} className="opacity-70" />}
                  {o.label}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-foreground">Page URL</p>
          <div className="relative">
            <LinkIcon
              size={16}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={active.placeholder}
              inputMode="url"
              autoComplete="off"
              disabled={sourceLocked}
              className="pl-8"
              aria-invalid={trimmed !== "" && !sourceLocked && !valid}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {sourceLocked
              ? `${active.label} reviews are included in the ${PLAN_LABELS[minPlanForSource(active.value)]} plan.`
              : prefill && trimmed === prefill
                ? "We found this app on their site. Change it if it is the wrong one."
                : `Must be a ${active.host} URL.`}
          </p>
        </div>
      </div>

      <Button
        size="sm"
        disabled={!onEnable || (!sourceLocked && (!valid || busy))}
        onClick={async () => {
          if (sourceLocked) return onLockedSource?.(source);
          if (!onEnable) return;
          setBusy(true);
          try {
            await onEnable(source, trimmed);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? (
          <>
            <SpinnerIcon size={16} className="animate-spin" /> Enabling…
          </>
        ) : sourceLocked ? (
          <>
            <LockIcon size={16} /> Upgrade to enable
          </>
        ) : (
          <>
            <PlusIcon size={16} /> Enable reviews monitoring
          </>
        )}
      </Button>
    </Card>
  );
}

export function ReviewsTab({
  competitorId,
  signals,
  monitors,
  scrapingIds,
  onRun,
  onEnable,
  plan,
  onLockedSource,
  detectedAppStoreUrl,
  detectedShopifyUrl,
}: {
  competitorId: string;
  /** Already on the page; carries the review-shift anchor the chart marks. */
  signals: CompetitorSignal[];
  plan: Plan;
  onLockedSource?: (source: ReviewSourceType) => void;
  /** Their App Store listing, if the mobile-app detector found one. */
  detectedAppStoreUrl?: string | null;
  /** Their Shopify App Store listing, if the homepage detector found one. */
  detectedShopifyUrl?: string | null;
} & MonitorSourceProps) {
  // The shared QueryClient serves the cache instantly on tab re-switch (no skeleton
  // flash); keepPreviousData keeps the last result during a refetch. A forced
  // re-scan invalidates ["competitor", id] from the detail view.
  const reviewsQuery = useQuery({
    queryKey: ["competitor", competitorId, "reviews"],
    queryFn: () => api.getCompetitorReviews(competitorId),
    placeholderData: keepPreviousData,
  });
  const scoresQuery = useQuery({
    queryKey: ["competitor", competitorId, "reviewScores"],
    queryFn: () => api.getCompetitorReviewScores(competitorId).then((s) => s.scores),
    placeholderData: keepPreviousData,
  });

  const reviews = reviewsQuery.data ?? null;
  const scores = scoresQuery.data ?? null;

  if (reviewsQuery.isError || scoresQuery.isError)
    return <Empty text="Couldn't load this data right now. Try again in a moment." />;
  if (!reviews || !scores) return <TabLoading />;

  // Detection stays aligned with what the picker actually exposes — a source added
  // to REVIEW_SOURCE_OPTIONS is recognised here without a second list to maintain.
  const reviewMonitor = monitors.find((m) =>
    REVIEW_SOURCE_OPTIONS.some((o) => o.value === m.sourceType),
  );

  // No review monitor yet → collect the review-page URL before enabling.
  if (!reviewMonitor) {
    return (
      <ReviewEnableState
        plan={plan}
        onEnable={onEnable}
        onLockedSource={onLockedSource}
        detectedAppStoreUrl={detectedAppStoreUrl}
        detectedShopifyUrl={detectedShopifyUrl}
      />
    );
  }

  const hasData = reviews.recent.length > 0 || scores.length > 0;
  const series = scores.length > 0 ? buildReviewScoreSeries(scores) : null;

  // The per-criterion breakdown (patch-32) is gone. `subScores` is null unless a
  // source exposes one, and since Reviews v2 retired the scraped aggregators for
  // legal reasons the two live sources do not: the App Store public RSS carries a
  // rating and a count, and the official Trustpilot API carries a rating, a count
  // and a star distribution. The section had been rendering for nobody. Bringing
  // it back means a source that publishes criteria, not a UI change.

  // Latest capture per source, newest last. The headline rating and the 90-day
  // movement both read off this rather than off the raw series.
  const sorted = [...scores].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime(),
  );
  const latest = sorted[sorted.length - 1] ?? null;
  const ninetyDaysAgo = Date.now() - 90 * 86_400_000;
  const baseline = sorted.find(
    (p) => latest && p.source === latest.source && new Date(p.recorded_at).getTime() >= ninetyDaysAgo,
  );
  const scoreDelta =
    latest && baseline && baseline !== latest ? latest.score - baseline.score : null;

  // A sub-score only means something against a reference. Their own overall score
  // is the one we always have, so an axis reads as "0.6 below their own average"
  // rather than as a bare 3.6 the reader has to rank on their own.
  const overall = latest?.score ?? null;

  // The most repeated grievance, which is the angle the tab exists to hand over.
  const topTheme =
    [...reviews.summary.complaintThemes].sort(
      (a, b) => prevalenceWeight(b.prevalence) - prevalenceWeight(a.prevalence),
    )[0] ?? null;

  // Stated from the captured numbers, never generated. Movement first: a rating
  // that slipped is the fact worth leading with, and a steady one hands over the
  // complaint instead.
  const verdict = (() => {
    if (!latest) return null;
    if (scoreDelta != null && scoreDelta <= -0.2) {
      return `Their rating slipped ${Math.abs(scoreDelta).toFixed(1)} to ${latest.score.toFixed(1)} over 90 days.`;
    }
    if (scoreDelta != null && scoreDelta >= 0.2) {
      return `Their rating climbed ${scoreDelta.toFixed(1)} to ${latest.score.toFixed(1)} over 90 days.`;
    }
    if (topTheme && topTheme.prevalence === "high") {
      return `${topTheme.theme} is what their customers repeat most.`;
    }
    return `They hold ${latest.score.toFixed(1)} across ${latest.review_count.toLocaleString()} reviews.`;
  })();

  // Where detect-review-theme-shifts crossed its threshold. Same treatment as the
  // hiring inflection: the detector already emits it, nothing showed it.
  const dropMarkers = signals
    .filter((sig) => sig.sourceType === "review_shift")
    .map((sig) => {
      const at = new Date(sig.createdAt).getTime();
      const nearest = (series?.points ?? []).reduce<{ x: string; gap: number } | null>(
        (best, pt) => {
          const labelText = String(pt.date);
          const gap = Math.abs(
            new Date(`${labelText} ${new Date(at).getFullYear()}`).getTime() - at,
          );
          if (Number.isNaN(gap)) return best;
          return !best || gap < best.gap ? { x: labelText, gap } : best;
        },
        null,
      );
      return nearest ? { x: nearest.x, label: "Drop signalled", tone: "critical" as const } : null;
    })
    .filter((m): m is { x: string; label: string; tone: "critical" } => m !== null)
    .slice(0, 1);

  return (
    <div className="flex flex-col gap-4">
      <TabCard>
        {hasData && (
          <>
            {verdict && (
              <TabSection>
                <h3 className="text-xl font-semibold leading-snug tracking-tight text-balance">
                  {verdict}
                </h3>
              </TabSection>
            )}

            <TabSection>
              <FactStrip>
                <Fact label={latest ? `${latest.source} rating` : "Rating"} muted={!latest}>
                  {latest ? (
                    <>
                      <span className="tabular-nums">{latest.score.toFixed(1)}</span>
                      <span className="text-muted-foreground">of 5</span>
                    </>
                  ) : (
                    "Not captured"
                  )}
                </Fact>
                <Fact label="Reviews counted" muted={!latest}>
                  {latest ? (
                    <span className="tabular-nums">
                      {latest.review_count.toLocaleString()}
                    </span>
                  ) : (
                    "Not captured"
                  )}
                </Fact>
                <Fact
                  label="Change, 90 days"
                  tone={scoreDelta != null && scoreDelta <= -0.2 ? "bad" : undefined}
                  muted={scoreDelta == null || Math.abs(scoreDelta) < 0.05}
                >
                  {scoreDelta == null || Math.abs(scoreDelta) < 0.05 ? (
                    "Flat"
                  ) : (
                    <span className="tabular-nums">
                      {scoreDelta > 0 ? "+" : ""}
                      {scoreDelta.toFixed(1)}
                    </span>
                  )}
                </Fact>
                <Fact label="Last check" muted={!reviewMonitor.lastRunAt}>
                  {reviewMonitor.lastRunAt
                    ? formatDistanceToNow(new Date(reviewMonitor.lastRunAt), { addSuffix: true })
                    : "Never scanned"}
                </Fact>
              </FactStrip>
            </TabSection>

            <SourceSummary
              summary={reviewMonitor.aiSummary}
              updatedAt={reviewMonitor.aiSummaryUpdatedAt}
            />

            {/* Promoted from last to first among the analyses. The tab already
                called these the angles you can lead with, then printed them under
                a chart and two columns of verbatims. */}
            {reviews.summary.complaintThemes.length > 0 && (
              <TabSection title="Angles you can lead with">
                <p className="text-sm text-muted-foreground">
                  Grievances that repeat across reviews, most common first.
                </p>
                <ul className="flex flex-col">
                  {[...reviews.summary.complaintThemes]
                    .sort(
                      (a, b) =>
                        prevalenceWeight(b.prevalence) - prevalenceWeight(a.prevalence),
                    )
                    .map((t, i) => (
                      <li
                        key={i}
                        className="grid grid-cols-[minmax(0,1fr)_3.25rem] items-center gap-x-4 border-t border-border py-2.5 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_3.25rem_7rem]"
                      >
                        <span
                          className={cn(
                            "text-sm",
                            t.prevalence === "high"
                              ? "font-medium text-foreground"
                              : t.prevalence === "low"
                                ? "text-muted-foreground"
                                : undefined,
                          )}
                        >
                          {t.theme}
                        </span>
                        {/* A horizontal track on purpose: severity already owns the
                            vertical tick scale and the threat meter owns ascending
                            bars, so a third ordinal encoding needs its own shape. */}
                        <span className="h-1 overflow-hidden rounded-full bg-track">
                          <span
                            className={cn(
                              "block h-full rounded-full",
                              t.prevalence === "high" ? "bg-critical" : "bg-muted-foreground",
                            )}
                            style={{ width: `${prevalenceWeight(t.prevalence) * 33.4}%` }}
                          />
                        </span>
                        <span className="hidden text-xs text-muted-foreground sm:block">
                          {prevalenceLabel(t.prevalence)}
                        </span>
                      </li>
                    ))}
                </ul>
              </TabSection>
            )}

            {series && (
              <TabSection title="Rating over time">
                <MultiLineChart
                  data={series.points}
                  seriesKeys={series.sources}
                  height={220}
                  yDomain={[0, 5]}
                  dot
                  markers={dropMarkers}
                />
              </TabSection>
            )}

            {/* Not two symmetric columns: complaints are the wedge, praise is what
                you have to match. Complaints lead and take the wider column. */}
            <TabSection title="In their words">
              <div className="grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-[1.35fr_1fr]">
                <ReviewColumn
                  title="What they complain about"
                  items={reviews.summary.complaints}
                  accent="critical"
                />
                <ReviewColumn
                  title="What they love"
                  items={reviews.summary.praises}
                  accent="positive"
                />
              </div>
            </TabSection>

          </>
        )}
      </TabCard>

      {!hasData && (
        <MonitorEmptyState
          source={reviewMonitor.sourceType as SourceType}
          label="reviews"
          monitors={monitors}
          scrapingIds={scrapingIds}
          onRun={onRun}
          onEnable={onEnable}
        />
      )}

    </div>
  );
}

function ReviewColumn({
  title,
  items,
  accent,
}: {
  title: string;
  items: Array<string | null>;
  accent: "positive" | "critical";
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <h3
        className={cn(
          "flex items-center gap-2 text-sm font-semibold tracking-tight",
          accent === "positive" ? "text-positive" : "text-critical",
        )}
      >
        <span
          className={cn(
            "h-2 w-2 rounded-full shrink-0",
            accent === "positive" ? "bg-positive" : "bg-critical",
          )}
        />
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-dense text-muted-foreground">Nothing clustered yet.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-content">
          {items.filter(Boolean).map((it, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-muted-foreground/40 shrink-0">·</span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
