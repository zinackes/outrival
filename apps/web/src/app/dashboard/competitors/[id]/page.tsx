"use client";

import { useEffect, useMemo, useRef, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
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
  ChevronRight,
  ChevronDown,
  AlertCircle,
  Trash2,
  RefreshCw,
  MoreHorizontal,
  Plus,
  Settings2,
  Lock,
  LayoutGrid,
  Users,
  Cpu,
  Percent,
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
import { CompetitorPricingCard } from "@/components/outrival/competitor-pricing-card";
import {
  PaywallDialog,
  paywallFromError,
  type PaywallReason,
} from "@/components/outrival/paywall-dialog";
import { track } from "@/lib/posthog/events";
import {
  validateReviewUrl,
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
  type ReviewSourceType,
  type MonitorFrequency,
} from "@outrival/shared";
import { FreshnessDot } from "@/components/outrival/freshness-dot";
import { MonitorFreshnessAction } from "@/components/outrival/monitor-freshness";
import { MonitorAlternatives } from "@/components/outrival/monitor-alternatives";
import { CompetitorTechStack } from "@/components/outrival/competitor-tech-stack";
import { Eyebrow, eyebrowClass } from "@/components/outrival/eyebrow";
import { TabCard, TabSection } from "@/components/outrival/tab-shell";
import { SignalSourceLine } from "@/components/outrival/signal-source-line";
import { ListError } from "@/components/outrival/list-error";
import { toastApiError } from "@/lib/error-helpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import CompetitorDetailLoading from "./loading";
import { ChartSkeleton } from "@/components/dashboard/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  api,
  type Competitor,
  type Monitor,
  type ChangeRow,
  type CompetitorSignal,
  type JobsByDepartment,
  type JobTrendPoint,
  type PricingHistoryPoint,
  type MyProduct,
  type MyProductPricingTier,
  type ReviewScorePoint,
  type ReviewsData,
  type TechStackData,
  type CompetitorOverview,
} from "@/lib/api";
import { emitCompetitorsChanged } from "@/lib/competitor-events";

type TabKey =
  | "overview"
  | "activity"
  | "pricing"
  | "hiring"
  | "reviews"
  | "content"
  | "techstack"
  | "battlecard";

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

const SEVERITY_CLASS: Record<string, string> = {
  low: "bg-low text-background",
  medium: "bg-medium text-background",
  high: "bg-high text-background",
  critical: "bg-critical text-background",
};

// Shared shell for every tab body. Radix unmounts inactive TabsContent, so the
// entrance animation replays on each switch — applying it here (not per-tab) means
// every tab fades/slides in identically instead of some animating and some snapping.
const TAB_PANEL_CLASS = "animate-in fade-in slide-in-from-bottom-1 duration-300";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 300_000;

type MonitorStatus = "running" | "failed" | "ok" | "idle";

// A monitor is "running" from the server's point of view when its scrape was
// started after the last terminal event (success or failure) and hasn't blown
// past the poll timeout. This lets the in-progress state survive a page refresh
// even though the client-side `scrapingIds` set is reset on reload.
function isServerScraping(m: Monitor): boolean {
  if (!m.scrapeStartedAt) return false;
  const started = new Date(m.scrapeStartedAt).getTime();
  const lastRun = m.lastRunAt ? new Date(m.lastRunAt).getTime() : 0;
  const lastFailed = m.lastFailedAt ? new Date(m.lastFailedAt).getTime() : 0;
  if (started <= lastRun || started <= lastFailed) return false;
  return Date.now() - started < POLL_TIMEOUT_MS;
}

function monitorStatus(m: Monitor, running: boolean): MonitorStatus {
  if (running) return "running";
  const lastRun = m.lastRunAt ? new Date(m.lastRunAt).getTime() : 0;
  const lastFailed = m.lastFailedAt ? new Date(m.lastFailedAt).getTime() : 0;
  if (lastFailed > 0 && lastFailed > lastRun) return "failed";
  if (lastRun > 0) return "ok";
  return "idle";
}

interface Props {
  params: Promise<{ id: string }>;
}

type CompetitorData = {
  competitor: Competitor;
  monitors: Monitor[];
  recentChanges: ChangeRow[];
  recentSignals: CompetitorSignal[];
  techStack: TechStackData;
  overview: CompetitorOverview;
  plan: Plan;
};

