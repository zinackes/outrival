"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Lock, Plus, Loader2, Activity, Star, Settings2, Link2, HelpCircle } from "lucide-react";
import {
  PLAN_LABELS,
  MONITOR_FREQUENCIES,
  planIncludesSource,
  minPlanForSource,
  planIncludesFrequency,
  minPlanForFrequency,
  validateReviewUrl,
  type Plan,
  type SourceType,
  type ReviewSourceType,
  type MonitorFrequency,
} from "@outrival/shared";
import { api, type Monitor } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

// Reviews v2 (2026-07-15): the scraped aggregators (G2/Capterra/Trustpilot) are
// retired for legal reasons. App Store (Apple's public RSS feed) is the only
// URL-based review source. Trustpilot survives as the surface-only
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
];

function ReviewEnableState({
  plan,
  onEnable,
  onLockedSource,
}: {
  plan: Plan;
  onEnable?: (source: SourceType, url?: string) => Promise<void>;
  onLockedSource?: (source: ReviewSourceType) => void;
}) {
  // Default to a source the plan actually covers so the form is usable out of the
  // gate; falls back to the first option when the plan covers none — then the form
  // is locked and the primary CTA routes to the paywall.
  const firstAllowed =
    REVIEW_SOURCE_OPTIONS.find((o) => planIncludesSource(plan, o.value))?.value ??
    REVIEW_SOURCE_OPTIONS[0]!.value;
  const [source, setSource] = useState<ReviewSourceType>(firstAllowed);
  const [url, setUrl] = useState("");
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
                  {locked && <Lock size={11} className="opacity-70" />}
                  {o.label}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-foreground">Page URL</p>
          <div className="relative">
            <Link2
              size={14}
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
            <Loader2 size={12} className="animate-spin" /> Enabling…
          </>
        ) : sourceLocked ? (
          <>
            <Lock size={12} /> Upgrade to enable
          </>
        ) : (
          <>
            <Plus size={12} /> Enable reviews monitoring
          </>
        )}
      </Button>
    </Card>
  );
}

