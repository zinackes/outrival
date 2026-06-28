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
  Info,
  ChevronDown,
  AlertCircle,
  Trash2,
  RefreshCw,
  MoreHorizontal,
  Plus,
  Settings2,
  Lock,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Pencil,
  Pause,
  PowerOff,
  Bell,
  BellOff,
  Download,
  Link2,
  Boxes,
  Crosshair,
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BattleCardTab } from "@/components/outrival/battle-card-tab";
import {
  PaywallDialog,
  paywallFromError,
  type PaywallReason,
} from "@/components/outrival/paywall-dialog";
import { track } from "@/lib/posthog/events";
import {
  validateMonitorUrl,
  MONITOR_FREQUENCIES,
  PLAN_LABELS,
  minPlanForSource,
  planIncludesSource,
  minPlanForFrequency,
  planIncludesFrequency,
  aggregateFreshness,
  type Plan,
  type SourceType,
  type MonitorFrequency,
} from "@outrival/shared";
import { FreshnessDot } from "@/components/outrival/freshness-dot";
import { MonitorFreshnessAction } from "@/components/outrival/monitor-freshness";
import { MonitorAlternatives } from "@/components/outrival/monitor-alternatives";
import { CompetitorTechStack } from "@/components/outrival/competitor-tech-stack";
import { Eyebrow } from "@/components/outrival/eyebrow";
import { CompetitorColorPicker } from "@/components/dashboard/competitor-color-picker";
import { competitorNameColor } from "@/lib/competitor-color";
import { TabCard, TabSection } from "@/components/outrival/tab-shell";
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
import {
  POLL_TIMEOUT_MS,
  isServerScraping,
  MonitorEmptyState,
  Empty,
  TabLoading,
  SourceSummary,
  FrequencyButton,
  type MonitorSourceProps,
} from "./competitor-detail/shared";
import { PricingTab } from "./competitor-detail/pricing-tab";
import { HiringTab } from "./competitor-detail/hiring-tab";
import { ReviewsTab } from "./competitor-detail/reviews-tab";
import { OverviewTab } from "./competitor-detail/overview-tab";
import { ActivityTab } from "./competitor-detail/activity-tab";
import { ContentTab } from "./competitor-detail/content-tab";
import type { TabKey } from "./competitor-detail/types";

const TABS: Array<{ key: TabKey; label: string; icon: typeof Activity }> = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "activity", label: "Activity", icon: Activity },
  { key: "pricing", label: "Pricing", icon: DollarSign },
  { key: "hiring", label: "Hiring", icon: Briefcase },
  { key: "reviews", label: "Reviews", icon: Star },
  { key: "content", label: "Content", icon: FileText },
  { key: "techstack", label: "Tech stack", icon: Cpu },
  { key: "battlecard", label: "Battle Card", icon: Swords },
];

