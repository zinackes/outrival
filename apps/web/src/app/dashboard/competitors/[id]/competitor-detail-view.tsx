"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { toast } from "@/lib/toast";
import {
  ArrowLeftIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  PlayIcon,
  ArrowSquareOutIcon,
  PulseIcon,
  CurrencyDollarIcon,
  BriefcaseIcon,
  StarIcon,
  FileTextIcon,
  NewspaperIcon,
  SparkleIcon,
  SwordIcon,
  SpinnerIcon,
  TrashIcon,
  ArrowsClockwiseIcon,
  DotsThreeIcon,
  PlusIcon,
  LockIcon,
  GridFourIcon,
  CaretLeftIcon,
  CaretRightIcon,
  PencilIcon,
  PauseIcon,
  PauseCircleIcon,
  BellIcon,
  BellSlashIcon,
  DownloadSimpleIcon,
  LinkIcon,
  CardsThreeIcon,
  CrosshairIcon,
  PaletteIcon,
  ShieldSlashIcon,
} from "@/components/icons";
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
  COMPETITOR_NAME_MAX_LENGTH,
  blockedReach,
  type BlockedReach,
  type Plan,
  type AnalysisStatus,
  type DetectedTargets,
  type SourceType,
} from "@outrival/shared";
import { FreshnessDot } from "@/components/outrival/freshness-dot";
import { AnalysisProgress } from "@/components/outrival/analysis-status";
import { CompetitorColorPicker } from "@/components/dashboard/competitor-color-picker";
import { competitorNameColor } from "@/lib/competitor-color";
import { StatusDot } from "@/components/outrival/data-marks";
import { shortAge } from "@/lib/format-date";
import { ListError } from "@/components/outrival/list-error";
import { toastApiError, toastRescanLimit } from "@/lib/error-helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
  type CompetitorStory,
  type TechStackData,
  type CompetitorOverview,
} from "@/lib/api";
import {
  battleCardStalenessQuery,
  competitorDetailQuery,
  competitorsQuery,
} from "@/lib/queries";
import { useSetAskContext } from "@/components/dashboard/ask-context";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import { useCompetitorScopeGuard } from "@/hooks/use-competitor-scope-guard";
import {
  POLL_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  isServerScraping,
  MonitorEmptyState,
  Empty,
  TabLoading,
  SourceSummary,
} from "./competitor-detail/shared";
import { competitorCoverage } from "./competitor-detail/helpers";
import { PricingTab } from "./competitor-detail/pricing-tab";
import { HiringTab } from "./competitor-detail/hiring-tab";
import { ReviewsTab, readShopifyApp } from "./competitor-detail/reviews-tab";
import { OverviewTab } from "./competitor-detail/overview-tab";
import { ActivityTab } from "./competitor-detail/activity-tab";
import { PositioningTab } from "./competitor-detail/positioning-tab";
import { ContentTab } from "./competitor-detail/content-tab";
import { AsOf } from "@/components/outrival/as-of";
import { readMobileApps } from "./competitor-detail/mobile-apps";
import { PRODUCT_SOURCES } from "./competitor-detail/product-lenses";
import { useMonitorActions } from "./competitor-detail/use-monitor-actions";
import { resolveTabParam } from "./competitor-detail/tab-migration";
import { CompetitorRail } from "./competitor-detail/competitor-rail";
import { WhatChanged } from "./competitor-detail/what-changed";
import { CompAvatar } from "@/components/dashboard/comp-avatar";
import { useLastVisit } from "@/hooks/use-last-visit";
import type { TabKey } from "./competitor-detail/types";

// Six reading tabs, grouped by the question they answer. Configuration does not
// live here any more — it moved to the Sources sub-page, so a tab is only ever a
// lens on data. Tech stack became an Overview card, battle cards their own page.
const TABS: Array<{ key: TabKey; label: string; icon: typeof PulseIcon }> = [
  { key: "overview", label: "Overview", icon: GridFourIcon },
  { key: "activity", label: "Activity", icon: PulseIcon },
  { key: "pricing", label: "Pricing", icon: CurrencyDollarIcon },
  { key: "hiring", label: "Hiring", icon: BriefcaseIcon },
  { key: "reviews", label: "Reviews", icon: StarIcon },
  // Content sits next to Positioning: both answer "what are they saying".
  { key: "content", label: "Content", icon: NewspaperIcon },
  { key: "product", label: "Positioning", icon: FileTextIcon },
];