export function ReviewsTab({
  competitorId,
  monitors,
  scrapingIds,
  onRun,
  onEnable,
  onEdit,
  onSwitch,
  plan,
  onLockedSource,
  onLockedFrequency,
}: {
  competitorId: string;
  plan: Plan;
  onLockedSource?: (source: ReviewSourceType) => void;
  onLockedFrequency: (freq: MonitorFrequency) => void;
  onEdit: (id: string, patch: { url?: string; frequency?: MonitorFrequency }) => Promise<void>;
  onSwitch: (oldMonitorId: string, source: SourceType, url: string) => Promise<void>;
} & MonitorSourceProps) {
  const [managing, setManaging] = useState(false);

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
    return <ReviewEnableState plan={plan} onEnable={onEnable} onLockedSource={onLockedSource} />;
  }

  const hasData = reviews.recent.length > 0 || scores.length > 0;
  const series = scores.length > 0 ? buildReviewScoreSeries(scores) : null;

  // Per-criterion breakdown (patch-32): which axes the competitor wins/loses on.
  const sub = reviews.summary.subScores;
  const subRows: Array<{ label: string; v: number }> = sub
    ? [
        { label: "Ease of use", v: sub.easeOfUse },
        { label: "Support", v: sub.support },
        { label: "Features", v: sub.features },
        { label: "Value", v: sub.value },
      ].filter((r): r is { label: string; v: number } => r.v != null)
    : [];

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
  const weakest =
    subRows.length > 0
      ? subRows.reduce((acc, r) => (r.v < acc.v ? r : acc), subRows[0]!)
      : null;

  return (
    <div className="flex flex-col gap-4">
      <TabCard>
        <TabSection>
          <ReviewSourceToolbar monitor={reviewMonitor} onManage={() => setManaging(true)} />
        </TabSection>

        <SourceSummary
          summary={reviewMonitor.aiSummary}
          updatedAt={reviewMonitor.aiSummaryUpdatedAt}
        />

        {hasData && (
          <>
            <TabSection>
              <FactStrip>
                <Fact label={latest ? `${latest.source} rating` : "Rating"} muted={!latest}>
                  {latest ? (
                    <>
                      <span className="font-mono tabular-nums">{latest.score.toFixed(1)}</span>
                      <span className="text-muted-foreground">of 5</span>
                    </>
                  ) : (
                    "Not captured"
                  )}
                </Fact>
                <Fact label="Reviews counted" muted={!latest}>
                  {latest ? (
                    <span className="font-mono tabular-nums">
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
                    <span className="font-mono tabular-nums">
                      {scoreDelta > 0 ? "+" : ""}
                      {scoreDelta.toFixed(1)}
                    </span>
                  )}
                </Fact>
                <Fact label="Weakest axis" muted={!weakest}>
                  {weakest ? weakest.label : "No breakdown"}
                </Fact>
              </FactStrip>
            </TabSection>

            {/* Promoted from last to first among the analyses. The tab already
                called these the angles you can lead with, then printed them under
                a chart and two columns of verbatims. */}
            {reviews.summary.complaintThemes.length > 0 && (
              <TabSection title="Angles you can lead with" icon={Star}>
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
                        <span className="h-1 overflow-hidden rounded-full bg-surface-3">
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
              <TabSection title="Rating over time" icon={Activity}>
                <MultiLineChart
                  data={series.points}
                  seriesKeys={series.sources}
                  height={220}
                  yDomain={[0, 5]}
                  dot
                />
              </TabSection>
            )}

            {subRows.length > 0 && (
              <TabSection
                title="Where the rating comes from"
                icon={Star}
                action={
                  overall != null && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      marker shows their overall{" "}
                      <span className="font-mono tabular-nums">{overall.toFixed(1)}</span>
                    </span>
                  )
                }
              >
                <div className="flex max-w-xl flex-col gap-3">
                  {subRows.map((r) => {
                    const gap = overall != null ? r.v - overall : null;
                    return (
                      <div key={r.label} className="flex items-center gap-3">
                        <span className="w-24 shrink-0 text-dense text-muted-foreground">
                          {r.label}
                        </span>
                        <div className="relative h-1.5 flex-1 rounded-full bg-surface-3">
                          <div
                            className="absolute inset-y-0 left-0 rounded-full bg-foreground/55"
                            style={{ width: `${(r.v / 5) * 100}%` }}
                          />
                          {overall != null && (
                            <div
                              aria-hidden
                              className="absolute -inset-y-1 w-0.5 rounded-full bg-muted-foreground"
                              style={{ left: `${(overall / 5) * 100}%` }}
                            />
                          )}
                        </div>
                        <span className="flex w-20 shrink-0 items-baseline justify-end gap-1.5">
                          <span className="font-mono text-dense tabular-nums">
                            {r.v.toFixed(1)}
                          </span>
                          {gap != null && (
                            <span
                              className={cn(
                                "text-xs",
                                Math.abs(gap) < 0.05
                                  ? "text-muted-foreground"
                                  : gap < 0
                                    ? "text-critical"
                                    : "text-positive",
                              )}
                            >
                              {Math.abs(gap) < 0.05
                                ? "even"
                                : `${gap > 0 ? "+" : ""}${gap.toFixed(1)}`}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </TabSection>
            )}

            {/* Not two symmetric columns: complaints are the wedge, praise is what
                you have to match. Complaints lead and take the wider column. */}
            <TabSection title="In their words" icon={Star}>
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

      <ReviewSourceDialog
        open={managing}
        monitor={reviewMonitor}
        plan={plan}
        onClose={() => setManaging(false)}
        onEdit={onEdit}
        onSwitch={onSwitch}
        onLockedSource={onLockedSource}
        onLockedFrequency={onLockedFrequency}
      />
    </div>
  );
}

// Header row above the reviews content: shows the active review source + the
// pinned page, with one entry point to edit the URL/frequency or switch source.
function ReviewSourceToolbar({
  monitor,
  onManage,
}: {
  monitor: Monitor;
  onManage: () => void;
}) {
  const opt = REVIEW_SOURCE_OPTIONS.find((o) => o.value === monitor.sourceType);
  const url = monitor.config?.url ?? "";
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="shrink-0 text-dense font-medium text-foreground">
          {opt?.label ?? monitor.sourceType}
        </span>
        {url && (
          <span className="truncate text-xs font-mono text-muted-foreground">{url}</span>
        )}
      </div>
      <Button size="sm" variant="outline" onClick={onManage} className="h-7 text-xs shrink-0">
        <Settings2 size={12} /> Configure
      </Button>
    </div>
  );
}

// Edit the active review monitor: change the page URL / frequency in place. Since
// Reviews v2 retired the scraped aggregators, App Store is the only URL-based review
// source, so the source picker below is effectively a single option; onSwitch is kept
// for when another URL-based review source returns (e.g. a connected G2 vendor account).
function ReviewSourceDialog({
  open,
  monitor,
  plan,
  onClose,
  onEdit,
  onSwitch,
  onLockedSource,
  onLockedFrequency,
}: {
  open: boolean;
  monitor: Monitor;
  plan: Plan;
  onClose: () => void;
  onEdit: (id: string, patch: { url?: string; frequency?: MonitorFrequency }) => Promise<void>;
  onSwitch: (oldMonitorId: string, source: SourceType, url: string) => Promise<void>;
  onLockedSource?: (source: ReviewSourceType) => void;
  onLockedFrequency: (freq: MonitorFrequency) => void;
}) {
  const currentSource = monitor.sourceType as ReviewSourceType;
  const currentUrl = monitor.config?.url ?? "";
  const [source, setSource] = useState<ReviewSourceType>(currentSource);
  const [url, setUrl] = useState(currentUrl);
  const [frequency, setFrequency] = useState<MonitorFrequency>(
    monitor.frequency as MonitorFrequency,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setSource(monitor.sourceType as ReviewSourceType);
      setUrl(monitor.config?.url ?? "");
      setFrequency(monitor.frequency as MonitorFrequency);
    }
  }, [open, monitor]);

  const active = REVIEW_SOURCE_OPTIONS.find((o) => o.value === source)!;
  const trimmed = url.trim();
  const sourceChanged = source !== currentSource;
  const urlValid = trimmed.length > 0 && validateReviewUrl(source, trimmed).ok;
  const urlChanged = trimmed !== currentUrl;
  const freqChanged = frequency !== monitor.frequency;
  const canSave = !busy && urlValid && (sourceChanged || urlChanged || freqChanged);

  async function save() {
    setBusy(true);
    try {
      if (sourceChanged) {
        await onSwitch(monitor.id, source, trimmed);
      } else {
        const patch: { url?: string; frequency?: MonitorFrequency } = {};
        if (urlChanged) patch.url = trimmed;
        if (freqChanged) patch.frequency = frequency;
        if (Object.keys(patch).length > 0) await onEdit(monitor.id, patch);
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Configure reviews</DialogTitle>
          <DialogDescription>
            Choose the review site, pin the page to watch, and how often it&apos;s checked.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">Review source</p>
            <ToggleGroup
              type="single"
              value={source}
              onValueChange={(v) => {
                if (!v) return;
                const next = v as ReviewSourceType;
                if (!planIncludesSource(plan, next)) {
                  onClose();
                  onLockedSource?.(next);
                  return;
                }
                setSource(next);
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
                    {locked && <Lock size={11} className="opacity-70" />}
                    {o.label}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-medium text-foreground">Check frequency</p>
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="What does check frequency mean?"
                      className="text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
                    >
                      <HelpCircle size={13} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-56">
                    An upper bound. Stable sources are checked less often automatically.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <ToggleGroup
              type="single"
              value={frequency}
              onValueChange={(v) => {
                if (!v) return;
                const next = v as MonitorFrequency;
                if (!planIncludesFrequency(plan, next)) {
                  onClose();
                  onLockedFrequency(next);
                  return;
                }
                setFrequency(next);
              }}
              variant="outline"
              size="sm"
              className="w-full"
              disabled={sourceChanged}
            >
              {MONITOR_FREQUENCIES.map((f) => {
                const locked = !planIncludesFrequency(plan, f);
                return (
                  <ToggleGroupItem
                    key={f}
                    value={f}
                    className="grow basis-0 gap-1.5 capitalize hover:bg-muted hover:text-foreground data-[state=on]:font-semibold data-[state=on]:hover:bg-accent data-[state=on]:hover:text-accent-foreground"
                    title={
                      locked ? `Requires ${PLAN_LABELS[minPlanForFrequency(f)]}` : undefined
                    }
                  >
                    {locked && <Lock size={11} className="opacity-70" />}
                    {f}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">Page URL</p>
            <div className="relative">
              <Link2
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={active.placeholder}
                inputMode="url"
                autoComplete="off"
                className="pl-8"
                aria-invalid={trimmed !== "" && !urlValid}
              />
            </div>
            {trimmed !== "" && !urlValid ? (
              <p className="text-xs text-critical">
                This URL isn&apos;t valid for {active.label}.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Must be a {active.host} URL.</p>
            )}
          </div>
          {sourceChanged && (
            <p className="text-xs text-critical/80">
              Switching source replaces the current monitor and its captured history.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={!canSave}>
            {busy && <Loader2 size={12} className="animate-spin" />}
            {sourceChanged ? "Switch source" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