// Per-tab freshness dot (patch-14): tabs backed by monitored sources show how
// recent that section's data is. Activity (signal feed) and Battle Card have no
// single source → no dot.
const TAB_SOURCES: Partial<Record<TabKey, string[]>> = {
  pricing: ["pricing"],
  hiring: ["jobs"],
  reviews: ["g2_reviews", "capterra_reviews", "appstore_reviews"],
  content: ["homepage", "blog", "changelog"],
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
// (overview/activity/pricing/content/techstack/battlecard) return null.
function tabLock(key: TabKey, plan: Plan): { reason: PaywallReason; minPlan: Plan } | null {
  switch (key) {
    // Battle cards are open to every tier now (governed by the daily-generation cap,
    // enforced at generate time inside BattleCardTab) — the tab itself is never locked.
    case "hiring":
      if (planIncludesSource(plan, "jobs")) return null;
      return {
        reason: { code: "plan_locked_source", source: "jobs", plan },
        minPlan: minPlanForSource("jobs"),
      };
    case "reviews":
      if (planIncludesSource(plan, "g2_reviews")) return null;
      return {
        reason: { code: "plan_locked_source", source: "g2_reviews", plan },
        minPlan: minPlanForSource("g2_reviews"),
      };
    default:
      return null;
  }
}


// Shared shell for every tab body. Radix unmounts inactive TabsContent, so the
// entrance animation replays on each switch — applying it here (not per-tab) means
// every tab fades/slides in identically instead of some animating and some snapping.
const TAB_PANEL_CLASS = "animate-in fade-in slide-in-from-bottom-1 duration-300";

const POLL_INTERVAL_MS = 3000;

// AI-summary generation is a fire-and-trigger job (refresh-competitor-summary) that
// can take well beyond a single tick — queued behind other summaries (concurrency 1),
// slow AI failover, retries. We persist the in-progress marker per competitor so the
// "Generating…" state + completion poll survive navigating away and back / a reload,
// instead of dying with the component (the old fixed 6s refetch gave up far too early).
const summaryGenKey = (competitorId: string) => `outrival:summary-gen:${competitorId}`;
type SummaryGenMeta = { startedAt: number; baseline: string | null };

type MonitorStatus = "running" | "failed" | "disabled" | "ok" | "idle";

function monitorStatus(m: Monitor, running: boolean): MonitorStatus {
  if (running) return "running";
  // Auto-paused after repeated failures (markedUnscrapable + isActive=false). A
  // distinct, muted state — not the loud "failed" hue — so the strip shows the
  // source is intentionally off and won't retry on its own, not mid-retry.
  if (m.markedUnscrapable) return "disabled";
  const lastRun = m.lastRunAt ? new Date(m.lastRunAt).getTime() : 0;
  const lastFailed = m.lastFailedAt ? new Date(m.lastFailedAt).getTime() : 0;
  if (lastFailed > 0 && lastFailed > lastRun) return "failed";
  if (lastRun > 0) return "ok";
  return "idle";
}

export type CompetitorData = {
  competitor: Competitor;
  monitors: Monitor[];
  recentChanges: ChangeRow[];
  recentSignals: CompetitorSignal[];
  techStack: TechStackData;
  overview: CompetitorOverview;
  plan: Plan;
};

export function CompetitorDetailView({ id }: { id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Server-seeded on first paint (page.tsx). Keyed on id, so prev/next navigation
  // refetches automatically.
  const competitorQ = useQuery(competitorDetailQuery(id));
  const data = competitorQ.data ?? null;
  const error = competitorQ.error;
  // Optimistic write-through to the competitor cache (the kebab mutations call this);
  // the setData(updater) call-sites stay unchanged.
  function setData(updater: (prev: CompetitorData | null) => CompetitorData | null) {
    queryClient.setQueryData<CompetitorData>(competitorDetailQuery(id).queryKey, (prev) =>
      updater(prev ?? null) ?? undefined,
    );
  }
  const [scrapingIds, setScrapingIds] = useState<Set<string>>(new Set());
  const [runningAll, setRunningAll] = useState(false);
  const [techScraping, setTechScraping] = useState(false);
  const [tab, setTab] = useState<TabKey>("overview");
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrapingStartRef = useRef<
    Map<
      string,
      {
        startedAt: number;
        lastRunAt: string | null;
        lastFailedAt: string | null;
        lastChangedAt: string | null;
      }
    >
  >(new Map());
  const seededRef = useRef(false);
  // AI-summary generation poll (persisted across navigation, see summaryGenKey).
  const [summaryGenerating, setSummaryGenerating] = useState(false);
  const summaryStartRef = useRef<SummaryGenMeta | null>(null);
  const summarySeededIdRef = useRef<string | null>(null);

  // Prev/next pager across the competitor roster (Linear "n/total" + chevrons):
  // fetch the ordered roster once; the pager walks it so an analyst flips through
  // competitors without bouncing back to the list. Order = the list's default.
  // Shares the ["competitors"] roster cache with the list / overview / sidebar.
  const rosterQ = useQuery(competitorsQuery());
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

  // Refetch the competitor detail and return the fresh data (the scrape poller and
  // several mutations await it). useQuery (keyed on id) handles the initial load.
  async function refresh() {
    const r = await competitorQ.refetch();
    return r.data ?? null;
  }

  // Restore the active tab from the URL (?tab=) so a refresh stays on the same
  // tab. Runs once on mount, before the Tabs render (data is still loading).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && TABS.some((x) => x.key === t)) setTab(t as TabKey);
  }, []);

  // Switch tab and mirror it into the URL so it survives a reload (replaceState,
  // no history entry per tab click).
  function selectTab(key: TabKey) {
    setTab(key);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", key);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  // Restore the in-progress state after a refresh: any monitor the server still
  // reports as scraping is re-tracked so the existing poll resumes and reports
  // its completion/failure. Runs once, after the first successful load.
  useEffect(() => {
    if (!data || seededRef.current) return;
    seededRef.current = true;
    const running = data.monitors.filter(isServerScraping);
    if (running.length === 0) return;
    for (const m of running) {
      scrapingStartRef.current.set(m.id, {
        startedAt: m.scrapeStartedAt ? new Date(m.scrapeStartedAt).getTime() : Date.now(),
        lastRunAt: m.lastRunAt,
        lastFailedAt: m.lastFailedAt,
        lastChangedAt: m.lastChangedAt,
      });
    }
    setScrapingIds(new Set(running.map((m) => m.id)));
  }, [data]);

  useEffect(() => {
    if (scrapingIds.size === 0) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;

    pollRef.current = setInterval(async () => {
      const fresh = await refresh();
      if (!fresh) return;
      const finished: string[] = [];
      // Subset of `finished` whose lastChangedAt moved during the run — i.e. the
      // scrape produced a real diff, not just a no-op re-fetch of identical content.
      const changed: string[] = [];
      const failed: string[] = [];
      const timedOut: string[] = [];
      const now = Date.now();
      for (const monitorId of scrapingIds) {
        const tracker = scrapingStartRef.current.get(monitorId);
        if (!tracker) continue;
        const updated = fresh.monitors.find((m) => m.id === monitorId);
        const updatedRun = updated?.lastRunAt ?? null;
        const updatedFailed = updated?.lastFailedAt ?? null;
        if (updatedRun !== null && updatedRun !== tracker.lastRunAt) {
          finished.push(monitorId);
          const updatedChanged = updated?.lastChangedAt ?? null;
          if (updatedChanged !== null && updatedChanged !== tracker.lastChangedAt) {
            changed.push(monitorId);
          }
        } else if (updatedFailed !== null && updatedFailed !== tracker.lastFailedAt) {
          failed.push(monitorId);
        } else if (now - tracker.startedAt > POLL_TIMEOUT_MS) {
          timedOut.push(monitorId);
        }
      }
      if (finished.length === 0 && failed.length === 0 && timedOut.length === 0) return;

      setScrapingIds((prev) => {
        const next = new Set(prev);
        for (const fid of [...finished, ...failed, ...timedOut]) {
          next.delete(fid);
          scrapingStartRef.current.delete(fid);
        }
        return next;
      });

      if (finished.length > 0) {
        const changedSet = new Set(changed);
        const label = (mid: string) =>
          fresh.monitors.find((m) => m.id === mid)?.sourceType ?? mid;
        const changedLabels = finished.filter((mid) => changedSet.has(mid)).map(label);
        const unchangedLabels = finished.filter((mid) => !changedSet.has(mid)).map(label);
        if (changedLabels.length > 0) {
          toast.success("Change detected", {
            description: `${changedLabels.join(", ")} — new snapshot captured`,
          });
        }
        if (unchangedLabels.length > 0) {
          toast.info("Scrape complete · no change", { description: unchangedLabels.join(", ") });
        }
        void queryClient.invalidateQueries({ queryKey: ["competitor", id] });
      }
      if (failed.length > 0) {
        for (const mid of failed) {
          const m = fresh.monitors.find((x) => x.id === mid);
          toast.error(`Scrape failed · ${m?.sourceType ?? mid}`, {
            description: friendlyScrapeError(m?.lastError, m?.sourceType),
          });
        }
        void queryClient.invalidateQueries({ queryKey: ["competitor", id] });
      }
      if (timedOut.length > 0) {
        const labels = timedOut
          .map((mid) => fresh.monitors.find((m) => m.id === mid)?.sourceType ?? mid)
          .join(", ");
        toast.warning("Scrape still running", {
          description: `${labels} — still in progress after 5 min, will continue in background. Refresh the page later to see results.`,
        });
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [scrapingIds, id]);

  async function runAllMonitors() {
    if (!data) return;
    const idle = data.monitors.filter((m) => !scrapingIds.has(m.id));
    if (idle.length === 0) return;
    setRunningAll(true);
    try {
      // Each re-scan counts against the daily cap; stop at the first limit hit so
      // we don't fire one 429 toast per remaining source.
      for (const m of idle) {
        const result = await runMonitor(m.id);
        if (result === "limit") break;
      }
    } finally {
      setRunningAll(false);
    }
  }

  // Dev-only: force a tech-stack scan. The job (scrape-tech-stack) updates
  // techStackScrapedAt + entries, so a timed refresh surfaces the result — no
  // monitor-keyed polling like the normal sources.
  async function scrapeTechStack() {
    setTechScraping(true);
    try {
      await api.scrapeTechStack(id);
      toast.info("Tech-stack scan triggered", {
        description: "Detecting third-party tech… refreshing shortly.",
      });
      setTimeout(() => {
        refresh();
        setTechScraping(false);
      }, 8000);
    } catch (e) {
      toastApiError(e, { title: "Couldn't trigger the tech-stack scan" });
      setTechScraping(false);
    }
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
      setData((d) => (d ? { ...d, competitor: { ...d.competitor, monitoringPaused: next } } : d));
      toast.success(next ? "Monitoring paused" : "Monitoring resumed", {
        description: next
          ? "All sources frozen — no scheduled scrapes until you resume."
          : "Sources will scrape on their normal schedule again.",
      });
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
      setData((d) => (d ? { ...d, competitor: { ...d.competitor, alertsMuted: next } } : d));
      toast.success(next ? "Alerts muted" : "Alerts unmuted", {
        description: next
          ? "Signals are still tracked — you just won't get real-time alerts."
          : "Real-time alerts re-enabled for this competitor.",
      });
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

  async function enableMonitor(sourceType: SourceType, url?: string) {
    try {
      await api.addCompetitorMonitor(id, sourceType, url ? { url } : undefined);
      const fresh = await refresh();
      const created = fresh?.monitors.find((m) => m.sourceType === sourceType);
      if (created && fresh) {
        toast.success(`${sourceType} monitoring enabled`, {
          description: "Starting first scrape…",
        });
        await runMonitor(created.id, fresh.monitors);
      } else {
        toast.success(`${sourceType} monitoring enabled`);
      }
    } catch (e) {
      const reason = paywallFromError(e);
      if (reason) {
        setPaywall(reason);
        return;
      }
      toastApiError(e, { title: "Couldn't enable that source" });
    }
  }

  async function editMonitor(
    monitorId: string,
    patch: { url?: string; frequency?: MonitorFrequency },
  ) {
    try {
      await api.updateMonitor(monitorId, patch);
      await refresh();
      toast.success("Monitor updated");
    } catch (e) {
      const reason = paywallFromError(e);
      if (reason) {
        setPaywall(reason);
        return;
      }
      toastApiError(e, { title: "Couldn't update the monitor" });
    }
  }

  // Switch a competitor's review source (e.g. G2 → Capterra). Enable the new
  // source FIRST so a plan/URL rejection surfaces the paywall without losing the
  // existing monitor; only then delete the old one and kick off the first scrape.
  async function switchReviewSource(oldMonitorId: string, source: SourceType, url: string) {
    try {
      const { monitor } = await api.addCompetitorMonitor(id, source, { url });
      await api.deleteMonitor(oldMonitorId);
      const fresh = await refresh();
      toast.success(`Switched to ${source}`, { description: "Starting first scrape…" });
      await runMonitor(monitor.id, fresh?.monitors);
    } catch (e) {
      const reason = paywallFromError(e);
      if (reason) {
        setPaywall(reason);
        return;
      }
      toastApiError(e, { title: "Couldn't switch the review source" });
    }
  }

  async function runMonitor(
    monitorId: string,
    list?: Monitor[],
  ): Promise<"ok" | "limit" | "error"> {
    const available = list ?? data?.monitors;
    if (!available) return "error";
    const monitor = available.find((m) => m.id === monitorId);
    if (!monitor) return "error";
    scrapingStartRef.current.set(monitorId, {
      startedAt: Date.now(),
      lastRunAt: monitor.lastRunAt,
      lastFailedAt: monitor.lastFailedAt,
      lastChangedAt: monitor.lastChangedAt,
    });
    setScrapingIds((prev) => new Set(prev).add(monitorId));
    try {
      await api.runMonitor(monitorId);
      track("scrape_triggered", { sourceType: monitor.sourceType });
      toast.info(`Scrape started · ${monitor.sourceType}`, {
        description: "Polling for completion…",
      });
      return "ok";
    } catch (e) {
      scrapingStartRef.current.delete(monitorId);
      setScrapingIds((prev) => {
        const next = new Set(prev);
        next.delete(monitorId);
        return next;
      });
      // A re-scan past the daily cap (patch-27) → friendly limit toast + upgrade nudge.
      if (toastRescanLimit(e)) return "limit";
      toastApiError(e, { title: "Couldn't start the scrape" });
      return "error";
    }
  }

  // Re-activate an auto-paused source (markedUnscrapable): the resume endpoint
  // clears the failure state, re-enables scheduling, and kicks a fresh scrape.
  // Mirrors runMonitor's optimistic tracking so the chip flips to the spinner and
  // the existing poll reports completion.
  async function resumeMonitor(monitorId: string) {
    const monitor = data?.monitors.find((m) => m.id === monitorId);
    if (!monitor) return;
    scrapingStartRef.current.set(monitorId, {
      startedAt: Date.now(),
      lastRunAt: monitor.lastRunAt,
      lastFailedAt: monitor.lastFailedAt,
      lastChangedAt: monitor.lastChangedAt,
    });
    setScrapingIds((prev) => new Set(prev).add(monitorId));
    try {
      await api.resumeMonitor(monitorId);
      toast.success(`${sourceShortLabel(monitor.sourceType)} resumed`, {
        description: "A fresh scrape is on its way.",
      });
      await refresh();
    } catch (e) {
      scrapingStartRef.current.delete(monitorId);
      setScrapingIds((prev) => {
        const next = new Set(prev);
        next.delete(monitorId);
        return next;
      });
      toastApiError(e, { title: "Couldn't resume this source" });
    }
  }

  // Intelligent rate limiting (patch-22): a manual re-scrape of a source that was
  // checked recently with no change is friction, not blocked. Mirrors the server
  // GET /monitors/:id/staleness thresholds, computed client-side from data we already
  // have. The user can always force it. Only gates explicit per-source "Run" — first
  // scrapes (enable/switch) and "Run all" still scrape unconditionally.
  function monitorStaleness(m: Monitor): "very_recent" | "fresh" | "outdated" {
    const minutesSince = m.lastRunAt
      ? (Date.now() - new Date(m.lastRunAt).getTime()) / 60000
      : Infinity;
    const changedSinceRun =
      !!m.lastChangedAt &&
      !!m.lastRunAt &&
      new Date(m.lastChangedAt).getTime() >= new Date(m.lastRunAt).getTime();
    if (minutesSince < 30) return "very_recent";
    if (minutesSince < 1440 && !changedSinceRun) return "fresh";
    return "outdated";
  }

  function requestRunMonitor(monitorId: string, list?: Monitor[]) {
    const monitor = (list ?? data?.monitors)?.find((m) => m.id === monitorId);
    if (monitor) {
      const s = monitorStaleness(monitor);
      if (s !== "outdated") {
        toast.info(s === "very_recent" ? "Scraped just now" : "No changes since last scrape", {
          description:
            s === "very_recent"
              ? "This source was checked in the last 30 minutes."
              : "Nothing has changed since the last scrape — re-scanning will likely find nothing new.",
          action: { label: "Re-scan anyway", onClick: () => void runMonitor(monitorId) },
        });
        return;
      }
    }
    void runMonitor(monitorId);
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
  const lastRunMs = monitors
    .map((m) => (m.lastRunAt ? new Date(m.lastRunAt).getTime() : 0))
    .reduce((a, b) => Math.max(a, b), 0);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
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

        <MonitorSources
          monitors={monitors}
          scrapingIds={scrapingIds}
          onRun={requestRunMonitor}
          onResume={resumeMonitor}
          onForceRescanStarted={(mid) =>
            setScrapingIds((prev) => new Set(prev).add(mid))
          }
          onRunAll={runAllMonitors}
          onEdit={editMonitor}
          competitorUrl={competitor.url}
          runningAll={runningAll}
          disabled={
            runningAll ||
            monitors.every((m) => scrapingIds.has(m.id) || isServerScraping(m))
          }
          plan={plan}
          onLockedFrequency={(freq) =>
            setPaywall({ code: "plan_locked_frequency", frequency: freq, plan })
          }
          techLastScrapedAt={techStack.lastScrapedAt}
          onScrapeTech={scrapeTechStack}
          techScraping={techScraping}
        />

        {monitors
          .filter((m) => m.markedUnscrapable)
          .map((m) => (
            <MonitorAlternatives
              key={m.id}
              monitorId={m.id}
              sourceType={m.sourceType}
              failureCategory={m.lastFailureCategory}
              onResolved={refresh}
            />
          ))}

        <AiSummary
          competitor={competitor}
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
            {TABS.map((t) => {
              const Icon = t.icon;
              const lock = tabLock(t.key, plan);
              // Tech stack isn't monitor-backed (its own monthly cron), so its
              // freshness comes from techStackScrapedAt rather than TAB_SOURCES.
              const fresh = lock
                ? null
                : t.key === "techstack"
                  ? techStack.lastScrapedAt
                    ? { lastScrapedAt: techStack.lastScrapedAt, status: "success" as const }
                    : null
                  : tabFreshness(t.key, monitors);
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
                      nextRunAt={t.key === "techstack" ? techStack.nextScanAt : undefined}
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
                onRun={requestRunMonitor}
                onOpenTab={selectTab}
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
            <TabsContent value="content" className={TAB_PANEL_CLASS}>
              <ContentTab
                changes={recentChanges}
                signals={recentSignals}
                monitors={monitors}
                scrapingIds={scrapingIds}
                onRun={requestRunMonitor}
                onRefresh={refresh}
                competitorUrl={competitor.url}
              />
            </TabsContent>
            <TabsContent value="techstack" className={TAB_PANEL_CLASS}>
              <CompetitorTechStack techStack={techStack} />
            </TabsContent>
            <TabsContent value="battlecard" className={TAB_PANEL_CLASS}>
              <BattleCardTab competitorId={id} />
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
            {competitor.monitoringPaused && (
              <Badge
                variant="outline"
                className="gap-1 text-meta uppercase tracking-wide font-medium text-muted-foreground"
              >
                <Pause size={11} /> Paused
              </Badge>
            )}
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
            <span className="select-none px-0.5 text-meta tabular-nums text-muted-foreground">
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
        <DropdownMenu>
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

function SourceStatusIcon({ status }: { status: MonitorStatus }) {
  if (status === "running")
    return <Loader2 size={13} className="animate-spin text-muted-foreground shrink-0" />;
  if (status === "failed") return <AlertCircle size={13} className="text-critical shrink-0" />;
  if (status === "disabled")
    return <PowerOff size={13} className="text-muted-foreground shrink-0" />;
  return (
    <span
      className={cn(
        "h-2 w-2 rounded-full shrink-0",
        status === "ok" ? "bg-positive" : "border border-muted-foreground/40",
      )}
    />
  );
}

function MonitorSources({
  monitors,
  scrapingIds,
  onRun,
  onResume,
  onForceRescanStarted,
  onRunAll,
  onEdit,
  competitorUrl,
  runningAll,
  disabled,
  plan,
  onLockedFrequency,
  techLastScrapedAt,
  onScrapeTech,
  techScraping,
}: {
  monitors: Monitor[];
  scrapingIds: Set<string>;
  onRun: (id: string) => void;
  onResume: (id: string) => void;
  onForceRescanStarted?: (id: string) => void;
  onRunAll: () => void;
  onEdit: (id: string, patch: { url?: string; frequency?: MonitorFrequency }) => Promise<void>;
  competitorUrl: string;
  runningAll: boolean;
  disabled: boolean;
  plan: Plan;
  onLockedFrequency: (freq: MonitorFrequency) => void;
  techLastScrapedAt: string | null;
  onScrapeTech: () => void;
  techScraping: boolean;
}) {
  const [editing, setEditing] = useState<Monitor | null>(null);
  const [expanded, setExpanded] = useState(false);
  if (monitors.length === 0) return null;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border">
        <h3 className="text-sm font-semibold tracking-tight">Sources</h3>
        <Button
          size="sm"
          variant="default"
          onClick={onRunAll}
          disabled={disabled}
          className="h-7 text-xs"
        >
          {runningAll ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Play size={12} />
          )}
          Scrape all
        </Button>
      </div>

      {/* Compact default: one chip per source (status + name + age at a glance);
          the per-source actions (Run, Configure) live in the chip's dropdown. The
          full detail rows — including force-rescan and the error tooltip — fold
          behind "Details". */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-3">
        {monitors.map((m) => {
          const running = scrapingIds.has(m.id) || isServerScraping(m);
          return (
            <SourceChip
              key={m.id}
              monitor={m}
              running={running}
              status={monitorStatus(m, running)}
              onRun={onRun}
              onResume={onResume}
              onConfigure={() => setEditing(m)}
            />
          );
        })}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="ml-auto h-7 gap-1 text-xs text-muted-foreground"
        >
          {expanded ? "Hide details" : "Details"}
          <ChevronDown size={12} className={cn("transition-transform", expanded && "rotate-180")} />
        </Button>
      </div>

      {expanded && (
        <div className="divide-y divide-border border-t border-border">
          {monitors.map((m) => {
            const running = scrapingIds.has(m.id) || isServerScraping(m);
            const status = monitorStatus(m, running);
            const ageText =
              status === "running"
                ? "scraping…"
                : status === "disabled"
                  ? "Paused after repeated failures"
                  : status === "failed" && m.lastFailedAt
                    ? `Failed ${formatDistanceToNow(new Date(m.lastFailedAt), { addSuffix: true })}`
                    : status === "ok" && m.lastRunAt
                      ? formatDistanceToNow(new Date(m.lastRunAt), { addSuffix: true })
                      : "never scraped";
            return (
              <div key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                <SourceStatusIcon status={status} />
                <span className="font-medium text-sm w-[104px] truncate">{sourceShortLabel(m.sourceType)}</span>
                <Eyebrow size="micro" className="w-12">
                  {m.frequency}
                </Eyebrow>
                <span
                  className={cn(
                    "text-xs",
                    status === "failed" ? "text-critical/80" : "text-muted-foreground",
                  )}
                >
                  {ageText}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  <MonitorFreshnessAction
                    monitorId={m.id}
                    sourceType={m.sourceType}
                    lastScrapedAt={m.lastRunAt}
                    status={status === "failed" ? "failed" : "success"}
                    canForceRescan={!running}
                    onStarted={() => onForceRescanStarted?.(m.id)}
                  />
                  {status === "failed" && m.lastError && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="text-critical/70 hover:text-critical transition-colors"
                          aria-label="Scrape error detail"
                        >
                          <Info size={13} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        className="max-w-[280px] text-xs leading-relaxed text-pretty break-words"
                      >
                        {friendlyScrapeError(m.lastError, m.sourceType)}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => setEditing(m)}
                    aria-label="Configure source"
                  >
                    <Settings2 size={13} />
                  </Button>
                  {status === "disabled" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onResume(m.id)}
                      disabled={running}
                      className="h-7 text-xs min-w-[84px]"
                    >
                      {running ? (
                        <>
                          <Loader2 size={11} className="animate-spin" /> Resuming…
                        </>
                      ) : (
                        <>
                          <RefreshCw size={11} /> Resume
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onRun(m.id)}
                      disabled={running}
                      className="h-7 text-xs min-w-[84px]"
                    >
                      {running ? (
                        <>
                          <Loader2 size={11} className="animate-spin" /> Scraping…
                        </>
                      ) : (
                        <>
                          <Play size={11} /> Run
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {/* Dev-only: tech stack runs on its own monthly cron (no user-facing Run).
              This synthetic row lets the operator force a scan on demand. Stripped
              from production bundles via NODE_ENV; the /api/dev endpoint is likewise
              unmounted in prod. Non-configurable (weekly, no gear). */}
          {process.env.NODE_ENV !== "production" && (
            <div className="flex items-center gap-3 px-4 py-2.5">
              <SourceStatusIcon
                status={techScraping ? "running" : techLastScrapedAt ? "ok" : "idle"}
              />
              <span className="font-medium text-sm w-[104px] truncate">tech_stack</span>
              <Eyebrow size="micro" className="w-12">
                weekly
              </Eyebrow>
              <span className="text-xs text-muted-foreground">
                {techScraping
                  ? "scanning…"
                  : techLastScrapedAt
                    ? formatDistanceToNow(new Date(techLastScrapedAt), { addSuffix: true })
                    : "never scanned"}
              </span>
              <Badge
                variant="outline"
                className="text-meta uppercase tracking-wide font-medium px-1 py-0 text-muted-foreground"
              >
                dev
              </Badge>
              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onScrapeTech}
                  disabled={techScraping}
                  className="h-7 text-xs min-w-[84px]"
                >
                  {techScraping ? (
                    <>
                      <Loader2 size={11} className="animate-spin" /> Scanning…
                    </>
                  ) : (
                    <>
                      <Play size={11} /> Run
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      <MonitorEditDialog
        monitor={editing}
        competitorUrl={competitorUrl}
        plan={plan}
        onClose={() => setEditing(null)}
        onSave={onEdit}
        onLockedFrequency={onLockedFrequency}
      />
    </Card>
  );
}

// Compact relative age for the source chips ("2m" / "5h" / "3d") — the long
// "about 2 hours ago" reads fine in a row but is too wide for a dense chip strip.
function shortAge(d: Date): string {
  const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// One source as a chip: status + name + age at a glance, with Run / Configure in
// a dropdown. A failed source carries the critical hue so it stays loud in the
// strip. Force-rescan and the full error live in the expanded "Details" rows.
function SourceChip({
  monitor: m,
  running,
  status,
  onRun,
  onResume,
  onConfigure,
}: {
  monitor: Monitor;
  running: boolean;
  status: MonitorStatus;
  onRun: (id: string) => void;
  onResume: (id: string) => void;
  onConfigure: () => void;
}) {
  const failed = status === "failed";
  const isDisabled = status === "disabled";
  const ageLabel =
    status === "running"
      ? "…"
      : failed
        ? null
        : isDisabled
          ? "off"
          : status === "ok" && m.lastRunAt
            ? shortAge(new Date(m.lastRunAt))
            : "never";
  const ageText =
    status === "running"
      ? "scraping…"
      : isDisabled
        ? "Paused after repeated failures"
        : failed && m.lastFailedAt
          ? `Failed ${formatDistanceToNow(new Date(m.lastFailedAt), { addSuffix: true })}`
          : status === "ok" && m.lastRunAt
            ? formatDistanceToNow(new Date(m.lastRunAt), { addSuffix: true })
            : "never scraped";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-dense transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            failed
              ? "border-critical/40 text-critical hover:bg-critical/10"
              : isDisabled
                ? "border-border text-muted-foreground hover:bg-accent"
                : "border-border text-foreground hover:bg-accent",
          )}
        >
          <SourceStatusIcon status={status} />
          <span className="font-medium">{sourceShortLabel(m.sourceType)}</span>
          {ageLabel && (
            <span
              className={cn(
                "text-meta",
                failed ? "text-critical/70" : "text-muted-foreground",
              )}
            >
              {ageLabel}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span>{sourceShortLabel(m.sourceType)}</span>
          <Eyebrow size="micro">{m.frequency}</Eyebrow>
        </DropdownMenuLabel>
        <p
          className={cn(
            "px-2 pb-1 text-sm",
            failed ? "font-medium text-critical" : "text-muted-foreground",
          )}
        >
          {ageText}
        </p>
        {failed && m.lastError && (
          <p className="px-2 pb-1.5 text-sm leading-relaxed text-muted-foreground break-words">
            {friendlyScrapeError(m.lastError, m.sourceType)}
          </p>
        )}
        {isDisabled && (
          <p className="px-2 pb-1.5 text-sm leading-relaxed text-muted-foreground break-words">
            We stopped scraping this source after repeated failures. Resume to try again.
          </p>
        )}
        <DropdownMenuSeparator />
        {isDisabled ? (
          <DropdownMenuItem onClick={() => onResume(m.id)} disabled={running}>
            {running ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {running ? "Resuming…" : "Resume monitoring"}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => onRun(m.id)} disabled={running}>
            {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            {running ? "Scraping…" : "Run now"}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onConfigure}>
          <Settings2 size={13} /> Configure
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const EDITABLE_FREQUENCIES: MonitorFrequency[] = [...MONITOR_FREQUENCIES];

// A single frequency choice, plan-gated like ReviewSourceButton: a frequency the
// plan doesn't allow shows a lock + min-plan badge and routes to the paywall on
// click instead of selecting (which would only fail server-side on save).
// Per-monitor config: override the auto-detected page URL and the check cadence.
// Frequency is the upper bound (the scheduler backs off when a source is stable),
// gated by plan — an over-plan choice is locked in the picker and routes to the paywall.
function MonitorEditDialog({
  monitor,
  competitorUrl,
  plan,
  onClose,
  onSave,
  onLockedFrequency,
}: {
  monitor: Monitor | null;
  competitorUrl: string;
  plan: Plan;
  onClose: () => void;
  onSave: (id: string, patch: { url?: string; frequency?: MonitorFrequency }) => Promise<void>;
  onLockedFrequency: (freq: MonitorFrequency) => void;
}) {
  const [frequency, setFrequency] = useState<MonitorFrequency>("daily");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (monitor) {
      setFrequency(monitor.frequency as MonitorFrequency);
      setUrl(monitor.config?.url ?? "");
    }
  }, [monitor]);

  if (!monitor) return null;

  const trimmed = url.trim();
  const currentUrl = monitor.config?.url ?? "";
  const urlChanged = trimmed !== currentUrl;
  const urlValid =
    trimmed === "" ||
    validateMonitorUrl(monitor.sourceType as SourceType, trimmed, competitorUrl).ok;
  const freqChanged = frequency !== monitor.frequency;
  const canSave = (urlChanged || freqChanged) && urlValid && !busy;

  async function save() {
    if (!monitor) return;
    const patch: { url?: string; frequency?: MonitorFrequency } = {};
    if (urlChanged && trimmed !== "") patch.url = trimmed;
    if (freqChanged) patch.frequency = frequency;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await onSave(monitor.id, patch);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!monitor} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configure {sourceShortLabel(monitor.sourceType)}</DialogTitle>
          <DialogDescription>
            Pin the exact page to watch and how often it is checked.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Frequency
            </p>
            <div className="flex gap-1.5">
              {EDITABLE_FREQUENCIES.map((f) => (
                <FrequencyButton
                  key={f}
                  freq={f}
                  plan={plan}
                  selected={frequency === f}
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
              Page URL (optional)
            </p>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Leave empty to auto-detect"
            />
            {trimmed !== "" && !urlValid && (
              <p className="text-xs text-critical/80">
                This URL isn&apos;t allowed for this source.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={!canSave}>
            {busy && <Loader2 size={12} className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AiSummary({
  competitor,
  generating,
  onGenerate,
}: {
  competitor: Competitor;
  generating: boolean;
  onGenerate: () => void;
}) {
  if (!competitor.aiSummary) {
    return (
      <Card className="px-4 py-3 border-dashed flex items-start gap-2 justify-between">
        <div className="flex items-start gap-2 text-muted-foreground text-sm">
          <Sparkles size={13} className="mt-0.5 shrink-0" />
          <span>{generating ? "Generating AI summary…" : "AI summary not generated yet."}</span>
        </div>
        <Button size="sm" variant="secondary" onClick={onGenerate} disabled={generating} className="h-7 text-xs">
          {generating ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
          {generating ? "Generating…" : "Generate now"}
        </Button>
      </Card>
    );
  }
  return (
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
  );
}

