"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Play,
  ExternalLink,
  Activity,
  DollarSign,
  Briefcase,
  Star,
  FileText,
  Sparkles,
  Swords,
  Loader2,
  Trash2,
  RefreshCw,
  MoreHorizontal,
  Plus,
  Lock,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Pause,
  PauseCircle,
  Bell,
  BellOff,
  Download,
  Link2,
  Boxes,
  Crosshair,
  Palette,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PaywallDialog,
  paywallFromError,
  type PaywallReason,
} from "@/components/outrival/paywall-dialog";
import { track } from "@/lib/posthog/events";
import {
  PLAN_LABELS,
  minPlanForSource,
  planIncludesSource,
  minPlanForFrequency,
  planIncludesFrequency,
  aggregateFreshness,
  deriveAnalysisStatus,
  type Plan,
  type AnalysisStatus,
  type DetectedTargets,
} from "@outrival/shared";
import { FreshnessDot } from "@/components/outrival/freshness-dot";
import { AnalysisNotice, AnalysisProgress } from "@/components/outrival/analysis-status";
import { CompetitorColorPicker } from "@/components/dashboard/competitor-color-picker";
import { competitorNameColor } from "@/lib/competitor-color";
import { TabCard, TabSection } from "@/components/outrival/tab-shell";
import { Reveal } from "@/components/outrival/reveal";
import { ListError } from "@/components/outrival/list-error";
import { toastApiError, toastRescanLimit } from "@/lib/error-helpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { friendlyScrapeError } from "@/lib/scrape-errors";
import { sourceShortLabel } from "@/lib/source-labels";
import CompetitorDetailLoading from "./detail-skeleton";
import {
  api,
  type Competitor,
  type Monitor,
  type ChangeRow,
  type CompetitorSignal,
  type TechStackData,
  type CompetitorOverview,
} from "@/lib/api";
import { competitorDetailQuery, competitorsQuery } from "@/lib/queries";
import { useSetAskContext } from "@/components/dashboard/ask-context";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import {
  POLL_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  isServerScraping,
  MonitorEmptyState,
  Empty,
  TabLoading,
  SourceSummary,
} from "./competitor-detail/shared";
import { PricingTab } from "./competitor-detail/pricing-tab";
import { HiringTab } from "./competitor-detail/hiring-tab";
import { ReviewsTab } from "./competitor-detail/reviews-tab";
import { OverviewTab } from "./competitor-detail/overview-tab";
import { ActivityTab } from "./competitor-detail/activity-tab";
import { ProductTab } from "./competitor-detail/product-tab";
import { PRODUCT_SOURCES } from "./competitor-detail/product-lenses";
import { useMonitorActions } from "./competitor-detail/use-monitor-actions";
import { resolveTabParam } from "./competitor-detail/tab-migration";
import { CompetitorCoverage } from "./competitor-detail/competitor-coverage";
import type { TabKey } from "./competitor-detail/types";

// Six reading tabs, grouped by the question they answer. Configuration does not
// live here any more — it moved to the Sources sub-page, so a tab is only ever a
// lens on data. Tech stack became an Overview card, battle cards their own page.
const TABS: Array<{ key: TabKey; label: string; icon: typeof Activity }> = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "activity", label: "Activity", icon: Activity },
  { key: "pricing", label: "Pricing", icon: DollarSign },
  { key: "hiring", label: "Hiring", icon: Briefcase },
  { key: "reviews", label: "Reviews", icon: Star },
  { key: "product", label: "Product & Positioning", icon: FileText },
];

const VISIBLE_TABS = TABS;

// Per-tab freshness dot (patch-14): tabs backed by monitored sources show how
// recent that section's data is. Activity (signal feed) has no single source → no dot.
const TAB_SOURCES: Partial<Record<TabKey, string[]>> = {
  pricing: ["pricing"],
  hiring: ["jobs"],
  reviews: ["appstore_reviews", "trustpilot_public"],
  product: [...PRODUCT_SOURCES],
};

function tabFreshness(key: TabKey, monitors: Monitor[]) {
  const sources = TAB_SOURCES[key];
  if (!sources) return null;
  return aggregateFreshness(monitors.filter((m) => sources.includes(m.sourceType)));
}

// Plan-gated tabs: a tab whose data the current plan can't access is locked at
// the trigger (lock icon + min-plan tooltip) and opens the paywall on click
// instead of switching. Mirrors the API source gates — the jobs source (hiring)
// and the cheapest review source (reviews). Tabs without a plan requirement
// (overview/activity/pricing/product) return null.
function tabLock(key: TabKey, plan: Plan): { reason: PaywallReason; minPlan: Plan } | null {
  switch (key) {
    case "hiring":
      if (planIncludesSource(plan, "jobs")) return null;
      return {
        reason: { code: "plan_locked_source", source: "jobs", plan },
        minPlan: minPlanForSource("jobs"),
      };
    case "reviews":
      // Reviews v2: App Store (public RSS) is the cheapest live review source (pro+);
      // gate the tab on it rather than the retired g2_reviews (now ungated → its
      // planIncludesSource is false on every plan, which would lock the tab for all).
      if (planIncludesSource(plan, "appstore_reviews")) return null;
      return {
        reason: { code: "plan_locked_source", source: "appstore_reviews", plan },
        minPlan: minPlanForSource("appstore_reviews"),
      };
    default:
      return null;
  }
}


