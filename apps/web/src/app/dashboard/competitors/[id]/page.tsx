"use client";

import { useEffect, useMemo, useRef, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  ArrowLeft,
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
  PLAN_LIMITS,
  minPlanForSource,
  minPlanForFeature,
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
  type ReviewScorePoint,
  type ReviewsData,
  type TechStackData,
  type CompetitorOverview,
} from "@/lib/api";

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
// instead of switching. Mirrors the API gates — battle cards (feature), the jobs
// source (hiring), and the cheapest review source (reviews). Tabs without a plan
// requirement (overview/activity/pricing/content/techstack) return null.
function tabLock(key: TabKey, plan: Plan): { reason: PaywallReason; minPlan: Plan } | null {
  switch (key) {
    case "battlecard":
      if (PLAN_LIMITS[plan].features.battleCards) return null;
      return {
        reason: { code: "plan_locked_feature", feature: "battleCards", plan },
        minPlan: minPlanForFeature("battleCards"),
      };
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
        <Link
          href="/dashboard/competitors"
          className="text-[13px] text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors w-fit"
        >
          <ArrowLeft size={13} /> Back
        </Link>

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
            setTab(key);
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
                  className={cn(lock && "text-muted-foreground/50 hover:text-muted-foreground/70")}
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
                  <TooltipContent side="top" className="text-[11px]">
                    Available on the {PLAN_LABELS[lock.minPlan]} plan
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </TabsList>

          <div className="mt-6">
            <TabsContent value="overview">
              <OverviewTab
                overview={overview}
                monitors={monitors}
                scrapingIds={scrapingIds}
                onRun={requestRunMonitor}
                onOpenTab={setTab}
              />
            </TabsContent>
            <TabsContent value="activity">
              <ActivityTab
                signals={recentSignals}
                changes={recentChanges}
                onRefresh={refresh}
                competitorUrl={competitor.url}
              />
            </TabsContent>
            <TabsContent value="pricing">
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
            <TabsContent value="hiring">
              <HiringTab
                competitorId={id}
                monitors={monitors}
                scrapingIds={scrapingIds}
                onRun={requestRunMonitor}
                onEnable={enableMonitor}
                refreshTick={refreshTick}
              />
            </TabsContent>
            <TabsContent value="reviews">
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
            <TabsContent value="content">
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
            <TabsContent value="techstack">
              <CompetitorTechStack techStack={techStack} />
            </TabsContent>
            <TabsContent value="battlecard">
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
      <div className="min-w-0">
        <div className="flex items-baseline gap-3 flex-wrap mb-1">
          <h1 className="font-bold text-[22px] md:text-[26px] tracking-tight leading-tight m-0">
            {competitor.name}
          </h1>
          {competitor.category && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-widest font-mono">
              {competitor.category}
            </Badge>
          )}
          {competitor.overlapScore != null && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="About overlap" className="cursor-help">
                  <Badge variant="outline" className="gap-1.5 font-mono text-[10px] tracking-widest">
                    <span className="h-1.5 w-9 overflow-hidden rounded border border-border bg-background">
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
                className="max-w-[240px] text-[11px] leading-relaxed text-pretty normal-case"
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
          className="text-[13px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 transition-colors"
        >
          {competitor.url}
          <ExternalLink size={12} />
        </a>
        {lastRunMs > 0 && (
          <div className="text-[11px] text-muted-foreground/80 font-mono mt-1">
            last activity {formatDistanceToNow(new Date(lastRunMs), { addSuffix: true })}
          </div>
        )}
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
  if (monitors.length === 0) return null;
  return (
    <Card className="divide-y divide-border overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          Sources
        </span>
        <Button
          size="sm"
          variant="default"
          onClick={onRunAll}
          disabled={disabled}
          className="h-7 text-[11px]"
        >
          {runningAll ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Play size={12} />
          )}
          Scrape all
        </Button>
      </div>
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
            <span className="font-medium text-[13px] w-[104px] truncate">{m.sourceType}</span>
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 w-12">
              {m.frequency}
            </span>
            <span
              className={cn(
                "text-[11px] font-mono",
                status === "failed" ? "text-critical/80" : "text-muted-foreground/70",
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
                    className="max-w-[280px] text-[11px] leading-relaxed text-pretty break-words"
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
                className="h-7 text-[11px] min-w-[84px]"
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
          <SourceStatusIcon status={techScraping ? "running" : techLastScrapedAt ? "ok" : "idle"} />
          <span className="font-medium text-[13px] w-[104px] truncate">tech_stack</span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 w-12">
            weekly
          </span>
          <span className="text-[11px] font-mono text-muted-foreground/70">
            {techScraping
              ? "scanning…"
              : techLastScrapedAt
                ? formatDistanceToNow(new Date(techLastScrapedAt), { addSuffix: true })
                : "never scanned"}
          </span>
          <Badge
            variant="outline"
            className="text-[8px] font-mono uppercase tracking-wider px-1 py-0 text-muted-foreground/70"
          >
            dev
          </Badge>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={onScrapeTech}
              disabled={techScraping}
              className="h-7 text-[11px] min-w-[84px]"
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
      className="h-7 gap-1.5 text-[11px] capitalize"
    >
      {locked && <Lock size={10} className="opacity-70" />}
      {freq}
      {locked && (
        <span className="inline-flex items-center rounded bg-muted-foreground/15 px-1 py-0.5 text-[8px] font-mono uppercase leading-none tracking-wider text-muted-foreground">
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
          <DialogTitle className="capitalize">Configure {monitor.sourceType}</DialogTitle>
          <DialogDescription>
            Pin the exact page to watch and how often it is checked.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
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
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Page URL (optional)
            </p>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Leave empty to auto-detect"
            />
            {trimmed !== "" && !urlValid && (
              <p className="text-[11px] text-critical/80">
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
        <div className="flex items-start gap-2 text-muted-foreground text-[13px]">
          <Sparkles size={13} className="mt-0.5 shrink-0" />
          <span>AI summary not generated yet.</span>
        </div>
        <Button size="sm" variant="secondary" onClick={refresh} disabled={refreshing} className="h-7 text-[11px]">
          {refreshing ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
          {refreshing ? "Generating…" : "Generate now"}
        </Button>
      </Card>
    );
  }
  return (
    <Card className="px-5 py-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase flex items-center gap-1.5">
          <Sparkles size={11} /> Summary
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={refresh}
          disabled={refreshing}
          className="h-6 px-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          {refreshing ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <RefreshCw size={10} />
          )}
          {refreshing ? "Refreshing" : "Refresh"}
        </Button>
      </div>
      <p className="text-[13px] leading-relaxed">{competitor.aiSummary}</p>
      {competitor.aiSummaryUpdatedAt && (
        <p className="text-[11px] font-mono text-muted-foreground/80 mt-2">
          updated {formatDistanceToNow(new Date(competitor.aiSummaryUpdatedAt), { addSuffix: true })}
        </p>
      )}
    </Card>
  );
}

// Per-source AI summary block, shown at the top of the structured tabs
// (pricing/hiring/reviews). Populated by the extract-* jobs on every scrape, so
// the user sees what was captured — and what moved — even on the first scrape.
function SourceSummary({
  summary,
  updatedAt,
}: {
  summary: string | null | undefined;
  updatedAt: string | null | undefined;
}) {
  if (!summary) return null;
  return (
    <Card className="px-4 py-3">
      <div className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase flex items-center gap-1.5 mb-1.5">
        <Sparkles size={11} /> What we found
      </div>
      <p className="text-[13px] leading-relaxed">{summary}</p>
      {updatedAt && (
        <p className="text-[11px] font-mono text-muted-foreground/80 mt-2">
          updated {formatDistanceToNow(new Date(updatedAt), { addSuffix: true })}
        </p>
      )}
    </Card>
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
    <Card className="px-3.5 py-3">
      <div className="flex items-center gap-2 mb-2 text-[11px]">
        <Badge variant="outline" className="text-[9px] font-mono uppercase tracking-wide px-2 py-0">
          {change.sourceType}
        </Badge>
        <span className="text-muted-foreground/70 font-mono text-[10px]">
          · {formatDistanceToNow(new Date(change.detectedAt), { addSuffix: true })}
        </span>
        {pageUrl && (
          <a
            href={pageUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70 hover:text-foreground transition-colors"
          >
            View page <ExternalLink size={10} />
          </a>
        )}
      </div>

      {hasSummary ? (
        <p className="text-[13px] leading-relaxed text-foreground">{summary}</p>
      ) : (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[12px] text-muted-foreground/70 italic">
            No AI summary yet — classification was never run for this change.
          </p>
          <Button
            size="sm"
            variant="secondary"
            disabled={classifying}
            onClick={classify}
            className="h-7 text-[11px]"
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
            className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70 hover:text-foreground transition-colors"
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
    </Card>
  );
}

function DiffPreview({ diffText }: { diffText: string }) {
  const { lines, truncated } = useMemo(() => parseDiff(diffText), [diffText]);
  if (lines.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground/70 italic">
        Only HTML/markup differences — nothing meaningful to display.
      </p>
    );
  }
  const added = lines.filter((l) => l.kind === "add").length;
  const removed = lines.filter((l) => l.kind === "remove").length;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/80">
        {added > 0 && <span className="text-positive">+ {added} added</span>}
        {removed > 0 && <span className="text-critical">− {removed} removed</span>}
      </div>
      <ul className="flex flex-col gap-1 text-[12px] leading-relaxed">
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
        <p className="text-[10px] font-mono text-muted-foreground/70 uppercase tracking-widest">
          … more changes truncated
        </p>
      )}
    </div>
  );
}

// Small section label shared by the Overview fact-sheet cards.
function OverviewLabel({
  icon: Icon,
  children,
}: {
  icon: typeof Activity;
  children: React.ReactNode;
}) {
  return (
    <div className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase flex items-center gap-1.5 mb-2">
      <Icon size={11} /> {children}
    </div>
  );
}

// Compact summary cell (pricing / hiring / reviews) whose header links through to
// the matching detail tab.
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
    <Card className="px-4 py-3 flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase flex items-center gap-1.5 hover:text-foreground transition-colors w-fit"
      >
        <Icon size={11} /> {label} <ChevronRight size={11} />
      </button>
      <div>{children}</div>
    </Card>
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
        <p className="text-[14px] font-semibold text-foreground">Nothing captured yet</p>
        <p className="text-[12px] text-muted-foreground max-w-md">
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
    <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-1 duration-300">
      {homepage && (homepage.headline || homepage.subheadline) && (
        <Card className="px-5 py-4">
          <OverviewLabel icon={Sparkles}>Positioning</OverviewLabel>
          {homepage.headline && (
            <p className="text-[18px] font-semibold leading-snug tracking-tight">
              {homepage.headline}
            </p>
          )}
          {homepage.subheadline && (
            <p className="text-[13px] text-muted-foreground leading-relaxed mt-1.5">
              {homepage.subheadline}
            </p>
          )}
        </Card>
      )}

      {homepage && homepage.valueProps.length > 0 && (
        <Card className="px-5 py-4">
          <OverviewLabel icon={FileText}>What they highlight</OverviewLabel>
          <ul className="flex flex-col gap-1.5 mt-1">
            {homepage.valueProps.map((v, i) => (
              <li key={i} className="text-[13px] leading-relaxed flex gap-2">
                <span className="text-primary shrink-0">•</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {homepage && (homepage.customerLogos.length > 0 || homepage.testimonials.length > 0) && (
        <Card className="px-5 py-4">
          <OverviewLabel icon={Users}>Customers &amp; proof</OverviewLabel>
          {homepage.customerLogos.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {homepage.customerLogos.map((l, i) => (
                <Badge key={i} variant="outline" className="text-[11px] font-normal">
                  {l}
                </Badge>
              ))}
            </div>
          )}
          {homepage.testimonials.length > 0 && (
            <ul className="flex flex-col gap-2.5 mt-3">
              {homepage.testimonials.map((t, i) => (
                <li key={i} className="border-l-2 border-border pl-3">
                  <p className="text-[13px] italic leading-relaxed">“{t.quote}”</p>
                  {t.author && (
                    <p className="text-[11px] font-mono text-muted-foreground/80 mt-1">
                      — {t.author}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {numericClaims.length > 0 && (
        <Card className="px-5 py-4">
          <OverviewLabel icon={Activity}>Claims</OverviewLabel>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {numericClaims.map((cl, i) => (
              <Badge key={i} variant="secondary" className="text-[11px] font-normal">
                {cl.raw_text}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <OverviewStat icon={DollarSign} label="Pricing now" onClick={() => onOpenTab("pricing")}>
          {pricingNow.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {pricingNow.slice(0, 4).map((p, i) => (
                <li
                  key={i}
                  className="text-[12px] flex items-baseline justify-between gap-2"
                >
                  <span className="truncate">{p.plan_name}</span>
                  <span className="font-mono tabular-nums shrink-0">{formatTierPrice(p)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-[12px] text-muted-foreground/70">Not captured</span>
          )}
        </OverviewStat>

        <OverviewStat icon={Briefcase} label="Open roles" onClick={() => onOpenTab("hiring")}>
          {hiring.openRoles > 0 ? (
            <span className="text-[22px] font-bold font-mono tabular-nums">
              {hiring.openRoles}
            </span>
          ) : (
            <span className="text-[12px] text-muted-foreground/70">None tracked</span>
          )}
        </OverviewStat>

        <OverviewStat icon={Star} label="Reviews" onClick={() => onOpenTab("reviews")}>
          {reviews.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {reviews.slice(0, 2).map((r, i) => (
                <div
                  key={i}
                  className="text-[12px] flex items-baseline justify-between gap-2"
                >
                  <span className="uppercase font-mono text-[10px] tracking-wide text-muted-foreground">
                    {r.source}
                  </span>
                  <span className="font-mono tabular-nums">
                    {r.score.toFixed(1)}★{" "}
                    <span className="text-muted-foreground/70">({r.review_count})</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[12px] text-muted-foreground/70">Not captured</span>
          )}
        </OverviewStat>
      </div>

      {capturedAt && (
        <p className="text-[11px] font-mono text-muted-foreground/70">
          homepage facts captured {formatDistanceToNow(new Date(capturedAt), { addSuffix: true })}
        </p>
      )}
    </div>
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
        <p className="text-[13px] font-semibold text-foreground">No activity yet</p>
        <p className="text-[12px] text-muted-foreground max-w-md">
          Activity will appear once a monitor detects a change. Scrape from the
          Monitors section above to start tracking.
        </p>
      </Card>
    );
  }
  const signalChangeIds = new Set(signals.map((s) => s.changeId).filter(Boolean));
  const orphanChanges = changes.filter((c) => !signalChangeIds.has(c.id));
  return (
    <div className="flex flex-col gap-5">
      {signals.length > 0 && (
        <ul className="flex flex-col gap-2">
          {signals.map((s) => {
            const pageUrl = s.monitorUrl ?? competitorUrl;
            return (
              <Card key={s.id} className="px-3.5 py-3">
                <div className="flex items-center gap-2 mb-1.5 text-[11px] flex-wrap">
                  <Badge
                    className={cn(
                      "uppercase tracking-wide text-[9px] font-bold px-2 py-0",
                      SEVERITY_CLASS[s.severity],
                    )}
                  >
                    {s.severity}
                  </Badge>
                  <span className="text-muted-foreground uppercase tracking-widest font-mono text-[10px]">
                    {s.category}
                  </span>
                  {s.sourceType && (
                    <Badge variant="outline" className="text-[9px] font-mono uppercase tracking-wide px-2 py-0">
                      {s.sourceType}
                    </Badge>
                  )}
                  <span className="text-muted-foreground/70 font-mono text-[10px]">
                    · {formatDistanceToNow(new Date(s.createdAt), { addSuffix: true })}
                  </span>
                  <a
                    href={pageUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ml-auto inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70 hover:text-foreground transition-colors"
                  >
                    View page <ExternalLink size={10} />
                  </a>
                </div>
                <p className="text-[13px] mb-1">{s.insight}</p>
                {s.soWhat && (
                  <p className="text-muted-foreground text-[12px] mb-1">→ {s.soWhat}</p>
                )}
                {s.recommendedAction && (
                  <p className="text-foreground text-[12px] font-medium">
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
              </Card>
            );
          })}
        </ul>
      )}

      {orphanChanges.length > 0 && (
        <div>
          <div className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase mb-2.5">
            Detected changes · not classified as signals
          </div>
          <ul className="flex flex-col gap-2">
            {orphanChanges.map((c) => (
              <li key={c.id}>
                <ChangeCard change={c} onRefresh={onRefresh} fallbackUrl={competitorUrl} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
        <p className="text-[14px] font-semibold text-foreground">
          No {label} monitoring yet
        </p>
        <p className="text-[12px] text-muted-foreground max-w-md">
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
      <p className="text-[14px] font-semibold text-foreground">No {label} data yet</p>
      <p className="text-[12px] text-muted-foreground max-w-md">
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
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .getCompetitorPricingHistory(competitorId)
      .then((r) => setHistory(r.history))
      .catch((e) => setErr(String(e)));
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
      <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-1 duration-300">
        <CompetitorPricingCard
          competitor={competitor}
          onUpdated={onRefresh}
          hasCapturedTiers={hasCapturedTiers}
          isCapturing={isCapturing}
        />
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

  return (
    <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-1 duration-300">
      <CompetitorPricingCard
        competitor={competitor}
        onUpdated={onRefresh}
        hasCapturedTiers={hasCapturedTiers}
        isCapturing={isCapturing}
      />
      <SourceSummary
        summary={pricingMonitor?.aiSummary}
        updatedAt={pricingMonitor?.aiSummaryUpdatedAt}
      />
      <Card className="p-4">
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
      </Card>

      <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {plans.map((plan) => {
          const latest = latestByPlan.get(plan)!;
          const first = firstByPlan.get(plan)!;
          const delta = latest.price - first.price;
          const pct = first.price > 0 ? (delta / first.price) * 100 : 0;
          return (
            <Card key={plan} className="px-3.5 py-3">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
                {plan}
              </p>
              <p className="text-[18px] font-bold tracking-tight mt-1">
                {latest.price} {latest.currency}{" "}
                <span className="text-[11px] text-muted-foreground/80 font-mono font-normal">
                  / {latest.billing_period}
                </span>
              </p>
              {delta !== 0 && (
                <p
                  className={cn(
                    "text-[11px] mt-1 font-mono tabular-nums",
                    delta > 0 ? "text-critical" : "text-positive",
                  )}
                >
                  {delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(0)} {latest.currency} (
                  {pct.toFixed(0)}%)
                </p>
              )}
            </Card>
          );
        })}
      </ul>
    </div>
  );
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

  return (
    <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-1 duration-300">
      <SourceSummary
        summary={jobsMonitor?.aiSummary}
        updatedAt={jobsMonitor?.aiSummaryUpdatedAt}
      />
      <Card className="px-3 py-3">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
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
                      {delta === 0 ? "—" : delta > 0 ? `▲ +${delta}` : `▼ ${delta}`}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </Card>

      {Object.keys(trendByDept).length > 0 && (
        <Card className="p-4">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-2">
            90-day trend
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={mergeTrendsByDate(trends)}>
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
        </Card>
      )}
    </div>
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
      className="h-7 gap-1.5 text-[11px]"
    >
      {locked && <Lock size={10} className="opacity-70" />}
      {option.label}
      <span
        className={cn(
          "inline-flex items-center rounded px-1 py-0.5 text-[8px] leading-none font-mono uppercase tracking-wider",
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
        <p className="text-[14px] font-semibold text-foreground">Track reviews</p>
        <p className="text-[12px] text-muted-foreground max-w-md">
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
        <p className="text-[11px] text-muted-foreground">
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

  return (
    <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-1 duration-300">
      <ReviewSourceToolbar monitor={reviewMonitor} onManage={() => setManaging(true)} />

      <SourceSummary
        summary={reviewMonitor.aiSummary}
        updatedAt={reviewMonitor.aiSummaryUpdatedAt}
      />

      {!hasData ? (
        <MonitorEmptyState
          source={reviewMonitor.sourceType as SourceType}
          label="reviews"
          monitors={monitors}
          scrapingIds={scrapingIds}
          onRun={onRun}
          onEnable={onEnable}
        />
      ) : (
        <>
          {series && (
            <Card className="p-4">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-2">
                Score over time
              </p>
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
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
        </>
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
function ReviewSourceToolbar({ monitor, onManage }: { monitor: Monitor; onManage: () => void }) {
  const opt = REVIEW_SOURCE_OPTIONS.find((o) => o.value === monitor.sourceType);
  const url = monitor.config?.url ?? "";
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <div className="min-w-0">
        <span className="text-[12px] font-medium text-foreground">
          {opt?.label ?? monitor.sourceType}
        </span>
        {url && (
          <span className="ml-2 text-[11px] font-mono text-muted-foreground/70 truncate">
            {url}
          </span>
        )}
      </div>
      <Button size="sm" variant="outline" onClick={onManage} className="h-7 text-[11px] shrink-0">
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
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
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
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
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
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Page URL
            </p>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={active.placeholder}
              inputMode="url"
              autoComplete="off"
            />
            <p className="text-[11px] text-muted-foreground">Must be a {active.host} URL.</p>
            {trimmed !== "" && !urlValid && (
              <p className="text-[11px] text-critical/80">
                This URL isn&apos;t valid for {active.label}.
              </p>
            )}
          </div>
          {sourceChanged && (
            <p className="text-[11px] text-critical/80">
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
        <p className="text-[14px] font-semibold text-foreground">No content changes yet</p>
        <p className="text-[12px] text-muted-foreground max-w-md">
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
    <ul className="flex flex-col gap-2">
      {contentChanges.map((c) => (
        <li key={c.id}>
          <ChangeCard
            change={c}
            onRefresh={onRefresh}
            fallbackUrl={competitorUrl}
            insight={insightByChangeId.get(c.id)}
          />
        </li>
      ))}
    </ul>
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
    <Card className="px-3.5 py-3">
      <p
        className={cn(
          "text-[10px] uppercase tracking-widest font-mono mb-2",
          accent === "positive" ? "text-positive" : "text-critical",
        )}
      >
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">—</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-[13px]">
          {items.filter(Boolean).map((it, i) => (
            <li key={i}>· {it}</li>
          ))}
        </ul>
      )}
    </Card>
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
      <p className="text-[13px]">{text}</p>
      {hint && <p className="text-[11px] mt-2 max-w-md mx-auto text-muted-foreground/70">{hint}</p>}
    </Card>
  );
}

function lineColor(i: number): string {
  const palette = ["#fafafa", "#22d3ee", "#a855f7", "#10b981", "#ef4444", "#f97316"];
  return palette[i % palette.length] ?? "#fafafa";
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
