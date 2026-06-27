"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Lock, Plus, Loader2, Activity, Star, Settings2 } from "lucide-react";
import {
  PLAN_LABELS,
  MONITOR_FREQUENCIES,
  planIncludesSource,
  minPlanForSource,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TabCard, TabSection } from "@/components/outrival/tab-shell";
import { buildReviewScoreSeries } from "./charts";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  TabLoading,
  MonitorEmptyState,
  SourceSummary,
  FrequencyButton,
  type MonitorSourceProps,
} from "./shared";

// recharts is heavy + client-only: lazy-load the chart so it stays off this
// route's first-load bundle (F7).
const MultiLineChart = dynamic(() => import("./chart-line"), {
  ssr: false,
  loading: () => <Skeleton className="h-[220px] w-full" />,
});

const REVIEW_SOURCE_OPTIONS: {
  value: ReviewSourceType;
  label: string;
  host: string;
  placeholder: string;
}[] = [
  {
    value: "g2_reviews",
    label: "G2",
    host: "g2.com",
    placeholder: "https://www.g2.com/products/<slug>/reviews",
  },
  {
    value: "capterra_reviews",
    label: "Capterra",
    host: "capterra.com",
    placeholder: "https://www.capterra.com/p/<id>/<slug>/reviews/",
  },
  {
    value: "appstore_reviews",
    label: "App Store",
    host: "apps.apple.com",
    placeholder: "https://apps.apple.com/us/app/<slug>/id000000000",
  },
];

// A review-source pill carrying the plan it's included in. Sources the current
// plan doesn't cover are locked (lock icon) and route to the paywall on click
// instead of being selectable — keeping the picker in sync with the server gate.
function ReviewSourceButton({
  option,
  plan,
  selected,
  onSelect,
  onLocked,
}: {
  option: { value: ReviewSourceType; label: string };
  plan: Plan;
  selected: boolean;
  onSelect: () => void;
  onLocked: () => void;
}) {
  const locked = !planIncludesSource(plan, option.value);
  return (
    <Button
      type="button"
      size="sm"
      variant={selected ? "default" : "secondary"}
      onClick={() => (locked ? onLocked() : onSelect())}
      className="h-7 gap-1.5 text-xs"
    >
      {locked && <Lock size={10} className="opacity-70" />}
      {option.label}
      <span
        className={cn(
          "inline-flex items-center rounded px-1 py-0.5 text-meta leading-none font-medium uppercase tracking-wide",
          selected ? "bg-primary-foreground/15" : "bg-muted-foreground/15 text-muted-foreground",
        )}
      >
        {PLAN_LABELS[minPlanForSource(option.value)]}
      </span>
    </Button>
  );
}

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
          capture ratings, praises and complaints — and run the first scrape right away.
        </p>
      </div>

      <div className="flex gap-1.5">
        {REVIEW_SOURCE_OPTIONS.map((o) => (
          <ReviewSourceButton
            key={o.value}
            option={o}
            plan={plan}
            selected={o.value === source}
            onSelect={() => setSource(o.value)}
            onLocked={() => onLockedSource?.(o.value)}
          />
        ))}
      </div>

      <div className="w-full max-w-md flex flex-col gap-1.5 text-left">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={active.placeholder}
          inputMode="url"
          autoComplete="off"
          disabled={sourceLocked}
        />
        <p className="text-xs text-muted-foreground">
          {sourceLocked
            ? `${active.label} reviews are included in the ${PLAN_LABELS[minPlanForSource(active.value)]} plan.`
            : `Must be a ${active.host} URL.`}
        </p>
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
    return <Empty text="Couldn't load this data right now — try again in a moment." />;
  if (!reviews || !scores) return <TabLoading />;

  const reviewMonitor = monitors.find(
    (m) =>
      m.sourceType === "g2_reviews" ||
      m.sourceType === "capterra_reviews" ||
      m.sourceType === "appstore_reviews",
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
            {series && (
              <TabSection title="Score over time" icon={Activity}>
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
              <TabSection title="Rating breakdown" icon={Star}>
                <div className="space-y-2.5 max-w-md">
                  {subRows.map((r) => (
                    <div key={r.label} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 text-xs text-muted-foreground">
                        {r.label}
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                        <div
                          className="h-full rounded-full bg-foreground/80"
                          style={{ width: `${(r.v / 5) * 100}%` }}
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-foreground/85">
                        {r.v.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              </TabSection>
            )}

            <TabSection title="What customers say" icon={Star}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
                <ReviewColumn
                  title="What they love"
                  items={reviews.summary.praises}
                  accent="positive"
                />
                <ReviewColumn
                  title="What they complain about"
                  items={reviews.summary.complaints}
                  accent="critical"
                />
              </div>
            </TabSection>

            {reviews.summary.complaintThemes.length > 0 && (
              <TabSection title="Recurring complaints" icon={Star}>
                <p className="mb-3 text-xs text-muted-foreground">
                  Repeated grievances across reviews — each is an angle you can lead with.
                </p>
                <ul className="space-y-2">
                  {reviews.summary.complaintThemes.map((t, i) => (
                    <li key={i} className="flex items-center justify-between gap-3">
                      <span className="text-dense">{t.theme}</span>
                      <span
                        className={cn(
                          "shrink-0 rounded-md border px-1.5 py-0.5 text-xs capitalize",
                          t.prevalence === "high"
                            ? "border-critical/40 text-critical"
                            : t.prevalence === "medium"
                              ? "border-border text-foreground/85"
                              : "border-border text-muted-foreground",
                        )}
                      >
                        {t.prevalence}
                      </span>
                    </li>
                  ))}
                </ul>
              </TabSection>
            )}
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
        <Settings2 size={12} /> Manage source
      </Button>
    </div>
  );
}

// Edit the active review monitor: change the page URL / frequency in place, or
// switch the review source entirely (G2 ↔ Capterra ↔ App Store). Switching
// replaces the monitor — handled by onSwitch (delete old + enable new).
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage review source</DialogTitle>
          <DialogDescription>
            Edit the watched page and cadence, or switch to another review site.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Source
            </p>
            <div className="flex gap-1.5">
              {REVIEW_SOURCE_OPTIONS.map((o) => (
                <ReviewSourceButton
                  key={o.value}
                  option={o}
                  plan={plan}
                  selected={o.value === source}
                  onSelect={() => setSource(o.value)}
                  onLocked={() => {
                    onClose();
                    onLockedSource?.(o.value);
                  }}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Frequency
            </p>
            <div className="flex gap-1.5">
              {MONITOR_FREQUENCIES.map((f) => (
                <FrequencyButton
                  key={f}
                  freq={f}
                  plan={plan}
                  selected={frequency === f}
                  disabled={sourceChanged}
                  onSelect={() => setFrequency(f)}
                  onLocked={() => {
                    onClose();
                    onLockedFrequency(f);
                  }}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Page URL
            </p>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={active.placeholder}
              inputMode="url"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">Must be a {active.host} URL.</p>
            {trimmed !== "" && !urlValid && (
              <p className="text-xs text-critical/80">
                This URL isn&apos;t valid for {active.label}.
              </p>
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
        <p className="text-dense text-muted-foreground">—</p>
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