// Shared shell for every tab body. Radix unmounts inactive TabsContent, so the
// entrance animation replays on each switch — applying it here (not per-tab) means
// every tab fades/slides in identically instead of some animating and some snapping.
const TAB_PANEL_CLASS = "animate-in fade-in slide-in-from-bottom-1 duration-300";

// AI-summary generation is a fire-and-trigger job (refresh-competitor-summary) that
// can take well beyond a single tick — queued behind other summaries (concurrency 1),
// slow AI failover, retries. We persist the in-progress marker per competitor so the
// "Generating…" state + completion poll survive navigating away and back / a reload,
// instead of dying with the component (the old fixed 6s refetch gave up far too early).
const summaryGenKey = (competitorId: string) => `outrival:summary-gen:${competitorId}`;
type SummaryGenMeta = { startedAt: number; baseline: string | null };

export type CompetitorData = {
  competitor: Competitor;
  monitors: Monitor[];
  /** Seeded and scraped on their own cadence — read-only on the Sources page. */
  automaticMonitors: Monitor[];
  recentChanges: ChangeRow[];
  recentSignals: CompetitorSignal[];
  techStack: TechStackData;
  overview: CompetitorOverview;
  plan: Plan;
};

/**
 * What platform detection actually resolved for this competitor. Null when it has
 * never run: without evidence, an absent source is only "not turned on", never
 * "this competitor has no such surface" — we don't claim absence we didn't look for.
 */
function detectedTargetsOf(techStack: TechStackData): DetectedTargets | null {
  const profile = techStack.platformProfile;
  if (!profile) return null;
  return {
    statusPage: !!profile.statusPage?.value,
    changelog: !!profile.changelog?.value,
  };
}