const VISIBLE_TABS = TABS;

// Per-tab freshness dot (patch-14): tabs backed by monitored sources show how
// recent that section's data is. Activity (signal feed) has no single source → no dot.
const TAB_SOURCES: Partial<Record<TabKey, string[]>> = {
  pricing: ["pricing"],
  hiring: ["jobs"],
  reviews: ["appstore_reviews", "shopify_reviews", "trustpilot_public"],
  content: ["blog", "changelog", "roadmap", "docs"],
  product: [...PRODUCT_SOURCES],
};

function tabFreshness(key: TabKey, monitors: Monitor[]) {
  const sources = TAB_SOURCES[key];
  if (!sources) return null;
  return aggregateFreshness(monitors.filter((m) => sources.includes(m.sourceType)));
}

// The four tabs whose content IS a capture of a page, and so has a date (Véracité
// Intelligence v2 P4). Reviews is left out on purpose: its sources are third-party
// listings on their own cadences, and one "as of" over three of them would date
// something no single read produced. Activity and Overview aggregate across every
// source, which is the same objection.
const DATED_TABS = new Set<TabKey>(["pricing", "hiring", "content", "product"]);

/** The monitors behind a dated tab, and the soonest read any of them is due. */
function tabCapture(key: TabKey, monitors: Monitor[]) {
  const sources = DATED_TABS.has(key) ? TAB_SOURCES[key] : undefined;
  if (!sources) return null;
  const backing = monitors.filter((m) => sources.includes(m.sourceType));
  if (backing.length === 0) return null;
  const upcoming = backing
    .map((m) => (m.nextRunAt ? new Date(m.nextRunAt).getTime() : null))
    .filter((t): t is number => t !== null && t > Date.now());
  return {
    monitors: backing,
    nextRunAt: upcoming.length === 0 ? null : new Date(Math.min(...upcoming)).toISOString(),
  };
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
      // The gate is appstore_reviews, but the paywall says "Reviews": the tab also
      // covers Shopify and Trustpilot, so naming one store would misdescribe it.
      return {
        reason: { code: "plan_locked_source", source: "reviews", plan },
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
  /** What we have accumulated on this competitor, or null before any change (OUT-172). */
  memory: CompetitorStory | null;
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

/** Hostname without the www, for the header's one-line meta row. */
function hostOf(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
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
              scrapePickedUpAt: homepage.scrapePickedUpAt,
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
  // Switching the scope to a product that doesn't track this competitor leaves the
  // page for that product's roster (same scoped query as the pager below).
  useCompetitorScopeGuard(id, data?.competitor.name);
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
      // The API refuses to score on an empty page rather than overwrite a good
      // score with one guessed from a bare domain.
      if ((e as { code?: string })?.code === "no_evidence") {
        toast.error("Nothing to score yet", {
          id: toastId,
          description: "Wait for the first scan of this competitor, then try again.",
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
          description: "It may still finish in the background. Check back in a moment.",
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

  // What landed since the last time this competitor was opened. Read once on
  // mount so the highlight is stable for the session; shared with the Activity
  // tab, which flags the same signals in its own list.
  const lastVisit = useLastVisit(`competitor:${id}`);

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

  const { competitor, monitors, recentChanges, recentSignals, memory, techStack, overview, plan } =
    data;
  const detectedTargets = detectedTargetsOf(techStack);
  // Store listings the worker detected off captures we already take. Informational:
  // it never alerts, it just spares the user a trip to the App Store search box.
  const mobileApps = readMobileApps(competitor.metadata);
  const shopifyApp = readShopifyApp(competitor.metadata);
  const lastRunMs = monitors
    .map((m) => (m.lastRunAt ? new Date(m.lastRunAt).getTime() : 0))
    .reduce((a, b) => Math.max(a, b), 0);
  // The same buckets the rail renders, so the title and the Sources card can never
  // disagree about how much of this competitor refuses us.
  const pageCoverage = competitorCoverage(monitors, plan, detectedTargets);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        <Header
          competitor={competitor}
          lastRunMs={lastRunMs}
          sourceCount={monitors.length}
          blockedReachVerdict={blockedReach(pageCoverage)}
          blockedSources={pageCoverage.blocked}
          productId={productScope}
          index={rosterIdx}
          total={roster?.length ?? 0}
          onPrev={prevId ? () => router.push(`/dashboard/competitors/${prevId}`) : undefined}
          onNext={nextId ? () => router.push(`/dashboard/competitors/${nextId}`) : undefined}
          onOpenActivity={() => selectTab("activity")}
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

        {/* The hook: what landed since the last visit, with the severity scale.
            Sits above the tabs because on a monitoring product the first thing on
            screen should be what they DID, not what they are. */}
        <WhatChanged
          signals={recentSignals}
          lastVisit={lastVisit}
          onOpenActivity={selectTab}
        />

        {/* Two columns from lg: the reading column carries the tabs, the rail
            carries page context (sources, summary) and stays pinned. The rail is
            OUTSIDE the tab panels on purpose, so it is identical on all six tabs,
            and it is deliberately the shorter column: when it outgrows the reading
            column its overhang reads as a hole under the content. */}
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
          {/* The chip dates the tab's content, so it rides on the tab bar rather
              than inside any one panel: four tabs, one component, one mount. */}
          <div className="flex items-center gap-3">
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
                  {lock ? <LockIcon size={16} /> : <Icon size={16} />} {t.label}
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
          {(() => {
            const capture = tabCapture(tab, monitors);
            if (!capture) return null;
            return <AsOf monitors={capture.monitors} nextRunAt={capture.nextRunAt} />;
          })()}
          </div>

          {/* The strip spans the page; the two columns start below it, so the rail's
              first card is level with the tab content, not with the strip. The
              min-height floor keeps a sparse tab from collapsing the page after a
              dense one, so switching tabs never jumps. */}
          <div className="mt-3 grid min-h-[280px] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-w-0">
            <TabsContent value="overview" className={TAB_PANEL_CLASS}>
              <OverviewTab
                competitorId={competitor.id}
                competitorName={competitor.name}
                overview={overview}
                signals={recentSignals}
                memory={memory}
                monitors={monitors}
                scrapingIds={scrapingIds}
                analysis={analysis}
                pricingStatus={competitor.pricingStatus}
                pricingNote={competitor.pricingNote}
                onRun={requestRunMonitor}
                onOpenTab={selectTab}
                techStack={techStack}
                mobileApps={mobileApps}
              />
            </TabsContent>
            <TabsContent value="activity" className={TAB_PANEL_CLASS}>
              <ActivityTab
                competitorId={competitor.id}
                signals={recentSignals}
                changes={recentChanges}
                competitorUrl={competitor.url}
                lastRunMs={lastRunMs}
                lastVisit={lastVisit}
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
                signals={recentSignals}
                monitors={monitors}
                scrapingIds={scrapingIds}
                onRun={requestRunMonitor}
                onEnable={enableMonitor}              />
            </TabsContent>
            <TabsContent value="reviews" className={TAB_PANEL_CLASS}>
              <ReviewsTab
                competitorId={id}
                signals={recentSignals}
                monitors={monitors}
                scrapingIds={scrapingIds}
                onRun={requestRunMonitor}
                onEnable={enableMonitor}
                plan={plan}
                onLockedSource={(source) =>
                  setPaywall({ code: "plan_locked_source", source, plan })
                }
                detectedAppStoreUrl={mobileApps?.ios?.url ?? null}
                detectedShopifyUrl={shopifyApp?.url ?? null}
              />
            </TabsContent>
            <TabsContent value="content" className={TAB_PANEL_CLASS}>
              <ContentTab
                competitorId={id}
                signals={recentSignals}
                monitors={monitors}
                scrapingIds={scrapingIds}
                onRun={requestRunMonitor}
                onRunAll={runAllMonitors}
                onEnable={enableMonitor}
                plan={plan}
                onLockedSource={(source) =>
                  setPaywall({ code: "plan_locked_source", source, plan })
                }
              />
            </TabsContent>
            <TabsContent value="product" className={TAB_PANEL_CLASS}>
              <PositioningTab
                competitorId={id}
                competitorName={competitor.name}
                competitorUrl={competitor.url}
                category={competitor.category}
                changes={recentChanges}
                signals={recentSignals}
                monitors={monitors}
                scrapingIds={scrapingIds}
                onRun={requestRunMonitor}
                mobileApps={mobileApps}
                overview={overview}
              />
            </TabsContent>
            </div>

          <CompetitorRail
            competitor={competitor}
            monitors={monitors}
            plan={plan}
            targets={detectedTargets}
            scrapingIds={scrapingIds}
            runningAll={runningAll}
            monitoringPaused={competitor.monitoringPaused || Boolean(competitor.pausedByPlan)}
            summaryGenerating={summaryGenerating}
            onRun={requestRunMonitor}
            onRunAll={runAllMonitors}
            onResume={resumeMonitor}
            onSetActive={setMonitorActive}
            onEdit={editMonitor}
            onLockedFrequency={(frequency) =>
              setPaywall({ code: "plan_locked_frequency", frequency, plan })
            }
            onGenerateSummary={startSummaryGeneration}
          />
          </div>
        </Tabs>

        <Dialog open={showDelete} onOpenChange={setShowDelete}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete competitor?</DialogTitle>
              <DialogDescription>
                {competitor.name} and all its monitors, snapshots, changes,
                signals and battle cards will be soft-deleted. If it came from
                discovery, that entry moves back to Dismissed. This cannot be
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
                {deleting && <SpinnerIcon size={16} className="animate-spin" />}
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
  sourceCount,
  blockedReachVerdict,
  blockedSources,
  productId,
  index,
  total,
  onPrev,
  onNext,
  onOpenActivity,
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
  sourceCount: number;
  /** How far this competitor's refusals reach, and which sources they are. */
  blockedReachVerdict: BlockedReach;
  blockedSources: SourceType[];
  /** Active product scope, so the battle-card state matches the card you'd open. */
  productId?: string;
  index: number;
  total: number;
  onPrev?: () => void;
  onNext?: () => void;
  onOpenActivity: () => void;
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

  const hasFacts = competitor.overlapScore != null || sourceCount > 0 || lastRunMs > 0;

  return (
    <>
    <div className="space-y-3">
    {/* Identity, the way back and the actions on ONE line. Back, previous, 8/16 and
        next used to queue in front of the name, which started the h1 186px off the
        leading edge — and nothing below the header aligned to that edge, so the page
        had two of them. Stepping through the roster acts on the LIST, not on this
        competitor, so it travels with the other actions on the right; the only thing
        left between the page edge and the name is the competitor's own mark. */}
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href="/dashboard/competitors"
            aria-label="Back to competitors"
            className="-ml-2 inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeftIcon size={16} />
          </Link>
        </TooltipTrigger>
        <TooltipContent>All competitors</TooltipContent>
      </Tooltip>

      {/* The competitor's own mark. It shipped with CompAvatar and the per-competitor
          colour, and the page it identifies was the one surface never using either. */}
      <CompAvatar name={competitor.name} url={competitor.url} size={36} />

      <h1
        className="m-0 font-bold text-title tracking-tight leading-[1.1]"
        style={competitorNameColor(competitor.color)}
      >
        {competitor.name}
      </h1>

      {/* A freeform industry label is an attribute, not a status. Bare on the h1
          baseline it read as a broken tagline; a chip says "attribute" by its shape.
          The width cap stops a long one from eating the row, hence the title. */}
      {competitor.category && (
        <Badge
          variant="outline"
          title={competitor.category}
          className="max-w-[26ch] truncate font-normal text-muted-foreground"
        >
          {competitor.category}
        </Badge>
      )}

      {competitor.url && (
        <a
          href={competitor.url}
          target="_blank"
          rel="noreferrer"
          title={competitor.url}
          className="inline-flex shrink-0 items-center gap-1.5 text-dense text-muted-foreground transition-colors hover:text-foreground"
        >
          {hostOf(competitor.url)}
          <ArrowSquareOutIcon size={14} />
        </a>
      )}

      {competitor.pausedByPlan ? (
        <StatusDot tone="warn">
          <span className="inline-flex items-center gap-1">
            <PauseCircleIcon size={14} /> Paused, plan limit
          </span>
        </StatusDot>
      ) : competitor.monitoringPaused ? (
        <StatusDot>
          <span className="inline-flex items-center gap-1">
            <PauseIcon size={14} /> Paused
          </span>
        </StatusDot>
      ) : null}
      {competitor.alertsMuted && (
        <StatusDot>
          <span className="inline-flex items-center gap-1">
            <BellSlashIcon size={14} /> Muted
          </span>
        </StatusDot>
      )}

      {/* Only a WIDESPREAD refusal is hoisted to the page title: a blocked blog is a
          footnote on its own row, but a blocked homepage changes what this whole page
          can claim to know. Purely informative, like the two states above it, and it
          takes nothing away — every source keeps its Run button. */}
      {blockedReachVerdict === "widespread" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <StatusDot>
                <span className="inline-flex items-center gap-1">
                  <ShieldSlashIcon size={14} /> Blocks us
                </span>
              </StatusDot>
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            This site refuses automated collection on{" "}
            {blockedSources.length === 1
              ? `its ${sourceShortLabel(blockedSources[0]!).toLowerCase()}`
              : `${blockedSources.length} of its sources`}
            , and we don&apos;t bypass a refusal. Everything else we can reach is still
            collected.
          </TooltipContent>
        </Tooltip>
      )}

      <div className="ml-auto flex items-center gap-2 shrink-0">
        {total > 1 && index >= 0 && (
          <>
            <div className="flex items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-muted-foreground"
                    disabled={!onPrev}
                    onClick={onPrev}
                    aria-label="Previous competitor"
                  >
                    <CaretLeftIcon size={16} />
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
                    variant="ghost"
                    className="h-8 w-8 p-0 text-muted-foreground"
                    disabled={!onNext}
                    onClick={onNext}
                    aria-label="Next competitor"
                  >
                    <CaretRightIcon size={16} />
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
            <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
          </>
        )}
        {/* Battle cards left the tab strip: they're an artefact you go and make,
            not a lens you flip to. The daily generation cap still applies where it
            always did — at generate time, inside the card view. */}
        <BattleCardButton competitorId={competitor.id} productId={productId} />
        <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-9 w-9 p-0"
              aria-label="More actions"
            >
              <DotsThreeIcon size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {competitor.url && (
              <DropdownMenuItem
                onClick={() => window.open(competitor.url, "_blank", "noopener,noreferrer")}
              >
                <ArrowSquareOutIcon size={16} /> Open website
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={copyLink}>
              <LinkIcon size={16} /> Copy link
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <PencilIcon size={16} /> Edit details
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2">
                <PaletteIcon size={16} /> Color
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
              <CardsThreeIcon size={16} /> Move to product
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onRefreshSummary}>
              <SparkleIcon size={16} /> Refresh AI summary
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRedetectPricing}>
              <ArrowsClockwiseIcon size={16} /> Re-detect pricing
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onRecomputeOverlap()}>
              <CrosshairIcon size={16} /> Recompute overlap
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onExport}>
              <DownloadSimpleIcon size={16} /> Export signals (CSV)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onToggleMonitoring}>
              {competitor.monitoringPaused ? (
                <>
                  <PlayIcon size={16} /> Resume monitoring
                </>
              ) : (
                <>
                  <PauseIcon size={16} /> Pause monitoring
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleMute}>
              {competitor.alertsMuted ? (
                <>
                  <BellIcon size={16} /> Unmute alerts
                </>
              ) : (
                <>
                  <BellSlashIcon size={16} /> Mute alerts
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="text-critical focus:text-critical">
              <TrashIcon size={16} /> Delete competitor
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>

    {/* What we measure about them, starting at the page's leading edge so everything
        under the title is one column. The rule that used to separate this from the
        identity is gone: it was a separator doing the job of a gap, and it turned
        two halves of one block into a third horizontal band before any content.
        Each fact carries its own noun now, which is what let the labels go — and
        with them the three different baselines the label/value cells produced.
        Two of the three answer a question with a page behind it, so they are links:
        "how many sources" is the Sources page, "when did we last look" is activity. */}
    {hasFacts && (
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-dense text-muted-foreground">
        {competitor.overlapScore != null && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="About overlap"
                className="inline-flex cursor-help items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="h-1.5 w-10 overflow-hidden rounded-full bg-track">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{
                      width: `${Math.max(0, Math.min(100, competitor.overlapScore))}%`,
                    }}
                  />
                </span>
                <span className="font-semibold tabular-nums text-foreground">
                  {Math.round(competitor.overlapScore)}
                </span>
                overlap
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="max-w-[240px] text-xs leading-relaxed text-pretty normal-case"
            >
              How similar this competitor is to your product (0 to 100). Computed at
              discovery via Exa + AI scoring against your product profile.
            </TooltipContent>
          </Tooltip>
        )}
        {competitor.overlapScore != null && sourceCount > 0 && (
          <span aria-hidden className="text-border-strong">·</span>
        )}
        {sourceCount > 0 && (
          <Link
            href={`/dashboard/competitors/${competitor.id}/sources`}
            className="inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="font-semibold tabular-nums text-foreground">
              {sourceCount}
            </span>
            {sourceCount === 1 ? "source" : "sources"}
          </Link>
        )}
        {(competitor.overlapScore != null || sourceCount > 0) && lastRunMs > 0 && (
          <span aria-hidden className="text-border-strong">·</span>
        )}
        {lastRunMs > 0 && (
          <button
            type="button"
            onClick={onOpenActivity}
            className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            checked {formatDistanceToNow(new Date(lastRunMs), { addSuffix: true })}
          </button>
        )}
      </div>
    )}
    </div>
    <EditDetailsDialog
      open={editOpen}
      onOpenChange={setEditOpen}
      competitor={competitor}
      onSave={onEditSave}
    />
    <MoveToProductDialog open={assignOpen} onOpenChange={setAssignOpen} competitor={competitor} />
    </>
  );
}

/**
 * The way to the battle card, carrying which of its three states you'd land in.
 *
 * The button said the same word whether no card had ever been generated, one was
 * current, or one had aged behind newer signals — so the page's one produced
 * artefact was also the one control you couldn't read. The staleness endpoint
 * already answers that for the card view; reading it here costs one request and
 * turns a label into a status. Best-effort by design: a failed or pending read
 * renders the plain label rather than guessing, or blocking the way there.
 */
function BattleCardButton({
  competitorId,
  productId,
}: {
  competitorId: string;
  productId?: string;
}) {
  const { data } = useQuery(battleCardStalenessQuery(competitorId, productId));
  const state = data?.staleness ?? null;
  const generatedAt = data?.lastGeneratedAt ?? null;

  const tip =
    state === "never_generated"
      ? "No battle card yet. Generating one takes a few seconds."
      : state === "outdated"
        ? "New signals landed since this card was generated."
        : generatedAt
          ? `Generated ${formatDistanceToNow(new Date(generatedAt), { addSuffix: true })}`
          : "How you win against this competitor";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild size="sm" variant="outline" className="h-9">
          <Link href={`/dashboard/competitors/${competitorId}/battle-card`}>
            {state === "never_generated" ? <SparkleIcon size={16} /> : <SwordIcon size={16} />}
            {state === "never_generated" ? "Generate battle card" : "Battle card"}
            {state === "outdated" && <StatusDot tone="warn">outdated</StatusDot>}
            {state === "fresh" && generatedAt && (
              <span className="text-xs text-muted-foreground">
                <span aria-hidden>·</span>{" "}
                <span className="tabular-nums">{shortAge(generatedAt)}</span>
              </span>
            )}
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
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
            <Input
              id="cmp-name"
              value={name}
              maxLength={COMPETITOR_NAME_MAX_LENGTH}
              onChange={(e) => setName(e.target.value)}
            />
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
            {saving ? <SpinnerIcon size={16} className="animate-spin" /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Move this competitor to a product. A competitor belongs to exactly ONE product, so
 * the choice is single: picking a product REPLACES the membership rather than adding a
 * second link. It posts to the roster's bulk endpoint with a selection of one, because
 * that endpoint swaps the junction row in a single request — a client-side detach then
 * attach can fail between the two and leave the competitor in no product at all.
 */
function MoveToProductDialog({
  open,
  onOpenChange,
  competitor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  competitor: Competitor;
}) {
  const queryClient = useQueryClient();
  const [products, setProducts] = useState<
    Array<{ id: string; name: string; isPrimary: boolean; status: string }> | null
  >(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

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
        // One membership, so the first link IS the membership. A competitor carrying
        // several links predates the single-product rule; the first one is shown as
        // current and picking anything here collapses it back to one.
        setCurrent(res.links[0]?.productId ?? null);
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

  async function move(productId: string, name: string) {
    if (pending) return;
    setPending(productId);
    try {
      await api.bulkMoveCompetitorsToProduct([competitor.id], productId);
      setCurrent(productId);
      toast.success(`${competitor.name} moved to ${name}`);
      // The roster's product chips and every product-scoped list read this cache.
      await queryClient.invalidateQueries({ queryKey: ["competitors"] });
      onOpenChange(false);
    } catch (e) {
      toastApiError(e, { title: "Couldn't move this competitor" });
    } finally {
      setPending(null);
    }
  }

  const visible = products?.filter((p) => p.status !== "archived") ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to product</DialogTitle>
          <DialogDescription>
            Pick which product tracks {competitor.name}. Its signals show in that
            product&apos;s feed; signals already detected keep the product they were
            filed under.
          </DialogDescription>
        </DialogHeader>
        {loading || !products ? (
          <div className="flex justify-center py-6">
            <SpinnerIcon size={16} className="animate-spin text-muted-foreground" />
          </div>
        ) : visible.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">You don&apos;t have any products yet.</p>
        ) : (
          <div className="flex flex-col gap-0.5" role="radiogroup" aria-label="Product">
            {visible.map((p) => {
              const isCurrent = current === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={isCurrent}
                  // Nothing to do on the product it already belongs to, and a click
                  // that changes nothing shouldn't spend a request to say so.
                  disabled={isCurrent || pending !== null}
                  onClick={() => void move(p.id, p.name)}
                  className="flex items-center gap-3 rounded-md px-2 py-2 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span className="flex-1 truncate text-sm font-medium">{p.name}</span>
                  {p.isPrimary && (
                    <span className="text-meta text-muted-foreground">Primary</span>
                  )}
                  {isCurrent && <span className="text-meta text-muted-foreground">Current</span>}
                  {pending === p.id && (
                    <SpinnerIcon size={14} className="animate-spin text-muted-foreground" />
                  )}
                </button>
              );
            })}
          </div>
        )}
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
      <PauseIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">Monitoring is paused</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          No sources are being scraped, so the data below won&apos;t update until you
          resume.
        </p>
      </div>
      <Button size="sm" onClick={onResume} className="shrink-0">
        <PlayIcon size={16} /> Resume monitoring
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
      <PauseCircleIcon className="h-4 w-4 shrink-0 text-medium" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          Monitoring is paused, over your plan limit
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
