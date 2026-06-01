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
  minPlanForSource,
  planIncludesSource,
  aggregateFreshness,
  type Plan,
  type SourceType,
  type ReviewSourceType,
  type MonitorFrequency,
} from "@outrival/shared";
import { FreshnessDot } from "@/components/outrival/freshness-dot";
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
} from "@/lib/api";

type TabKey = "activity" | "pricing" | "hiring" | "reviews" | "content" | "battlecard";

const TABS: Array<{ key: TabKey; label: string; icon: typeof Activity }> = [
  { key: "activity", label: "Activity", icon: Activity },
  { key: "pricing", label: "Pricing", icon: DollarSign },
  { key: "hiring", label: "Hiring", icon: Briefcase },
  { key: "reviews", label: "Reviews", icon: Star },
  { key: "content", label: "Content", icon: FileText },
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
  plan: Plan;
};

export default function CompetitorDetailPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<CompetitorData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [scrapingIds, setScrapingIds] = useState<Set<string>>(new Set());
  const [runningAll, setRunningAll] = useState(false);
  const [tab, setTab] = useState<TabKey>("activity");
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrapingStartRef = useRef<
    Map<string, { startedAt: number; lastRunAt: string | null; lastFailedAt: string | null }>
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
        const labels = finished
          .map((mid) => fresh.monitors.find((m) => m.id === mid)?.sourceType ?? mid)
          .join(", ");
        toast.success("Scrape completed", { description: labels });
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

  if (error && !data) {
    return (
      <div className="mt-10">
        <ListError error={error} onRetry={refresh} />
      </div>
    );
  }
  if (!data) return <CompetitorDetailLoading />;

  const { competitor, monitors, recentChanges, recentSignals, plan } = data;
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
          onRun={runMonitor}
          onRunAll={runAllMonitors}
          onEdit={editMonitor}
          competitorUrl={competitor.url}
          runningAll={runningAll}
          disabled={
            runningAll ||
            monitors.every((m) => scrapingIds.has(m.id) || isServerScraping(m))
          }
        />

        <StatsOverview
          competitor={competitor}
          signals={recentSignals}
        />

        <AiSummary competitor={competitor} onRefresh={refresh} />

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList variant="line" className="w-full justify-start overflow-x-auto">
            {TABS.map((t) => {
              const Icon = t.icon;
              const fresh = tabFreshness(t.key, monitors);
              return (
                <TabsTrigger key={t.key} value={t.key}>
                  <Icon size={13} /> {t.label}
                  {fresh && (
                    <FreshnessDot
                      lastScrapedAt={fresh.lastScrapedAt}
                      status={fresh.status}
                      className="ml-1.5"
                    />
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          <div className="mt-6">
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
                onRun={runMonitor}
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
                onRun={runMonitor}
                onEnable={enableMonitor}
                refreshTick={refreshTick}
              />
            </TabsContent>
            <TabsContent value="reviews">
              <ReviewsTab
                competitorId={id}
                monitors={monitors}
                scrapingIds={scrapingIds}
                onRun={runMonitor}
                onEnable={enableMonitor}
                onEdit={editMonitor}
                onSwitch={switchReviewSource}
                refreshTick={refreshTick}
                plan={plan}
                onLockedSource={(source) =>
                  setPaywall({ code: "plan_locked_source", source, plan })
                }
              />
            </TabsContent>
            <TabsContent value="content">
              <ContentTab
                changes={recentChanges}
                monitors={monitors}
                scrapingIds={scrapingIds}
                onRun={runMonitor}
                onRefresh={refresh}
                competitorUrl={competitor.url}
              />
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
  onRunAll,
  onEdit,
  competitorUrl,
  runningAll,
  disabled,
}: {
  monitors: Monitor[];
  scrapingIds: Set<string>;
  onRun: (id: string) => void;
  onRunAll: () => void;
  onEdit: (id: string, patch: { url?: string; frequency?: MonitorFrequency }) => Promise<void>;
  competitorUrl: string;
  runningAll: boolean;
  disabled: boolean;
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
      <MonitorEditDialog
        monitor={editing}
        competitorUrl={competitorUrl}
        onClose={() => setEditing(null)}
        onSave={onEdit}
      />
    </Card>
  );
}

const EDITABLE_FREQUENCIES: MonitorFrequency[] = [...MONITOR_FREQUENCIES];

// Per-monitor config: override the auto-detected page URL and the check cadence.
// Frequency is the upper bound (the scheduler backs off when a source is stable),
// gated server-side by plan — an over-plan choice surfaces the paywall.
function MonitorEditDialog({
  monitor,
  competitorUrl,
  onClose,
  onSave,
}: {
  monitor: Monitor | null;
  competitorUrl: string;
  onClose: () => void;
  onSave: (id: string, patch: { url?: string; frequency?: MonitorFrequency }) => Promise<void>;
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
                <Button
                  key={f}
                  type="button"
                  size="sm"
                  variant={frequency === f ? "default" : "outline"}
                  onClick={() => setFrequency(f)}
                  className="h-7 text-[11px] capitalize"
                >
                  {f}
                </Button>
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

function StatsOverview({
  competitor,
  signals,
}: {
  competitor: Competitor;
  signals: CompetitorSignal[];
}) {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 3600 * 1000;
  const signals7d = signals.filter(
    (s) => new Date(s.createdAt).getTime() >= sevenDaysAgo,
  ).length;

  return (
    <Card className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border">
      <KpiCell
        label="Overlap"
        tooltip="How similar this competitor is to your product (0–100). Computed at discovery via Exa + AI scoring against your product profile."
        value={
          competitor.overlapScore != null ? (
            <div className="flex items-center gap-2.5">
              <div className="h-1.5 w-[70px] bg-background rounded border border-border overflow-hidden">
                <span
                  className="block h-full bg-primary rounded"
                  style={{
                    width: `${Math.max(0, Math.min(100, competitor.overlapScore))}%`,
                  }}
                />
              </div>
              <span className="tabular-nums font-mono text-[18px] font-bold">
                {Math.round(competitor.overlapScore)}
              </span>
              <span className="text-muted-foreground/80 text-xs font-mono">/100</span>
            </div>
          ) : (
            "—"
          )
        }
        raw
      />
      <KpiCell
        label="Signals 7d"
        value={signals7d}
        sub={`${signals.length} total tracked`}
      />
    </Card>
  );
}

function KpiCell({
  label,
  tooltip,
  value,
  sub,
  raw,
}: {
  label: string;
  tooltip?: string;
  value: React.ReactNode;
  sub?: string;
  raw?: boolean;
}) {
  return (
    <div className="px-5 py-4 flex flex-col gap-1.5 text-left min-w-0">
      <div className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase flex items-center gap-1.5">
        <span>{label}</span>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground/60 hover:text-foreground transition-colors"
                aria-label={`About ${label}`}
              >
                <Info size={11} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[240px] text-[11px] leading-relaxed text-pretty normal-case">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      {raw ? (
        <div>{value}</div>
      ) : (
        <div
          className={cn(
            "font-bold tracking-tight leading-none truncate",
            typeof value === "number"
              ? "text-[26px] font-mono tabular-nums"
              : "text-[18px]",
          )}
        >
          {value}
        </div>
      )}
      {sub && (
        <div className="text-muted-foreground/80 text-[11px] font-mono truncate">
          {sub}
        </div>
      )}
    </div>
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
}: {
  change: ChangeRow;
  onRefresh?: () => void;
  fallbackUrl?: string;
}) {
  const [open, setOpen] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const hasSummary = change.summary && change.summary.trim().length > 0;

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
        <p className="text-[13px] leading-relaxed text-foreground">{change.summary}</p>
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

  if (err) return <Empty text="Couldn't load this data right now — try again in a moment." />;
  if (history === null) return <TabLoading />;
  if (history.length === 0 || !series) {
    return (
      <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-1 duration-300">
        <CompetitorPricingCard competitor={competitor} onUpdated={onRefresh} />
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

  const pricingMonitor = monitors.find((m) => m.sourceType === "pricing");

  return (
    <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-1 duration-300">
      <CompetitorPricingCard competitor={competitor} onUpdated={onRefresh} />
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
          "rounded px-1 py-px text-[8px] font-mono uppercase tracking-wider",
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
}: {
  competitorId: string;
  refreshTick?: number;
  plan: Plan;
  onLockedSource?: (source: ReviewSourceType) => void;
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
}: {
  open: boolean;
  monitor: Monitor;
  plan: Plan;
  onClose: () => void;
  onEdit: (id: string, patch: { url?: string; frequency?: MonitorFrequency }) => Promise<void>;
  onSwitch: (oldMonitorId: string, source: SourceType, url: string) => Promise<void>;
  onLockedSource?: (source: ReviewSourceType) => void;
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
                <Button
                  key={f}
                  type="button"
                  size="sm"
                  variant={frequency === f ? "default" : "outline"}
                  onClick={() => setFrequency(f)}
                  className="h-7 text-[11px] capitalize"
                  disabled={sourceChanged}
                >
                  {f}
                </Button>
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
  monitors,
  scrapingIds,
  onRun,
  onRefresh,
  competitorUrl,
}: {
  changes: ChangeRow[];
  onRefresh?: () => void;
  competitorUrl: string;
} & MonitorSourceProps) {
  const contentChanges = changes.filter((c) => CONTENT_SOURCES.has(c.sourceType));
  const contentMonitors = monitors.filter((m) => CONTENT_SOURCES.has(m.sourceType));

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
          <ChangeCard change={c} onRefresh={onRefresh} fallbackUrl={competitorUrl} />
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