export function CompetitorDetailView({ id }: { id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Every monitor write + the scrape-progress poller. Shared with the Sources page,
  // which performs the same mutations against the same cached detail query.
  const {
    data,
    error,
    scrapingIds,
    runningAll,
    paywall,
    setPaywall,
    setData,
    refresh,
    requestRunMonitor,
    runAllMonitors,
    resumeMonitor,
    setMonitorActive,
    enableMonitor,
    editMonitor,
    switchReviewSource,
  } = useMonitorActions(id);
  const [tab, setTab] = useState<TabKey>("overview");
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // AI-summary generation poll (persisted across navigation, see summaryGenKey).
  const [summaryGenerating, setSummaryGenerating] = useState(false);
  const summaryStartRef = useRef<SummaryGenMeta | null>(null);
  const summarySeededIdRef = useRef<string | null>(null);

  // Where the first AI analysis is at (queued → scraping → summarizing → ready),
  // derived from the homepage monitor's scrape state + whether a summary exists.
  // Recomputes on every data refresh (the pollers below keep it moving).
  const analysis: AnalysisStatus | null = useMemo(() => {
    if (!data) return null;
    const homepage = data.monitors.find((m) => m.sourceType === "homepage") ?? null;
    return deriveAnalysisStatus(
      {
        hasSummary: Boolean(data.competitor.aiSummary),
        anchor: homepage
          ? {
              lastRunAt: homepage.lastRunAt,
              lastFailedAt: homepage.lastFailedAt,
              scrapeStartedAt: homepage.scrapeStartedAt,
              markedUnscrapable: homepage.markedUnscrapable ?? false,
              isActive: homepage.isActive !== false,
            }
          : null,
      },
      Date.now(),
    );
  }, [data]);

  // Prev/next pager across the competitor roster (Linear "n/total" + chevrons):
  // fetch the ordered roster once; the pager walks it so an analyst flips through
  // competitors without bouncing back to the list. Order = the list's default.
  // Shares the ["competitors"] roster cache with the list / overview / sidebar.
  // Scoped to the active product (patch-28 switcher) so the pager stays within the
  // product's competitors instead of walking the whole org roster across products.
  const productScope = useProductScope() ?? undefined;
  const rosterQ = useQuery(competitorsQuery(productScope));
  const roster = useMemo(
    () => rosterQ.data?.map((c) => ({ id: c.id, name: c.name })) ?? null,
    [rosterQ.data],
  );
  const rosterIdx = roster ? roster.findIndex((c) => c.id === id) : -1;
  const prevId = rosterIdx > 0 ? roster?.[rosterIdx - 1]?.id ?? null : null;
  const nextId =
    roster && rosterIdx >= 0 && rosterIdx < roster.length - 1
      ? roster[rosterIdx + 1]?.id ?? null
      : null;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      // AZERTY/QWERTZ keyboards emit "[" and "]" via AltGr, which Windows/Linux
      // report as ctrlKey+altKey — so don't blanket-filter those, or the shortcut
      // never fires. Detect AltGraph explicitly; still block genuine Cmd/Ctrl combos.
      const altGraph =
        typeof e.getModifierState === "function" && e.getModifierState("AltGraph");
      if (e.metaKey || ((e.ctrlKey || e.altKey) && !altGraph)) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      // Let an open dialog / popover keep the keyboard.
      if (
        document.querySelector(
          '[role="dialog"][data-state="open"], [data-radix-popper-content-wrapper]',
        )
      )
        return;
      if (e.key === "[" && prevId) {
        e.preventDefault();
        router.push(`/dashboard/competitors/${prevId}`);
      } else if (e.key === "]" && nextId) {
        e.preventDefault();
        router.push(`/dashboard/competitors/${nextId}`);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [prevId, nextId, router]);

  // Restore the active tab from the URL (?tab=) so a refresh stays on the same
  // tab. Runs once on mount, before the Tabs render (data is still loading).
  // Retired keys are remapped rather than ignored: ?tab=battlecard is written into
  // notifications.link_url by generate-battle-card, so links already in the
  // database point at tabs this page no longer has.
  useEffect(() => {
    const target = resolveTabParam(new URLSearchParams(window.location.search).get("tab"));
    if (!target) return;
    if (target.kind === "route") router.replace(`/dashboard/competitors/${id}/${target.segment}`);
    else setTab(target.tab);
  }, [id, router]);

  // Switch tab and mirror it into the URL so it survives a reload (replaceState,
  // no history entry per tab click).
  function selectTab(key: TabKey) {
    setTab(key);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", key);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      await api.deleteCompetitor(id);
      toast.success("Competitor deleted");
      void queryClient.invalidateQueries({ queryKey: competitorsQuery().queryKey });
      router.push("/dashboard/competitors");
    } catch (e) {
      toastApiError(e, { title: "Couldn't delete the competitor" });
      setDeleting(false);
    }
  }

  // Kebab → Edit details. Patches name/url/category/description, then merges the
  // returned row into local state (and refreshes the global list dot/name).
  async function saveCompetitorDetails(patch: {
    name?: string;
    url?: string;
    category?: string | null;
    description?: string | null;
    color?: string | null;
  }) {
    const { competitor } = await api.updateCompetitor(id, patch);
    setData((d) => (d ? { ...d, competitor } : d));
    void queryClient.invalidateQueries({ queryKey: competitorsQuery().queryKey });
    toast.success("Competitor updated");
  }

  // Kebab → Pause / Resume monitoring. Optimistic local flip; the scheduler honours
  // the flag on its next cycle.
  async function toggleMonitoringPaused() {
    if (!data) return;
    const next = !data.competitor.monitoringPaused;
    try {
      await api.setCompetitorMonitoring(id, next);
      // The paused state flips visibly (header banner + kebab label), so skip the
      // confirmation toast; only errors need surfacing.
      setData((d) => (d ? { ...d, competitor: { ...d.competitor, monitoringPaused: next } } : d));
    } catch (e) {
      toastApiError(e, { title: "Couldn't update monitoring" });
    }
  }

  // Kebab → Mute / Unmute alerts. Signals keep flowing into the feed; only the
  // real-time alert (email/Slack/in-app) is suppressed while muted.
  async function toggleAlertsMuted() {
    if (!data) return;
    const next = !data.competitor.alertsMuted;
    try {
      await api.setCompetitorAlerts(id, next);
      // The muted state flips visibly (header banner + kebab label), so skip the
      // confirmation toast; only errors need surfacing.
      setData((d) => (d ? { ...d, competitor: { ...d.competitor, alertsMuted: next } } : d));
    } catch (e) {
      toastApiError(e, { title: "Couldn't update alerts" });
    }
  }

  // Kebab → Recompute overlap. Re-scores this competitor against the current
  // product profile (synchronous AI call, a few seconds) and updates the header badge.
  async function recomputeOverlap() {
    const toastId = toast.loading("Recomputing overlap…");
    try {
      const { overlapScore } = await api.recomputeCompetitorOverlap(id);
      setData((d) => (d ? { ...d, competitor: { ...d.competitor, overlapScore } } : d));
      void queryClient.invalidateQueries({ queryKey: competitorsQuery().queryKey });
      toast.success("Overlap recomputed", {
        id: toastId,
        description:
          overlapScore != null ? `New overlap score: ${Math.round(overlapScore)}` : undefined,
      });
    } catch (e) {
      if ((e as { code?: string })?.code === "missing_profile") {
        toast.error("No product profile yet", {
          id: toastId,
          description: "Finish onboarding so we can score competitors against your product.",
        });
        return;
      }
      toast.dismiss(toastId);
      toastApiError(e, { title: "Couldn't recompute overlap" });
    }
  }

  // Trigger the AI-summary job and poll until it lands. Shared by the Summary card's
  // button and the kebab "Refresh AI summary". The in-progress marker is persisted
  // (summaryGenKey) so the spinner + poll resume if you leave and come back or reload —
  // the job runs server-side regardless; we just keep watching for its result instead
  // of giving up after one fixed delay.
  async function startSummaryGeneration() {
    if (summaryGenerating) return;
    const baseline = data?.competitor.aiSummaryUpdatedAt ?? null;
    try {
      await api.refreshCompetitorSummary(id);
    } catch (e) {
      toastApiError(e, { title: "Couldn't refresh the summary" });
      return;
    }
    const meta: SummaryGenMeta = { startedAt: Date.now(), baseline };
    summaryStartRef.current = meta;
    try {
      window.localStorage.setItem(summaryGenKey(id), JSON.stringify(meta));
    } catch {}
    setSummaryGenerating(true);
    toast.info("Generating AI summary…", { description: "It updates here when it's ready." });
  }

  // Resume (or clear) the in-progress marker on mount / when switching competitor.
  // Runs once per id: re-arm the poll if a generation was in flight and hasn't completed
  // or expired; otherwise drop a stale/finished marker.
  useEffect(() => {
    if (!data) return;
    if (summarySeededIdRef.current === id) return;
    summarySeededIdRef.current = id;
    summaryStartRef.current = null;
    let stored: SummaryGenMeta | null = null;
    try {
      const raw = window.localStorage.getItem(summaryGenKey(id));
      if (raw) stored = JSON.parse(raw) as SummaryGenMeta;
    } catch {}
    let resume = false;
    if (stored) {
      const updatedAt = data.competitor.aiSummaryUpdatedAt ?? null;
      const done = Boolean(updatedAt && updatedAt !== stored.baseline);
      const expired = Date.now() - stored.startedAt > POLL_TIMEOUT_MS;
      if (done || expired) {
        try {
          window.localStorage.removeItem(summaryGenKey(id));
        } catch {}
      } else {
        summaryStartRef.current = stored;
        resume = true;
      }
    }
    setSummaryGenerating(resume);
  }, [data, id]);

  // While generating, poll the detail until aiSummaryUpdatedAt advances past the baseline
  // (success) or POLL_TIMEOUT_MS elapses (give up — it may still finish server-side). The
  // effect lifecycle clears the interval on stop / id change / unmount.
  useEffect(() => {
    if (!summaryGenerating) return;
    const interval = setInterval(async () => {
      const meta = summaryStartRef.current;
      if (!meta) {
        setSummaryGenerating(false);
        return;
      }
      if (Date.now() - meta.startedAt > POLL_TIMEOUT_MS) {
        summaryStartRef.current = null;
        try {
          window.localStorage.removeItem(summaryGenKey(id));
        } catch {}
        setSummaryGenerating(false);
        toast.error("Summary is taking longer than usual", {
          description: "It may still finish in the background — check back in a moment.",
        });
        return;
      }
      const fresh = await refresh();
      const updatedAt = fresh?.competitor.aiSummaryUpdatedAt ?? null;
      if (updatedAt && updatedAt !== meta.baseline) {
        summaryStartRef.current = null;
        try {
          window.localStorage.removeItem(summaryGenKey(id));
        } catch {}
        setSummaryGenerating(false);
        toast.success("AI summary updated");
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [summaryGenerating, id]);

  // Auto-advance the summary card while the FIRST analysis is summarizing — i.e.
  // the homepage scrape finished but the AI summary hasn't landed yet. The scrape
  // poller above only runs while a scrape is in flight (scrapeStartedAt), so this
  // covers the post-scrape gap so the card flips to the real summary on its own,
  // no manual refresh. No toast — the stage label is the feedback. Skipped while
  // the user-triggered summaryGenerating poll already owns the refresh loop.
  useEffect(() => {
    if (summaryGenerating) return;
    if (analysis?.stage !== "summarizing") return;
    const interval = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryGenerating, analysis?.stage, id]);

  // Kebab → Re-detect pricing. Hands pricing back to auto-detection + re-scrapes.
  async function redetectPricingFromMenu() {
    try {
      const { rescraped } = await api.redetectCompetitorPricing(id);
      toast.success("Pricing handed back to auto-detection", {
        description: rescraped ? "Re-scraping the pricing page now…" : undefined,
      });
      await refresh();
    } catch (e) {
      toastApiError(e, { title: "Couldn't re-detect pricing" });
    }
  }

  // Kebab → Export signals as CSV (client-side Blob download).
  async function exportSignals() {
    try {
      const blob = await api.exportCompetitorSignals(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const name = (data?.competitor.name ?? "competitor")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      a.download = `${name || "competitor"}-signals.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toastApiError(e, { title: "Couldn't export signals" });
    }
  }

  // Scope the Ask dock to this competitor while its page is open.
  useSetAskContext(
    data ? { kind: "competitor", label: data.competitor.name, competitorId: id } : null,
  );

  if (error && !data) {
    return (
      <div className="mt-10">
        <ListError error={error} onRetry={refresh} />
      </div>
    );
  }
  if (!data) return <CompetitorDetailLoading />;

  const { competitor, monitors, recentChanges, recentSignals, techStack, overview, plan } = data;
  const detectedTargets = detectedTargetsOf(techStack);
  const lastRunMs = monitors
    .map((m) => (m.lastRunAt ? new Date(m.lastRunAt).getTime() : 0))
    .reduce((a, b) => Math.max(a, b), 0);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        <Header
          competitor={competitor}
          lastRunMs={lastRunMs}
          index={rosterIdx}
          total={roster?.length ?? 0}
          onPrev={prevId ? () => router.push(`/dashboard/competitors/${prevId}`) : undefined}
          onNext={nextId ? () => router.push(`/dashboard/competitors/${nextId}`) : undefined}
          onDelete={() => setShowDelete(true)}
          onEditSave={saveCompetitorDetails}
          onToggleMonitoring={toggleMonitoringPaused}
          onToggleMute={toggleAlertsMuted}
          onRecomputeOverlap={recomputeOverlap}
          onRefreshSummary={startSummaryGeneration}
          onRedetectPricing={redetectPricingFromMenu}
          onExport={exportSignals}
        />

        {/* Plan cap first: when both are true, upgrading is the blocking action —
            resuming alone would leave the scheduler skipping this competitor. */}
        {competitor.pausedByPlan ? (
          <PlanCapPausedBanner />
        ) : competitor.monitoringPaused ? (
          <MonitoringPausedBanner onResume={toggleMonitoringPaused} />
        ) : null}

        {/* Where the first analysis is — a prominent stepper for a freshly added
            competitor so the empty tabs below read as "in progress", not broken.
            Self-hides once ready/idle; needs_attention retries the homepage scrape. */}
        <AnalysisProgress
          analysis={analysis}
          onRetry={() => {
            const homepage = monitors.find((m) => m.sourceType === "homepage");
            if (homepage) requestRunMonitor(homepage.id);
            else startSummaryGeneration();
          }}
        />

        {/* What we cover on this competitor, framed by what IS tracked, plus a chip
            per configured source (status, freshness, run/pause/cadence). Everything
            heavier — URLs, enabling a source, custom pages — lives on /sources. */}
        <CompetitorCoverage
          competitorId={competitor.id}
          monitors={monitors}
          plan={plan}
          targets={detectedTargets}
          scrapingIds={scrapingIds}
          runningAll={runningAll}
          monitoringPaused={competitor.monitoringPaused || Boolean(competitor.pausedByPlan)}
          onRun={requestRunMonitor}
          onRunAll={runAllMonitors}
          onResume={resumeMonitor}
          onSetActive={setMonitorActive}
          onEdit={editMonitor}
          onLockedFrequency={(frequency) =>
            setPaywall({ code: "plan_locked_frequency", frequency, plan })
          }
        />

        <AiSummary
          competitor={competitor}
          analysis={analysis}
          generating={summaryGenerating}
          onGenerate={startSummaryGeneration}
        />

        <Tabs
          value={tab}
          onValueChange={(v) => {
            const key = v as TabKey;
            const lock = tabLock(key, plan);
            if (lock) {
              setPaywall(lock.reason);
              return;
            }
            selectTab(key);
          }}
        >
          <TabsList variant="line" className="w-full justify-start overflow-x-auto">
            {VISIBLE_TABS.map((t) => {
              const Icon = t.icon;
              const lock = tabLock(t.key, plan);
              const fresh = lock ? null : tabFreshness(t.key, monitors);
              const trigger = (
                <TabsTrigger
                  key={t.key}
                  value={t.key}
                  className={cn(lock && "text-muted-foreground hover:text-muted-foreground")}
                >
                  {lock ? <Lock size={13} /> : <Icon size={13} />} {t.label}
                  {fresh && (
                    <FreshnessDot
                      lastScrapedAt={fresh.lastScrapedAt}
                      status={fresh.status}
                      className="ml-1.5"
                    />
                  )}
                </TabsTrigger>
              );
              if (!lock) return trigger;
              return (
                <Tooltip key={t.key}>
                  <TooltipTrigger asChild>{trigger}</TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    Available on the {PLAN_LABELS[lock.minPlan]} plan
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </TabsList>

          {/* min-height floor so a sparse tab (e.g. tech stack) doesn't collapse the
              page after a dense one (activity) — switching tabs no longer jumps. */}
          <div className="mt-6 min-h-[280px]">
            <TabsContent value="overview" className={TAB_PANEL_CLASS}>
              <OverviewTab
                competitorId={competitor.id}
                overview={overview}
                monitors={monitors}
                scrapingIds={scrapingIds}
                analysis={analysis}
                pricingStatus={competitor.pricingStatus}
                pricingNote={competitor.pricingNote}
                onRun={requestRunMonitor}
                onOpenTab={selectTab}
                techStack={techStack}
              />
            </TabsContent>
            <TabsContent value="activity" className={TAB_PANEL_CLASS}>
              <ActivityTab
                competitorId={competitor.id}
                signals={recentSignals}
                changes={recentChanges}
                onRefresh={refresh}
                competitorUrl={competitor.url}
                lastRunMs={lastRunMs}
              />
            </TabsContent>
            <TabsContent value="pricing" className={TAB_PANEL_CLASS}>
              <PricingTab
                competitor={competitor}
                competitorId={id}
                monitors={monitors}
                scrapingIds={scrapingIds}
                onRun={requestRunMonitor}
                onEnable={enableMonitor}
                onRefresh={refresh}              />
            </TabsContent>
            <TabsContent value="hiring" className={TAB_PANEL_CLASS}>
              <HiringTab
                competitorId={id}
                monitors={monitors}
                scrapingIds={scrapingIds}
                onRun={requestRunMonitor}
                onEnable={enableMonitor}              />
            </TabsContent>
            <TabsContent value="reviews" className={TAB_PANEL_CLASS}>
              <ReviewsTab
                competitorId={id}
                monitors={monitors}
                scrapingIds={scrapingIds}
                onRun={requestRunMonitor}
                onEnable={enableMonitor}
                onEdit={editMonitor}
                onSwitch={switchReviewSource}                plan={plan}
                onLockedSource={(source) =>
                  setPaywall({ code: "plan_locked_source", source, plan })
                }
                onLockedFrequency={(freq) =>
                  setPaywall({ code: "plan_locked_frequency", frequency: freq, plan })
                }
              />
            </TabsContent>
            <TabsContent value="product" className={TAB_PANEL_CLASS}>
              <ProductTab
                changes={recentChanges}
                signals={recentSignals}
                monitors={monitors}
                scrapingIds={scrapingIds}
                onRun={requestRunMonitor}
                onRefresh={refresh}
                competitorUrl={competitor.url}
              />
            </TabsContent>
          </div>
        </Tabs>

        <Dialog open={showDelete} onOpenChange={setShowDelete}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete competitor?</DialogTitle>
              <DialogDescription>
                {competitor.name} and all its monitors, snapshots, changes,
                signals and battle cards will be soft-deleted. This cannot be
                undone from the UI.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowDelete(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting && <Loader2 size={13} className="animate-spin" />}
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <PaywallDialog reason={paywall} onClose={() => setPaywall(null)} />
      </div>
    </TooltipProvider>
  );
}

function Header({
  competitor,
  lastRunMs,
  index,
  total,
  onPrev,
  onNext,
  onDelete,
  onEditSave,
  onToggleMonitoring,
  onToggleMute,
  onRecomputeOverlap,
  onRefreshSummary,
  onRedetectPricing,
  onExport,
}: {
  competitor: Competitor;
  lastRunMs: number;
  index: number;
  total: number;
  onPrev?: () => void;
  onNext?: () => void;
  onDelete: () => void;
  onEditSave: (patch: {
    name?: string;
    url?: string;
    category?: string | null;
    description?: string | null;
    color?: string | null;
  }) => Promise<void>;
  onToggleMonitoring: () => void;
  onToggleMute: () => void;
  onRecomputeOverlap: () => void | Promise<void>;
  onRefreshSummary: () => void;
  onRedetectPricing: () => void;
  onExport: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied to clipboard");
    } catch {
      toast.error("Couldn't copy the link");
    }
  }

  return (
    <>
    <div className="flex items-start md:items-center justify-between gap-4 flex-wrap">
      <div className="flex items-start gap-3 min-w-0">
        <Link
          href="/dashboard/competitors"
          aria-label="Back to competitors"
          className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft size={16} />
        </Link>
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap mb-1">
            <h1
              className="font-bold text-title-lg md:text-stat tracking-tight leading-[1.05] m-0"
              style={competitorNameColor(competitor.color)}
            >
              {competitor.name}
            </h1>
            {competitor.category && (
              <Badge variant="outline" className="text-meta uppercase tracking-wide font-medium">
                {competitor.category}
              </Badge>
            )}
            {competitor.pausedByPlan ? (
              <Badge
                variant="outline"
                className="gap-1 text-meta uppercase tracking-wide font-medium border-high/40 text-medium"
              >
                <PauseCircle size={11} /> Paused · plan limit
              </Badge>
            ) : competitor.monitoringPaused ? (
              <Badge
                variant="outline"
                className="gap-1 text-meta uppercase tracking-wide font-medium text-muted-foreground"
              >
                <Pause size={11} /> Paused
              </Badge>
            ) : null}
            {competitor.alertsMuted && (
              <Badge
                variant="outline"
                className="gap-1 text-meta uppercase tracking-wide font-medium text-muted-foreground"
              >
                <BellOff size={11} /> Muted
              </Badge>
            )}
            {competitor.overlapScore != null && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" aria-label="About overlap" className="cursor-help">
                    <Badge variant="outline" className="gap-1.5 py-1 text-meta tracking-widest">
                      <span className="h-2 w-16 overflow-hidden rounded border border-border bg-background">
                        <span
                          className="block h-full rounded bg-primary"
                          style={{
                            width: `${Math.max(0, Math.min(100, competitor.overlapScore))}%`,
                          }}
                        />
                      </span>
                      <span className="tabular-nums font-bold text-foreground">
                        {Math.round(competitor.overlapScore)}
                      </span>
                      <span className="uppercase text-muted-foreground">overlap</span>
                    </Badge>
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="max-w-[240px] text-xs leading-relaxed text-pretty normal-case"
                >
                  How similar this competitor is to your product (0–100). Computed at
                  discovery via Exa + AI scoring against your product profile.
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <a
            href={competitor.url}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 transition-colors"
          >
            {competitor.url}
            <ExternalLink size={12} />
          </a>
          {lastRunMs > 0 && (
            <div className="text-xs text-muted-foreground mt-1">
              last activity {formatDistanceToNow(new Date(lastRunMs), { addSuffix: true })}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {/* Battle cards left the tab strip: they're an artefact you go and make,
            not a lens you flip to. The daily generation cap still applies where it
            always did — at generate time, inside the card view. */}
        <Button asChild size="sm" variant="outline" className="h-9">
          <Link href={`/dashboard/competitors/${competitor.id}/battle-card`}>
            <Swords size={14} /> Battle card
          </Link>
        </Button>
        {total > 1 && index >= 0 && (
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 w-9 p-0"
                  disabled={!onPrev}
                  onClick={onPrev}
                  aria-label="Previous competitor"
                >
                  <ChevronLeft size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="flex items-center gap-1.5">
                Previous
                <kbd className="rounded-sm border border-border/60 px-1 font-mono text-meta">
                  [
                </kbd>
              </TooltipContent>
            </Tooltip>
            <span className="select-none px-0.5 text-dense tabular-nums text-muted-foreground">
              {index + 1}/{total}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 w-9 p-0"
                  disabled={!onNext}
                  onClick={onNext}
                  aria-label="Next competitor"
                >
                  <ChevronRight size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="flex items-center gap-1.5">
                Next
                <kbd className="rounded-sm border border-border/60 px-1 font-mono text-meta">
                  ]
                </kbd>
              </TooltipContent>
            </Tooltip>
          </div>
        )}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-9 w-9 p-0"
              aria-label="More actions"
            >
              <MoreHorizontal size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {competitor.url && (
              <DropdownMenuItem
                onClick={() => window.open(competitor.url, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink size={13} /> Open website
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={copyLink}>
              <Link2 size={13} /> Copy link
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <Pencil size={13} /> Edit details
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2">
                <Palette size={13} /> Color
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="p-2.5">
                <CompetitorColorPicker
                  value={competitor.color}
                  onChange={(v) => {
                    void onEditSave({ color: v });
                    setMenuOpen(false);
                  }}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onClick={() => setAssignOpen(true)}>
              <Boxes size={13} /> Assign to products
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onRefreshSummary}>
              <Sparkles size={13} /> Refresh AI summary
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRedetectPricing}>
              <RefreshCw size={13} /> Re-detect pricing
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onRecomputeOverlap()}>
              <Crosshair size={13} /> Recompute overlap
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onExport}>
              <Download size={13} /> Export signals (CSV)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onToggleMonitoring}>
              {competitor.monitoringPaused ? (
                <>
                  <Play size={13} /> Resume monitoring
                </>
              ) : (
                <>
                  <Pause size={13} /> Pause monitoring
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleMute}>
              {competitor.alertsMuted ? (
                <>
                  <Bell size={13} /> Unmute alerts
                </>
              ) : (
                <>
                  <BellOff size={13} /> Mute alerts
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="text-critical focus:text-critical">
              <Trash2 size={13} /> Delete competitor
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
    <EditDetailsDialog
      open={editOpen}
      onOpenChange={setEditOpen}
      competitor={competitor}
      onSave={onEditSave}
    />
    <AssignProductsDialog open={assignOpen} onOpenChange={setAssignOpen} competitor={competitor} />
    </>
  );
}

function EditDetailsDialog({
  open,
  onOpenChange,
  competitor,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  competitor: Competitor;
  onSave: (patch: {
    name?: string;
    url?: string;
    category?: string | null;
    description?: string | null;
    color?: string | null;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(competitor.name);
  const [url, setUrl] = useState(competitor.url ?? "");
  const [category, setCategory] = useState(competitor.category ?? "");
  const [description, setDescription] = useState(competitor.description ?? "");
  const [color, setColor] = useState<string | null>(competitor.color);
  const [saving, setSaving] = useState(false);

  // Re-seed the form from the live competitor each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setName(competitor.name);
    setUrl(competitor.url ?? "");
    setCategory(competitor.category ?? "");
    setDescription(competitor.description ?? "");
    setColor(competitor.color);
  }, [open, competitor]);

  async function submit() {
    const patch: {
      name?: string;
      url?: string;
      category?: string | null;
      description?: string | null;
      color?: string | null;
    } = {};
    const trimmedName = name.trim();
    if (trimmedName && trimmedName !== competitor.name) patch.name = trimmedName;
    const trimmedUrl = url.trim();
    if (trimmedUrl && trimmedUrl !== (competitor.url ?? "")) patch.url = trimmedUrl;
    const trimmedCat = category.trim();
    if (trimmedCat !== (competitor.category ?? "")) patch.category = trimmedCat || null;
    const trimmedDesc = description.trim();
    if (trimmedDesc !== (competitor.description ?? "")) patch.description = trimmedDesc || null;
    if (color !== competitor.color) patch.color = color;

    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(patch);
      onOpenChange(false);
    } catch (e) {
      toastApiError(e, { title: "Couldn't update the competitor" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit competitor</DialogTitle>
          <DialogDescription>
            Correct the name, website, category, or description. Scrapes won't overwrite these.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cmp-name">Name</Label>
            <Input id="cmp-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cmp-url">Website URL</Label>
            <Input
              id="cmp-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cmp-category">Category</Label>
            <Input
              id="cmp-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. CRM, Analytics…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cmp-description">Description</Label>
            <Textarea
              id="cmp-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Color</Label>
            <CompetitorColorPicker value={color} onChange={setColor} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !name.trim()}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignProductsDialog({
  open,
  onOpenChange,
  competitor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  competitor: Competitor;
}) {
  const [products, setProducts] = useState<
    Array<{ id: string; name: string; isPrimary: boolean; status: string }> | null
  >(null);
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setProducts(null);
    api
      .getCompetitorProducts(competitor.id)
      .then((res) => {
        if (cancelled) return;
        setProducts(res.products);
        setLinked(new Set(res.links.map((l) => l.productId)));
      })
      .catch((e) => {
        if (!cancelled) toastApiError(e, { title: "Couldn't load products" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, competitor.id]);

  async function toggle(productId: string, next: boolean) {
    setPending((p) => new Set(p).add(productId));
    setLinked((s) => {
      const n = new Set(s);
      if (next) n.add(productId);
      else n.delete(productId);
      return n;
    });
    try {
      if (next) await api.attachCompetitorToProduct(productId, competitor.id);
      else await api.detachCompetitorFromProduct(productId, competitor.id);
    } catch (e) {
      // Revert the optimistic flip on failure.
      setLinked((s) => {
        const n = new Set(s);
        if (next) n.delete(productId);
        else n.add(productId);
        return n;
      });
      toastApiError(e, { title: "Couldn't update the assignment" });
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(productId);
        return n;
      });
    }
  }

  const visible = products?.filter((p) => p.status !== "archived") ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign to products</DialogTitle>
          <DialogDescription>
            Pick which of your products track {competitor.name}. Its signals show in each selected
            product&apos;s feed.
          </DialogDescription>
        </DialogHeader>
        {loading || !products ? (
          <div className="flex justify-center py-6">
            <Loader2 size={16} className="animate-spin text-muted-foreground" />
          </div>
        ) : visible.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">You don&apos;t have any products yet.</p>
        ) : (
          <div className="space-y-1">
            {visible.map((p) => {
              const checked = linked.has(p.id);
              const isPending = pending.has(p.id);
              return (
                <label
                  key={p.id}
                  className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent cursor-pointer"
                >
                  <Checkbox
                    checked={checked}
                    disabled={isPending}
                    onCheckedChange={(v) => toggle(p.id, v === true)}
                  />
                  <span className="flex-1 text-sm font-medium">{p.name}</span>
                  {p.isPrimary && (
                    <span className="text-meta uppercase tracking-wide text-muted-foreground">
                      Primary
                    </span>
                  )}
                  {isPending && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
                </label>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// A paused competitor is a deliberate, easily-missed state — the header carries only
// a compact badge. This full-width banner makes it unmistakable and puts Resume one
// click away, so the empty / stale tabs below read as "paused", not broken.
function MonitoringPausedBanner({ onResume }: { onResume: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
      <Pause className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">Monitoring is paused</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          No sources are being scraped — the data below won&apos;t update until you
          resume.
        </p>
      </div>
      <Button size="sm" onClick={onResume} className="shrink-0">
        <Play size={13} /> Resume monitoring
      </Button>
    </div>
  );
}

// Same blind spot as above, but the user can't resume this one: the org is over its
// plan's competitor cap, so the scheduler freezes the newest competitors until it
// upgrades. Without this the tabs read as broken rather than capped.
function PlanCapPausedBanner() {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-high/40 bg-high/[0.06] px-4 py-3">
      <PauseCircle className="h-4 w-4 shrink-0 text-medium" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          Monitoring is paused — over your plan limit
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          This competitor is above your plan&apos;s competitor cap, so none of its
          sources are being scraped. Upgrade to resume.
        </p>
      </div>
      <Button size="sm" asChild className="shrink-0">
        <Link href="/dashboard/settings/billing">Upgrade plan</Link>
      </Button>
    </div>
  );
}

function AiSummary({
  competitor,
  analysis,
  generating,
  onGenerate,
}: {
  competitor: Competitor;
  analysis: AnalysisStatus | null;
  generating: boolean;
  onGenerate: () => void;
}) {
  // Was a summary already on screen last render? Drives the reveal: the very first
  // summary lands via a branch swap (the "Generating…" card is replaced), so it
  // should fade in — but an existing summary already painted on page load should
  // sit still (only re-animating when its content actually changes, via `token`).
  const hadSummary = useRef(Boolean(competitor.aiSummary));
  useEffect(() => {
    hadSummary.current = Boolean(competitor.aiSummary);
  }, [competitor.aiSummary]);

  if (!competitor.aiSummary) {
    // A user-triggered generation is in flight — keep the explicit "Generating…" UX.
    if (generating) {
      return (
        <Card className="px-4 py-3 border-dashed flex items-start gap-2 justify-between">
          <div className="flex items-start gap-2 text-muted-foreground text-sm">
            <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin" />
            <span>Generating AI summary…</span>
          </div>
          <Button size="sm" variant="secondary" disabled className="h-7 text-xs">
            <Loader2 size={11} className="animate-spin" />
            Generating…
          </Button>
        </Card>
      );
    }
    // The first analysis is still running on its own. Only surface a notice here
    // once the AI is actually writing the summary — it lands without a click (the
    // detail view polls while summarizing). While the site is still being pulled
    // down (queued → scraping) this card stays empty: the AnalysisProgress stepper
    // above already shows that stage, so a "Scraping the site…" line here is noise.
    if (analysis?.stage === "summarizing") {
      return (
        <Card className="px-4 py-3 border-dashed">
          <AnalysisNotice analysis={analysis} />
        </Card>
      );
    }
    if (analysis?.pending) return null;
    // Nothing in flight — the summary stalled (needs_attention) or was never
    // attempted (idle, e.g. an idea/document self). Offer a manual generate.
    return (
      <Card className="px-4 py-3 border-dashed flex items-start gap-2 justify-between">
        {analysis?.stage === "needs_attention" ? (
          <AnalysisNotice analysis={analysis} className="mt-0.5" />
        ) : (
          <div className="flex items-start gap-2 text-muted-foreground text-sm">
            <Sparkles size={13} className="mt-0.5 shrink-0" />
            <span>AI summary not generated yet.</span>
          </div>
        )}
        <Button size="sm" variant="secondary" onClick={onGenerate} className="h-7 text-xs">
          <Sparkles size={11} />
          Generate now
        </Button>
      </Card>
    );
  }
  return (
    <Reveal token={competitor.aiSummaryUpdatedAt} initial={!hadSummary.current}>
    <Card className="px-5 py-4">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <h3 className="flex items-center gap-2 text-content font-semibold tracking-tight leading-tight">
          <Sparkles size={14} className="text-muted-foreground" /> Summary
        </h3>
        <Button
          size="sm"
          variant="ghost"
          onClick={onGenerate}
          disabled={generating}
          className="h-7 text-xs text-muted-foreground"
        >
          {generating ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {generating ? "Refreshing" : "Refresh"}
        </Button>
      </div>
      <p className="text-content leading-relaxed text-foreground/90">{competitor.aiSummary}</p>
      {competitor.aiSummaryUpdatedAt && (
        <p className="text-xs text-muted-foreground mt-2">
          updated {formatDistanceToNow(new Date(competitor.aiSummaryUpdatedAt), { addSuffix: true })}
        </p>
      )}
    </Card>
    </Reveal>
  );
}