export default function CompetitorDetailPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<CompetitorData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [scrapingIds, setScrapingIds] = useState<Set<string>>(new Set());
  const [runningAll, setRunningAll] = useState(false);
  const [techScraping, setTechScraping] = useState(false);
  const [tab, setTab] = useState<TabKey>("overview");
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
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

  async function refresh() {
    try {
      const fresh = await api.getCompetitor(id);
      setData(fresh);
      setError(null);
      return fresh;
    } catch (e) {
      setError(e);
      return null;
    }
  }

  useEffect(() => {
    refresh();
  }, [id]);

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
        setRefreshTick((t) => t + 1);
      }
      if (failed.length > 0) {
        for (const mid of failed) {
          const m = fresh.monitors.find((x) => x.id === mid);
          toast.error(`Scrape failed · ${m?.sourceType ?? mid}`, {
            description: friendlyScrapeError(m?.lastError, m?.sourceType),
          });
        }
        setRefreshTick((t) => t + 1);
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
      for (const m of idle) {
        await runMonitor(m.id);
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
      emitCompetitorsChanged();
      router.push("/dashboard/competitors");
    } catch (e) {
      toastApiError(e, { title: "Couldn't delete the competitor" });
      setDeleting(false);
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

  async function runMonitor(monitorId: string, list?: Monitor[]) {
    const available = list ?? data?.monitors;
    if (!available) return;
    const monitor = available.find((m) => m.id === monitorId);
    if (!monitor) return;
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
    } catch (e) {
      scrapingStartRef.current.delete(monitorId);
      setScrapingIds((prev) => {
        const next = new Set(prev);
        next.delete(monitorId);
        return next;
      });
      toastApiError(e, { title: "Couldn't start the scrape" });
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
      <div className="space-y-[22px] animate-in fade-in slide-in-from-bottom-2 duration-500">
        <Header
          competitor={competitor}
          lastRunMs={lastRunMs}
          onDelete={() => setShowDelete(true)}
        />

        <MonitorSources
          monitors={monitors}
          scrapingIds={scrapingIds}
          onRun={requestRunMonitor}
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

        <AiSummary competitor={competitor} onRefresh={refresh} />

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
                overview={overview}
                monitors={monitors}
                scrapingIds={scrapingIds}
                onRun={requestRunMonitor}
                onOpenTab={selectTab}
              />
            </TabsContent>
            <TabsContent value="activity" className={TAB_PANEL_CLASS}>
              <ActivityTab
                signals={recentSignals}
                changes={recentChanges}
                onRefresh={refresh}
                competitorUrl={competitor.url}
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
                onRefresh={refresh}
                refreshTick={refreshTick}
              />
            </TabsContent>
            <TabsContent value="hiring" className={TAB_PANEL_CLASS}>
              <HiringTab
                competitorId={id}
                monitors={monitors}
                scrapingIds={scrapingIds}
                onRun={requestRunMonitor}
                onEnable={enableMonitor}
                refreshTick={refreshTick}
              />
            </TabsContent>
            <TabsContent value="reviews" className={TAB_PANEL_CLASS}>
              <ReviewsTab
                competitorId={id}
                monitors={monitors}
                scrapingIds={scrapingIds}
                onRun={requestRunMonitor}
                onEnable={enableMonitor}
                onEdit={editMonitor}
                onSwitch={switchReviewSource}
                refreshTick={refreshTick}
                plan={plan}
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
  onDelete,
}: {
  competitor: Competitor;
  lastRunMs: number;
  onDelete: () => void;
}) {
  return (
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
            <h1 className="font-bold text-title-lg md:text-stat tracking-tight leading-[1.05] m-0">
              {competitor.name}
            </h1>
            {competitor.category && (
              <Badge variant="outline" className="text-meta uppercase tracking-wide font-medium">
                {competitor.category}
              </Badge>
            )}
            {competitor.overlapScore != null && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" aria-label="About overlap" className="cursor-help">
                    <Badge variant="outline" className="gap-1.5 py-1 font-mono text-micro tracking-widest">
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
            <div className="text-xs text-muted-foreground font-mono mt-1">
              last activity {formatDistanceToNow(new Date(lastRunMs), { addSuffix: true })}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
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
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onDelete} className="text-critical focus:text-critical">
              <Trash2 size={13} /> Delete competitor
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function SourceStatusIcon({ status }: { status: MonitorStatus }) {
  if (status === "running")
    return <Loader2 size={13} className="animate-spin text-muted-foreground shrink-0" />;
  if (status === "failed") return <AlertCircle size={13} className="text-critical shrink-0" />;
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
                : status === "failed" && m.lastFailedAt
                  ? `failed ${formatDistanceToNow(new Date(m.lastFailedAt), { addSuffix: true })}`
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
                    "text-xs font-mono",
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
              <span className="text-xs font-mono text-muted-foreground">
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
  onConfigure,
}: {
  monitor: Monitor;
  running: boolean;
  status: MonitorStatus;
  onRun: (id: string) => void;
  onConfigure: () => void;
}) {
  const failed = status === "failed";
  const ageLabel =
    status === "running"
      ? "…"
      : failed
        ? null
        : status === "ok" && m.lastRunAt
          ? shortAge(new Date(m.lastRunAt))
          : "never";
  const ageText =
    status === "running"
      ? "scraping…"
      : failed && m.lastFailedAt
        ? `failed ${formatDistanceToNow(new Date(m.lastFailedAt), { addSuffix: true })}`
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
              : "border-border text-foreground hover:bg-accent",
          )}
        >
          <SourceStatusIcon status={status} />
          <span className="font-medium">{sourceShortLabel(m.sourceType)}</span>
          {ageLabel && (
            <span
              className={cn(
                "font-mono text-meta",
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
            "px-2 pb-1 text-xs font-mono",
            failed ? "text-critical/80" : "text-muted-foreground",
          )}
        >
          {ageText}
        </p>
        {failed && m.lastError && (
          <p className="px-2 pb-1.5 text-xs leading-relaxed text-critical/80 break-words">
            {friendlyScrapeError(m.lastError, m.sourceType)}
          </p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onRun(m.id)} disabled={running}>
          {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          {running ? "Scraping…" : "Run now"}
        </DropdownMenuItem>
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
function FrequencyButton({
  freq,
  plan,
  selected,
  disabled,
  onSelect,
  onLocked,
}: {
  freq: MonitorFrequency;
  plan: Plan;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  onLocked: () => void;
}) {
  const locked = !planIncludesFrequency(plan, freq);
  return (
    <Button
      type="button"
      size="sm"
      variant={selected ? "default" : "outline"}
      onClick={() => (locked ? onLocked() : onSelect())}
      disabled={disabled}
      className="h-7 gap-1.5 text-xs capitalize"
    >
      {locked && <Lock size={10} className="opacity-70" />}
      {freq}
      {locked && (
        <span className="inline-flex items-center rounded bg-muted-foreground/15 px-1 py-0.5 text-meta font-medium uppercase leading-none tracking-wide text-muted-foreground">
          {PLAN_LABELS[minPlanForFrequency(freq)]}
        </span>
      )}
    </Button>
  );
}

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
  onRefresh,
}: {
  competitor: Competitor;
  onRefresh: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      await api.refreshCompetitorSummary(competitor.id);
      toast.info("Refreshing AI summary…", {
        description: "It will update in a few seconds.",
      });
      setTimeout(() => {
        onRefresh();
        setRefreshing(false);
      }, 6000);
    } catch (e) {
      toastApiError(e, { title: "Couldn't refresh the summary" });
      setRefreshing(false);
    }
  }

  if (!competitor.aiSummary) {
    return (
      <Card className="px-4 py-3 border-dashed flex items-start gap-2 justify-between">
        <div className="flex items-start gap-2 text-muted-foreground text-sm">
          <Sparkles size={13} className="mt-0.5 shrink-0" />
          <span>AI summary not generated yet.</span>
        </div>
        <Button size="sm" variant="secondary" onClick={refresh} disabled={refreshing} className="h-7 text-xs">
          {refreshing ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
          {refreshing ? "Generating…" : "Generate now"}
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
          onClick={refresh}
          disabled={refreshing}
          className="h-7 text-xs text-muted-foreground"
        >
          {refreshing ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {refreshing ? "Refreshing" : "Refresh"}
        </Button>
      </div>
      <p className="text-content leading-relaxed text-foreground/90">{competitor.aiSummary}</p>
      {competitor.aiSummaryUpdatedAt && (
        <p className="text-xs font-mono text-muted-foreground mt-2">
          updated {formatDistanceToNow(new Date(competitor.aiSummaryUpdatedAt), { addSuffix: true })}
        </p>
      )}
    </Card>
  );
}

// Per-source AI summary block, shown at the top of the structured tabs
// (pricing/hiring/reviews). Populated by the extract-* jobs on every scrape, so
// the user sees what was captured — and what moved — even on the first scrape.
// Collapsed by default: the AI summary is valuable but often restates data shown
// elsewhere on the tab, so it costs one line until the user opens it.
function SourceSummary({
  summary,
  updatedAt,
}: {
  summary: string | null | undefined;
  updatedAt: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  if (!summary) return null;
  return (
    <TabSection>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <Sparkles size={14} className="shrink-0 text-muted-foreground" />
        <span className="text-content font-semibold tracking-tight leading-tight">
          What we found
        </span>
        <ChevronDown
          size={14}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
        {updatedAt && (
          <span className="ml-auto text-xs font-mono text-muted-foreground">
            {formatDistanceToNow(new Date(updatedAt), { addSuffix: true })}
          </span>
        )}
      </button>
      {open && (
        <p className="text-content leading-relaxed text-foreground/90">{summary}</p>
      )}
    </TabSection>
  );
}

type DiffLine = { kind: "add" | "remove"; text: string };

function parseDiff(diffText: string, maxLines = 18): { lines: DiffLine[]; truncated: boolean } {
  const lines: DiffLine[] = [];
  for (const raw of diffText.split("\n")) {
    const trimmed = raw.trimEnd();
    if (!trimmed) continue;
    const kind: "add" | "remove" | null =
      trimmed.startsWith("+ ") ? "add" : trimmed.startsWith("- ") ? "remove" : null;
    if (!kind) continue;
    const text = stripHtml(trimmed.slice(2)).trim();
    if (!text) continue;
    lines.push({ kind, text });
    if (lines.length >= maxLines) break;
  }
  return { lines, truncated: lines.length >= maxLines };
}

function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ");
}

function ChangeCard({
  change,
  onRefresh,
  fallbackUrl,
  insight,
}: {
  change: ChangeRow;
  onRefresh?: () => void;
  fallbackUrl?: string;
  insight?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [classifying, setClassifying] = useState(false);
  // Prefer the strategic signal insight (when this change became a signal) over
  // the change's own classification summary.
  const summary = insight && insight.trim().length > 0 ? insight : change.summary;
  const hasSummary = !!summary && summary.trim().length > 0;

  async function classify() {
    setClassifying(true);
    try {
      await api.classifyChange(change.id);
      toast.info("Classifying change with AI…", {
        description: "Refreshing in a few seconds.",
      });
      setTimeout(() => {
        onRefresh?.();
        setClassifying(false);
      }, 4000);
    } catch (e) {
      toastApiError(e, { title: "Couldn't classify that change" });
      setClassifying(false);
    }
  }

  const pageUrl = change.monitorUrl ?? fallbackUrl ?? null;
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 mb-2 text-xs">
        <Badge variant="outline" className="text-meta uppercase tracking-wide font-medium px-2 py-0">
          {change.sourceType}
        </Badge>
        <span className="text-muted-foreground font-mono text-meta">
          · {formatDistanceToNow(new Date(change.detectedAt), { addSuffix: true })}
        </span>
        {pageUrl && (
          <a
            href={pageUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            View page <ExternalLink size={12} />
          </a>
        )}
      </div>

      {hasSummary ? (
        <p className="text-sm leading-relaxed text-foreground">{summary}</p>
      ) : (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-dense text-muted-foreground italic">
            No AI summary yet — classification was never run for this change.
          </p>
          <Button
            size="sm"
            variant="secondary"
            disabled={classifying}
            onClick={classify}
            className="h-7 text-xs"
          >
            {classifying ? (
              <>
                <Loader2 size={11} className="animate-spin" /> Classifying…
              </>
            ) : (
              <>
                <Sparkles size={11} /> Classify with AI
              </>
            )}
          </Button>
        </div>
      )}

      {change.diffText && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {open ? "Hide raw diff" : "Show raw diff"}
          </button>
          {open && (
            <div className="mt-2 pt-2 border-t border-border/50">
              <DiffPreview diffText={change.diffText} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DiffPreview({ diffText }: { diffText: string }) {
  const { lines, truncated } = useMemo(() => parseDiff(diffText), [diffText]);
  if (lines.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        Only HTML/markup differences — nothing meaningful to display.
      </p>
    );
  }
  const added = lines.filter((l) => l.kind === "add").length;
  const removed = lines.filter((l) => l.kind === "remove").length;
  return (
    <div className="flex flex-col gap-1.5">
      <div className={cn("flex items-center gap-3", eyebrowClass("micro"))}>
        {added > 0 && <span className="text-positive">+ {added} added</span>}
        {removed > 0 && <span className="text-critical">− {removed} removed</span>}
      </div>
      <ul className="flex flex-col gap-1 text-dense leading-relaxed">
        {lines.map((l, i) => (
          <li
            key={i}
            className={cn(
              "px-2 py-1 rounded-sm font-normal flex gap-2",
              l.kind === "add" && "bg-positive/[0.08] text-foreground",
              l.kind === "remove" && "bg-critical/[0.08] text-foreground",
            )}
          >
            <span
              className={cn(
                "font-mono shrink-0 select-none",
                l.kind === "add" ? "text-positive" : "text-critical",
              )}
            >
              {l.kind === "add" ? "+" : "−"}
            </span>
            <span className="break-words min-w-0">{l.text}</span>
          </li>
        ))}
      </ul>
      {truncated && (
        <p className={eyebrowClass("micro")}>… more changes truncated</p>
      )}
    </div>
  );
}

// Compact summary cell (pricing / hiring / reviews) whose header links through to
// the matching detail tab. Rendered as a cell inside one bordered strip — not its
// own card — so the three read as a single unit instead of three stacked boxes.
function OverviewStat({
  icon: Icon,
  label,
  onClick,
  children,
}: {
  icon: typeof Activity;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <Icon size={11} /> {label} <ChevronRight size={11} />
      </button>
      <div>{children}</div>
    </div>
  );
}

function formatTierPrice(p: { price: number; currency: string; billing_period: string }): string {
  if (p.price === 0) return "Free";
  const sym =
    p.currency === "USD" ? "$" : p.currency === "EUR" ? "€" : p.currency === "GBP" ? "£" : "";
  const amount = sym ? `${sym}${p.price}` : `${p.price} ${p.currency}`;
  const per =
    p.billing_period === "monthly" ? "/mo" : p.billing_period === "yearly" ? "/yr" : "";
  return `${amount}${per}`;
}

// A captured customer logo carries a brand name (from <img alt>) and/or a resolved
// absolute image URL (`src`). Prefer rendering the real logo image — it reads far
// better than a text badge — and fall back to the name only when there's no usable
// image (no src, a non-absolute src, or the image failed to load).
function isRenderableLogoSrc(value: string): boolean {
  return /^(https?:\/\/|data:image\/)/i.test(value.trim());
}

function logoLabel(value: string): string {
  const v = value.trim();
  if (!v || /^data:/i.test(v)) return "";
  const looksLikePath =
    /^(https?:|\/\/|\/|\.\.?\/)/i.test(v) ||
    /\.(png|jpe?g|svg|webp|gif|avif|ico)(\?|#|$)/i.test(v);
  if (!looksLikePath) return v; // already a brand name (alt text)
  const file = (v.split(/[?#]/)[0] ?? v).split("/").filter(Boolean).pop() ?? v;
  return file
    .replace(/\.(png|jpe?g|svg|webp|gif|avif|ico)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function LogoChip({ logo }: { logo: { name: string | null; src: string | null } }) {
  const [failed, setFailed] = useState(false);
  const src = logo.src?.trim() || "";
  // Name to label/alt the logo: the brand name when captured, else derived from
  // the image filename so a path-only logo still reads as something.
  const name = logo.name?.trim() || (src ? logoLabel(src) : "");
  const showImage = !!src && isRenderableLogoSrc(src) && !failed;
  if (!showImage && !name) return null;

  // Logos are scraped artwork only — we don't know each customer's real URL, so
  // the chip is non-interactive (no tooltip, no link) to avoid surfacing wrong info.
  return showImage ? (
    // Fixed white plate: customer logos are dark artwork made for light site
    // backgrounds and would vanish on the (dark) dashboard surface otherwise.
    <span className="inline-flex h-7 items-center rounded-md border border-border bg-white px-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary external logo URL, next/image can't whitelist competitor domains */}
      <img
        src={src}
        alt={name || "Customer logo"}
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-4 max-w-[96px] object-contain"
      />
    </span>
  ) : (
    <Badge variant="outline" className="text-xs font-normal">
      {name}
    </Badge>
  );
}

// State view ("fact sheet") — what this competitor says about itself right now:
// positioning, value props, customers, claims, all surfaced from the latest
// homepage capture, plus a compact pricing/hiring/reviews summary. AI summary,
// tech stack and KPIs already live above the tabs, so they're not repeated here.
function OverviewTab({
  overview,
  monitors,
  scrapingIds,
  onRun,
  onOpenTab,
}: {
  overview: CompetitorOverview;
  monitors: Monitor[];
  scrapingIds: Set<string>;
  onRun: (id: string) => void;
  onOpenTab: (tab: TabKey) => void;
}) {
  const { homepage, numericClaims, pricingNow, reviews, hiring, capturedAt } = overview;
  const hasFacts =
    !!homepage &&
    !!(
      homepage.headline ||
      homepage.subheadline ||
      homepage.valueProps.length > 0 ||
      homepage.customerLogos.length > 0 ||
      homepage.testimonials.length > 0
    );
  const hasAnything =
    hasFacts ||
    numericClaims.length > 0 ||
    pricingNow.length > 0 ||
    reviews.length > 0 ||
    hiring.openRoles > 0;

  if (!hasAnything) {
    const homepageMonitor = monitors.find((m) => m.sourceType === "homepage");
    const running = homepageMonitor ? scrapingIds.has(homepageMonitor.id) : false;
    return (
      <Card className="px-6 py-10 text-center border-dashed flex flex-col items-center gap-3">
        <p className="text-sm font-semibold text-foreground">Nothing captured yet</p>
        <p className="text-dense text-muted-foreground max-w-md">
          Once the homepage is scraped, this is where you&apos;ll see what this
          competitor says about itself — positioning, value props, customers and
          pricing — at a glance.
        </p>
        {homepageMonitor && (
          <Button size="sm" disabled={running} onClick={() => onRun(homepageMonitor.id)}>
            {running ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Scraping…
              </>
            ) : (
              <>
                <Play size={12} /> Scrape homepage now
              </>
            )}
          </Button>
        )}
      </Card>
    );
  }

  return (
    <TabCard>
      {homepage && (homepage.headline || homepage.subheadline) && (
        <TabSection>
          {homepage.headline && (
            <p className="text-lead font-semibold leading-snug tracking-tight text-balance">
              {homepage.headline}
            </p>
          )}
          {homepage.subheadline && (
            <p className="text-content text-muted-foreground leading-relaxed max-w-2xl">
              {homepage.subheadline}
            </p>
          )}
        </TabSection>
      )}

      {homepage && homepage.valueProps.length > 0 && (
        <TabSection title="What they highlight" icon={FileText}>
          <ul className="flex flex-col gap-2">
            {homepage.valueProps.map((v, i) => (
              <li key={i} className="text-content leading-relaxed flex gap-2.5">
                <span className="text-primary shrink-0 mt-px">•</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </TabSection>
      )}

      {homepage && (homepage.customerLogos.length > 0 || homepage.testimonials.length > 0) && (
        <TabSection title="Customers & proof" icon={Users}>
          {homepage.customerLogos.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {homepage.customerLogos.map((l, i) => (
                <LogoChip key={i} logo={l} />
              ))}
            </div>
          )}
          {homepage.testimonials.length > 0 && (
            <ul className="flex flex-col gap-3 mt-1">
              {homepage.testimonials.map((t, i) => (
                <li key={i} className="border-l border-border pl-3.5">
                  <p className="text-content italic leading-relaxed">“{t.quote}”</p>
                  {t.author && (
                    <p className="text-xs font-mono text-muted-foreground mt-1">
                      — {t.author}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </TabSection>
      )}

      {numericClaims.length > 0 && (
        <TabSection title="Claims" icon={Activity}>
          <div className="flex flex-wrap gap-1.5">
            {numericClaims.map((cl, i) => (
              <Badge key={i} variant="secondary" className="text-xs font-normal">
                {cl.raw_text}
              </Badge>
            ))}
          </div>
        </TabSection>
      )}

      <TabSection title="At a glance" icon={LayoutGrid}>
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
        <OverviewStat icon={DollarSign} label="Pricing now" onClick={() => onOpenTab("pricing")}>
          {pricingNow.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {pricingNow.slice(0, 4).map((p, i) => (
                <li
                  key={i}
                  className="text-dense flex items-baseline justify-between gap-2"
                >
                  <span className="truncate">{p.plan_name}</span>
                  <span className="font-mono tabular-nums shrink-0">{formatTierPrice(p)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-dense text-muted-foreground">Not captured</span>
          )}
        </OverviewStat>

        <OverviewStat icon={Briefcase} label="Open roles" onClick={() => onOpenTab("hiring")}>
          {hiring.openRoles > 0 ? (
            <span className="text-title-lg font-bold font-mono tabular-nums leading-none">
              {hiring.openRoles}
            </span>
          ) : (
            <span className="text-dense text-muted-foreground">None tracked</span>
          )}
        </OverviewStat>

        <OverviewStat icon={Star} label="Reviews" onClick={() => onOpenTab("reviews")}>
          {reviews.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {reviews.slice(0, 2).map((r, i) => (
                <div
                  key={i}
                  className="text-dense flex items-baseline justify-between gap-2"
                >
                  <Eyebrow size="micro">{r.source}</Eyebrow>
                  <span className="inline-flex items-center gap-0.5 font-mono tabular-nums">
                    {r.score.toFixed(1)}
                    <Star className="size-3 fill-current" />
                    <span className="text-muted-foreground">({r.review_count})</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-dense text-muted-foreground">Not captured</span>
          )}
        </OverviewStat>
      </div>

      {capturedAt && (
        <p className="text-xs font-mono text-muted-foreground">
          homepage facts captured {formatDistanceToNow(new Date(capturedAt), { addSuffix: true })}
        </p>
      )}
      </TabSection>
    </TabCard>
  );
}

function ActivityTab({
  signals,
  changes,
  onRefresh,
  competitorUrl,
}: {
  signals: CompetitorSignal[];
  changes: ChangeRow[];
  onRefresh?: () => void;
  competitorUrl: string;
}) {
  if (signals.length === 0 && changes.length === 0) {
    return (
      <Card className="px-6 py-10 text-center border-dashed flex flex-col items-center gap-2.5">
        <p className="text-sm font-semibold text-foreground">No activity yet</p>
        <p className="text-dense text-muted-foreground max-w-md">
          Activity will appear once a monitor detects a change. Scrape from the
          Monitors section above to start tracking.
        </p>
      </Card>
    );
  }
  const signalChangeIds = new Set(signals.map((s) => s.changeId).filter(Boolean));
  const orphanChanges = changes.filter((c) => !signalChangeIds.has(c.id));
  return (
    <TabCard>
      {signals.length > 0 && (
        <TabSection title="Recent activity" icon={Activity}>
        <ul className="flex flex-col divide-y divide-border">
          {signals.map((s) => {
            const pageUrl = s.monitorUrl ?? competitorUrl;
            return (
              <li key={s.id} className="flex flex-col py-3.5 first:pt-0 last:pb-0">
                <div className="flex items-center gap-2 mb-1.5 text-xs flex-wrap">
                  <Badge
                    className={cn(
                      "uppercase tracking-wide text-meta font-bold px-2 py-0",
                      SEVERITY_CLASS[s.severity],
                    )}
                  >
                    {s.severity}
                  </Badge>
                  <Eyebrow size="micro">{s.category}</Eyebrow>
                  <span className="text-muted-foreground font-mono text-meta">
                    · {formatDistanceToNow(new Date(s.createdAt), { addSuffix: true })}
                  </span>
                  <a
                    href={pageUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    View page <ExternalLink size={12} />
                  </a>
                </div>
                <p className="text-sm mb-1">{s.insight}</p>
                {s.soWhat && (
                  <p className="flex gap-1 text-muted-foreground text-dense mb-1">
                    <ArrowRight className="size-3 mt-0.5 shrink-0" />
                    {s.soWhat}
                  </p>
                )}
                {s.recommendedAction && (
                  <p className="text-foreground text-dense font-medium">
                    Action: {s.recommendedAction}
                  </p>
                )}
                <div className="mt-2.5 pt-2.5 border-t border-border">
                  <SignalSourceLine
                    signalId={s.id}
                    sourceType={s.sourceType}
                    detectedAt={s.createdAt}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        </TabSection>
      )}

      {orphanChanges.length > 0 && (
        <TabSection title="Detected changes · not classified as signals">
          <ul className="flex flex-col divide-y divide-border">
            {orphanChanges.map((c) => (
              <li key={c.id} className="py-3.5 first:pt-0 last:pb-0">
                <ChangeCard change={c} onRefresh={onRefresh} fallbackUrl={competitorUrl} />
              </li>
            ))}
          </ul>
        </TabSection>
      )}
    </TabCard>
  );
}

type MonitorSourceProps = {
  monitors: Monitor[];
  scrapingIds: Set<string>;
  onRun: (id: string) => void;
  onEnable?: (source: SourceType, url?: string) => Promise<void>;
};

function MonitorEmptyState({
  source,
  label,
  monitors,
  scrapingIds,
  onRun,
  onEnable,
}: {
  source: SourceType;
  label: string;
} & MonitorSourceProps) {
  const [enabling, setEnabling] = useState(false);
  const monitor = monitors.find((m) => m.sourceType === source);
  if (!monitor) {
    return (
      <Card className="px-6 py-10 text-center border-dashed flex flex-col items-center gap-3">
        <p className="text-sm font-semibold text-foreground">
          No {label} monitoring yet
        </p>
        <p className="text-dense text-muted-foreground max-w-md">
          This competitor isn&apos;t tracking {label} yet. Enable it to start
          capturing {label} data — we&apos;ll run the first scrape right away.
          Requires a plan that includes this source.
        </p>
        {onEnable && (
          <Button
            size="sm"
            onClick={async () => {
              setEnabling(true);
              try {
                await onEnable(source);
              } finally {
                setEnabling(false);
              }
            }}
            disabled={enabling}
          >
            {enabling ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Enabling…
              </>
            ) : (
              <>
                <Plus size={12} /> Enable {label} monitoring
              </>
            )}
          </Button>
        )}
      </Card>
    );
  }
  const running = scrapingIds.has(monitor.id);
  return (
    <Card className="px-6 py-10 text-center border-dashed flex flex-col items-center gap-3">
      <p className="text-sm font-semibold text-foreground">No {label} data yet</p>
      <p className="text-dense text-muted-foreground max-w-md">
        {monitor.lastRunAt
          ? `Monitor was scraped ${formatDistanceToNow(new Date(monitor.lastRunAt), { addSuffix: true })}, but no ${label} data was extracted. The source page may not expose this data.`
          : `This monitor has never been scraped. Run it now to extract ${label} data.`}
      </p>
      <Button
        size="sm"
        variant={running ? "secondary" : "default"}
        onClick={() => onRun(monitor.id)}
        disabled={running}
      >
        {running ? (
          <>
            <Loader2 size={12} className="animate-spin" /> Scraping…
          </>
        ) : (
          <>
            <Play size={12} /> Scrape now
          </>
        )}
      </Button>
    </Card>
  );
}

function PricingTab({
  competitor,
  competitorId,
  monitors,
  scrapingIds,
  onRun,
  onEnable,
  onRefresh,
  refreshTick,
}: {
  competitor: Competitor;
  competitorId: string;
  refreshTick?: number;
  onRefresh: () => void;
} & MonitorSourceProps) {
  const [history, setHistory] = useState<PricingHistoryPoint[] | null>(null);
  // Our own product, for the You-vs-them pricing comparison (best-effort — its
  // absence just hides the comparison, it never blocks the competitor's pricing).
  const [myProduct, setMyProduct] = useState<MyProduct | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .getCompetitorPricingHistory(competitorId)
      .then((r) => setHistory(r.history))
      .catch((e) => setErr(String(e)));
    api
      .getMyProduct()
      .then((r) => setMyProduct(r.product))
      .catch(() => {});
  }, [competitorId, refreshTick]);

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

  if (err) return <Empty text="Couldn't load this data right now — try again in a moment." />;
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
  const sorted = [...history].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime(),
  );
  const latestByPlan = new Map<string, PricingHistoryPoint>();
  const firstByPlan = new Map<string, PricingHistoryPoint>();
  for (const p of sorted) latestByPlan.set(p.plan_name, p);
  for (const p of sorted) if (!firstByPlan.has(p.plan_name)) firstByPlan.set(p.plan_name, p);

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
          const delta = latest.price - first.price;
          const pct = first.price > 0 ? (delta / first.price) * 100 : 0;
          return (
            <li
              key={plan}
              className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <div className="flex items-baseline gap-2 min-w-0">
                <Eyebrow size="micro" className="shrink-0">
                  {plan}
                </Eyebrow>
                <span className="text-sm font-semibold tabular-nums">
                  {latest.price} {latest.currency}
                  <span className="text-xs text-muted-foreground font-mono font-normal">
                    {" "}
                    / {latest.billing_period}
                  </span>
                </span>
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
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={series.points}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="var(--muted)" fontSize={11} />
                <YAxis stroke="var(--muted)" fontSize={11} />
                <ChartTooltip
                  contentStyle={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {plans.map((plan, i) => (
                  <Line
                    key={plan}
                    type="monotone"
                    dataKey={plan}
                    stroke={lineColor(i)}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </TabSection>
          {planList}
        </div>
      ) : (
        // First capture, no trend yet: skip the one-dot chart. Show the bare tier
        // list only when no comparison already lists those prices above.
        !myProduct && planList
      )}
    </TabCard>
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

type TierLite = { price: number; currency: string; billing_period: string };

// Outcome of comparing our tier to theirs: either a % (positive = we're pricier),
// flagged when it required a currency conversion, or null with a human reason the
// pair can't be compared — so the cell explains itself instead of a bare dash.
type TierCmp = { pct: number; converted: boolean } | { pct: null; reason: string };

function compareTiers(
  mine: TierLite,
  theirs: TierLite,
  rates: Record<string, number> | null,
): TierCmp {
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
  const oursSorted = [...ours].sort((a, b) => a.price - b.price);
  const theirsSorted = [...theirs].sort((a, b) => a.price - b.price);

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
  if (theirEntry.price === 0 && ourEntry.price > 0) {
    lines.push(`${competitorName} offers a free tier — you don't.`);
  } else if (ourEntry.price === 0 && theirEntry.price > 0) {
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
  tier: { plan_name: string; price: number; currency: string; billing_period: string };
}) {
  return (
    <div className="flex items-baseline gap-1.5 min-w-0">
      <span className="font-semibold tabular-nums shrink-0">{formatTierPrice(tier)}</span>
      <span className="truncate text-xs text-muted-foreground">{tier.plan_name}</span>
    </div>
  );
}

// Seniority ordering (low→high) so a role list surfaces the senior bets first.
// Keys match the canonical buckets the ATS resolver emits (packages/scrapers jobs/ats).
const SENIORITY_RANK: Record<string, number> = {
  executive: 8,
  lead: 7,
  principal: 6,
  staff: 5,
  senior: 4,
  mid: 3,
  junior: 2,
  intern: 1,
};

// Rank at/above which a role counts as a "senior+" bet (senior, staff, principal,
// lead, executive) — a leading indicator of a serious build.
const SENIOR_PLUS_THRESHOLD = 4;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const CURRENCY_SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", INR: "₹" };

// Compact money for a hiring badge, e.g. 120000 USD → "$120k".
function formatMoney(n: number, currency: string | null): string {
  const sym = CURRENCY_SYMBOL[currency ?? ""] ?? "";
  const compact = n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n));
  if (sym) return `${sym}${compact}`;
  return currency ? `${compact} ${currency}` : compact;
}

// Salary range label for one role, or null when the ATS exposed no compensation.
function salaryLabel(r: {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
}): string | null {
  if (r.salaryMin == null && r.salaryMax == null) return null;
  if (r.salaryMin != null && r.salaryMax != null && r.salaryMin !== r.salaryMax) {
    return `${formatMoney(r.salaryMin, r.salaryCurrency)}–${formatMoney(r.salaryMax, r.salaryCurrency)}`;
  }
  return formatMoney((r.salaryMin ?? r.salaryMax)!, r.salaryCurrency);
}

function HiringTab({
  competitorId,
  monitors,
  scrapingIds,
  onRun,
  onEnable,
  refreshTick,
}: { competitorId: string; refreshTick?: number } & MonitorSourceProps) {
  const [jobs, setJobs] = useState<JobsByDepartment | null>(null);
  const [trends, setTrends] = useState<JobTrendPoint[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    api
      .getCompetitorJobs(competitorId)
      .then((j) => !cancelled && setJobs(j))
      .catch((e) => !cancelled && setErr(String(e)));
    api
      .getCompetitorJobTrends(competitorId)
      .then((t) => !cancelled && setTrends(t.trends))
      .catch((e) => !cancelled && setErr(String(e)));
    return () => {
      cancelled = true;
    };
  }, [competitorId, refreshTick]);

  if (err) return <Empty text="Couldn't load this data right now — try again in a moment." />;
  if (!jobs || !trends) return <TabLoading />;
  if (jobs.total === 0) {
    return (
      <MonitorEmptyState
        source="jobs"
        label="hiring"
        monitors={monitors}
        scrapingIds={scrapingIds}
        onRun={onRun}
        onEnable={onEnable}
      />
    );
  }

  const trendByDept = buildJobTrend(trends);
  const jobsMonitor = monitors.find((m) => m.sourceType === "jobs");

  // Flatten every open role and surface the senior bets first. Each role carries
  // its department so the flat list stays readable without the grouping.
  const allRoles = jobs.departments
    .flatMap((d) => d.jobs.map((j) => ({ ...j, dept: d.department })))
    .sort(
      (a, b) =>
        (SENIORITY_RANK[b.seniority ?? ""] ?? 0) - (SENIORITY_RANK[a.seniority ?? ""] ?? 0) ||
        a.title.localeCompare(b.title),
    );

  // Strategic recap (patch-32 enrichment): how many senior+ bets, and the salary
  // band the ATS disclosed. Both are leading indicators of budget / maturity —
  // hiring Staff/Principal or posting high bands signals a serious build.
  const seniorPlus = allRoles.filter(
    (r) => (SENIORITY_RANK[r.seniority ?? ""] ?? 0) >= SENIOR_PLUS_THRESHOLD,
  ).length;
  const withSalary = allRoles.filter((r) => r.salaryMin != null || r.salaryMax != null);
  const salaryLows = withSalary
    .map((r) => r.salaryMin ?? r.salaryMax)
    .filter((n): n is number => n != null);
  const salaryHighs = withSalary
    .map((r) => r.salaryMax ?? r.salaryMin)
    .filter((n): n is number => n != null);
  const salaryBand =
    salaryLows.length > 0
      ? `${formatMoney(Math.min(...salaryLows), withSalary[0]!.salaryCurrency)}–${formatMoney(
          Math.max(...salaryHighs),
          withSalary[0]!.salaryCurrency,
        )}`
      : null;

  const hasTrend = Object.keys(trendByDept).length > 0;

  // Department breakdown: current open count + 90-day delta. Paired with the
  // trend chart on lg (border-l), so the two department views sit side by side
  // instead of stacking — the narrow table fills the column the wide chart frees.
  const deptTable = (
    <TabSection
      title="By department"
      icon={Briefcase}
      className={hasTrend ? "border-t border-border lg:border-t-0 lg:border-l" : undefined}
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="text-left py-2">Department</th>
            <th className="text-right py-2">Active</th>
            <th className="text-right py-2">Trend 90d</th>
          </tr>
        </thead>
        <tbody>
          {jobs.departments
            .sort((a, b) => b.count - a.count)
            .map((d) => {
              const series = trendByDept[d.department] ?? [];
              const first = series[0]?.count ?? d.count;
              const last = series[series.length - 1]?.count ?? d.count;
              const delta = last - first;
              return (
                <tr key={d.department} className="border-t border-border">
                  <td className="py-2">{d.department}</td>
                  <td className="py-2 text-right tabular-nums font-mono">{d.count}</td>
                  <td
                    className={cn(
                      "py-2 text-right tabular-nums font-mono",
                      delta === 0
                        ? "text-muted-foreground"
                        : delta > 0
                          ? "text-positive"
                          : "text-critical",
                    )}
                  >
                    {delta === 0 ? (
                      "—"
                    ) : (
                      <span className="inline-flex items-center justify-end gap-0.5">
                        {delta > 0 ? (
                          <ArrowUp className="size-3" />
                        ) : (
                          <ArrowDown className="size-3" />
                        )}
                        {delta > 0 ? `+${delta}` : delta}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </TabSection>
  );

  return (
    <TabCard>
      <SourceSummary
        summary={jobsMonitor?.aiSummary}
        updatedAt={jobsMonitor?.aiSummaryUpdatedAt}
      />

      {hasTrend ? (
        <div className="grid lg:grid-cols-2">
          <TabSection title="90-day trend" icon={Activity}>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={mergeTrendsByDate(trends)}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="var(--muted)" fontSize={11} />
                <YAxis stroke="var(--muted)" fontSize={11} allowDecimals={false} />
                <ChartTooltip
                  contentStyle={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {Object.keys(trendByDept).map((dept, i) => (
                  <Line
                    key={dept}
                    type="monotone"
                    dataKey={dept}
                    stroke={lineColor(i)}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </TabSection>
          {deptTable}
        </div>
      ) : (
        deptTable
      )}

      <TabSection title="Roles" icon={Briefcase}>
        {(seniorPlus > 0 || salaryBand) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground tabular-nums">{seniorPlus}</span> of{" "}
              <span className="tabular-nums">{allRoles.length}</span> senior+
            </span>
            {salaryBand && (
              <span>
                Salary observed:{" "}
                <span className="font-medium text-foreground tabular-nums font-mono">
                  {salaryBand}
                </span>
              </span>
            )}
          </div>
        )}
        {/* Two columns on sm+: the flat role list is the tallest block, so
            splitting it across columns roughly halves the tab's height. */}
        <ul className="grid gap-x-8 sm:grid-cols-2">
          {allRoles.map((role) => {
            const salary = salaryLabel(role);
            return (
              <li
                key={role.id}
                className="flex items-start justify-between gap-3 border-b border-border py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {role.url ? (
                      <a
                        href={role.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-dense font-medium hover:underline underline-offset-2 inline-flex items-center gap-1"
                      >
                        {role.title}
                        <ExternalLink size={12} className="text-muted-foreground shrink-0" />
                      </a>
                    ) : (
                      <span className="text-dense font-medium">{role.title}</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {[role.dept, role.location].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {salary && (
                    <span className="tabular-nums font-mono text-xs text-foreground/85">
                      {salary}
                    </span>
                  )}
                  {role.seniority && (
                    <span className="rounded-md border border-border bg-card px-1.5 py-0.5 text-xs text-muted-foreground">
                      {capitalize(role.seniority)}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </TabSection>
    </TabCard>
  );
}

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
        <p className="text-dense text-muted-foreground max-w-md">
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

function ReviewsTab({
  competitorId,
  monitors,
  scrapingIds,
  onRun,
  onEnable,
  onEdit,
  onSwitch,
  refreshTick,
  plan,
  onLockedSource,
  onLockedFrequency,
}: {
  competitorId: string;
  refreshTick?: number;
  plan: Plan;
  onLockedSource?: (source: ReviewSourceType) => void;
  onLockedFrequency: (freq: MonitorFrequency) => void;
  onEdit: (id: string, patch: { url?: string; frequency?: MonitorFrequency }) => Promise<void>;
  onSwitch: (oldMonitorId: string, source: SourceType, url: string) => Promise<void>;
} & MonitorSourceProps) {
  const [reviews, setReviews] = useState<ReviewsData | null>(null);
  const [scores, setScores] = useState<ReviewScorePoint[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    api
      .getCompetitorReviews(competitorId)
      .then((r) => !cancelled && setReviews(r))
      .catch((e) => !cancelled && setErr(String(e)));
    api
      .getCompetitorReviewScores(competitorId)
      .then((s) => !cancelled && setScores(s.scores))
      .catch((e) => !cancelled && setErr(String(e)));
    return () => {
      cancelled = true;
    };
  }, [competitorId, refreshTick]);

  if (err) return <Empty text="Couldn't load this data right now — try again in a moment." />;
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
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={series.points}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis dataKey="date" stroke="var(--muted)" fontSize={11} />
                    <YAxis domain={[0, 5]} stroke="var(--muted)" fontSize={11} />
                    <ChartTooltip
                      contentStyle={{
                        background: "var(--bg)",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {series.sources.map((src, i) => (
                      <Line
                        key={src}
                        type="monotone"
                        dataKey={src}
                        stroke={lineColor(i)}
                        strokeWidth={2}
                        dot
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
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

const CONTENT_SOURCES = new Set(["homepage", "blog", "changelog"]);

function ContentTab({
  changes,
  signals,
  monitors,
  scrapingIds,
  onRun,
  onRefresh,
  competitorUrl,
}: {
  changes: ChangeRow[];
  signals: CompetitorSignal[];
  onRefresh?: () => void;
  competitorUrl: string;
} & MonitorSourceProps) {
  const contentChanges = changes.filter((c) => CONTENT_SOURCES.has(c.sourceType));
  const contentMonitors = monitors.filter((m) => CONTENT_SOURCES.has(m.sourceType));
  // A content change that became a signal shows the strategic insight instead of
  // the plain classification summary.
  const insightByChangeId = new Map<string, string>();
  for (const s of signals) {
    if (s.changeId) insightByChangeId.set(s.changeId, s.insight);
  }

  if (contentChanges.length === 0) {
    if (contentMonitors.length === 0) {
      return (
        <Empty
          text="No content monitor configured."
          hint="Content tracking covers homepage, blog and changelog. None of these sources is enabled for this competitor."
        />
      );
    }
    const preferred =
      contentMonitors.find((m) => m.sourceType === "homepage") ??
      contentMonitors.find((m) => m.sourceType === "blog") ??
      contentMonitors[0]!;
    const running = scrapingIds.has(preferred.id);
    return (
      <Card className="px-6 py-10 text-center border-dashed flex flex-col items-center gap-3">
        <p className="text-sm font-semibold text-foreground">No content changes yet</p>
        <p className="text-dense text-muted-foreground max-w-md">
          {preferred.lastRunAt
            ? `The ${preferred.sourceType} monitor was scraped ${formatDistanceToNow(new Date(preferred.lastRunAt), { addSuffix: true })} — no change since.`
            : `The ${preferred.sourceType} monitor has never been scraped. Run it now.`}
        </p>
        <Button
          size="sm"
          variant={running ? "secondary" : "default"}
          onClick={() => onRun(preferred.id)}
          disabled={running}
        >
          {running ? (
            <>
              <Loader2 size={12} className="animate-spin" /> Scraping…
            </>
          ) : (
            <>
              <Play size={12} /> Scrape {preferred.sourceType}
            </>
          )}
        </Button>
      </Card>
    );
  }

  return (
    <TabCard>
      <TabSection title="Content changes" icon={FileText}>
        <ul className="flex flex-col divide-y divide-border">
          {contentChanges.map((c) => (
            <li key={c.id} className="py-3.5 first:pt-0 last:pb-0">
              <ChangeCard
                change={c}
                onRefresh={onRefresh}
                fallbackUrl={competitorUrl}
                insight={insightByChangeId.get(c.id)}
              />
            </li>
          ))}
        </ul>
      </TabSection>
    </TabCard>
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

function TabLoading() {
  return (
    <div className="flex flex-col gap-4">
      <ChartSkeleton height={260} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-3 flex flex-col gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-3 w-20" />
          </Card>
        ))}
      </div>
    </div>
  );
}

function Empty({ text, hint }: { text: string; hint?: string }) {
  return (
    <Card className="px-6 py-10 text-center border-dashed text-muted-foreground">
      <p className="text-sm">{text}</p>
      {hint && <p className="text-xs mt-2 max-w-md mx-auto text-muted-foreground">{hint}</p>}
    </Card>
  );
}

function lineColor(i: number): string {
  // Theme-aware data-viz palette (globals.css --chart-1..6); one series color
  // reads on both light and dark surfaces.
  return `var(--chart-${(i % 6) + 1})`;
}

function shortDate(iso: string): string {
  const d = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { day: "2-digit", month: "short" });
}

function buildPricingSeries(history: PricingHistoryPoint[]): {
  points: Array<Record<string, number | string>>;
  byPlan: Record<string, PricingHistoryPoint[]>;
} {
  const byPlan: Record<string, PricingHistoryPoint[]> = {};
  for (const p of history) {
    (byPlan[p.plan_name] ??= []).push(p);
  }
  const byDate = new Map<string, Record<string, number | string>>();
  for (const p of history) {
    const date = shortDate(p.recorded_at);
    const row = byDate.get(date) ?? { date };
    row[p.plan_name] = p.price;
    byDate.set(date, row);
  }
  const points = Array.from(byDate.values()).sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );
  return { points, byPlan };
}

function buildJobTrend(points: JobTrendPoint[]): Record<string, JobTrendPoint[]> {
  const byDept: Record<string, JobTrendPoint[]> = {};
  for (const p of points) {
    (byDept[p.department] ??= []).push(p);
  }
  return byDept;
}

function mergeTrendsByDate(points: JobTrendPoint[]): Array<Record<string, number | string>> {
  const byDate = new Map<string, Record<string, number | string>>();
  for (const p of points) {
    const date = shortDate(p.recorded_at);
    const row = byDate.get(date) ?? { date };
    row[p.department] = p.count;
    byDate.set(date, row);
  }
  return Array.from(byDate.values());
}

function buildReviewScoreSeries(points: ReviewScorePoint[]): {
  points: Array<Record<string, number | string>>;
  sources: string[];
} {
  const sources = Array.from(new Set(points.map((p) => p.source)));
  const byDate = new Map<string, Record<string, number | string>>();
  for (const p of points) {
    const date = shortDate(p.recorded_at);
    const row = byDate.get(date) ?? { date };
    row[p.source] = p.score;
    byDate.set(date, row);
  }
  return { points: Array.from(byDate.values()), sources };
}
