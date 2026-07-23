"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Play, Radio } from "lucide-react";
import {
  ALL_CONFIGURABLE_SOURCES,
  AUTOMATIC_SOURCES,
  CONFIGURABLE_SOURCES,
  SOURCE_GROUPS,
  SOURCE_GROUP_LABELS,
  buildCoverage,
  coverageHeadline,
  sourceState,
  type DetectedTargets,
  type SourceType,
} from "@outrival/shared";
import { api, type Monitor, type TechStackData } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PaywallDialog } from "@/components/outrival/paywall-dialog";
import { PausedMonitors } from "@/components/outrival/monitor-alternatives";
import { competitorNameColor } from "@/lib/competitor-color";
import { sourceShortLabel } from "@/lib/source-labels";
import { ListError } from "@/components/outrival/list-error";
import { toastApiError } from "@/lib/error-helpers";
import CompetitorDetailLoading from "../detail-skeleton";
import { isServerScraping } from "../competitor-detail/shared";
import { lastScanLabel, monitorStatus } from "../competitor-detail/monitor-status";
import { useMonitorActions } from "../competitor-detail/use-monitor-actions";
import { CustomSources } from "./custom-sources";
import { SourceRow, SourceName } from "./source-row";
import { sourceCopy } from "./source-copy";

const label = (s: SourceType) => sourceShortLabel(s).toLowerCase();

function detectedTargetsOf(techStack: TechStackData): DetectedTargets | null {
  const profile = techStack.platformProfile;
  if (!profile) return null;
  return { statusPage: !!profile.statusPage?.value, changelog: !!profile.changelog?.value };
}

/**
 * Everything that governs what we collect on one competitor. Split out of the
 * detail page so the tabs are purely for reading and this is purely for deciding —
 * and so the tri-state (tracking / not applicable / blocked) has room to explain
 * itself rather than hiding inside a chip tooltip.
 */
export function SourcesView({ id }: { id: string }) {
  const {
    data,
    error,
    scrapingIds,
    runningAll,
    paywall,
    setPaywall,
    refresh,
    requestRunMonitor,
    runAllMonitors,
    enableMonitor,
    editMonitor,
    setMonitorActive,
    addCustomMonitor,
    removeCustomMonitor,
  } = useMonitorActions(id);
  const [techScraping, setTechScraping] = useState(false);

  // Dev-only: force a tech-stack scan. The job updates techStackScrapedAt + entries,
  // so a timed refresh surfaces the result — no monitor-keyed polling like a source.
  async function scrapeTechStack() {
    setTechScraping(true);
    try {
      await api.scrapeTechStack(id);
      toast.info("Tech-stack scan triggered", {
        description: "Detecting third-party tech… refreshing shortly.",
      });
      setTimeout(() => {
        void refresh();
        setTechScraping(false);
      }, 8000);
    } catch (e) {
      toastApiError(e, { title: "Couldn't trigger the tech-stack scan" });
      setTechScraping(false);
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

  const { competitor, monitors, automaticMonitors, techStack, plan } = data;
  const targets = detectedTargetsOf(techStack);
  const bySource = new Map(monitors.map((m) => [m.sourceType, m]));
  const isRunning = (m: Monitor) => scrapingIds.has(m.id) || isServerScraping(m);

  const states = ALL_CONFIGURABLE_SOURCES.map((sourceType) => ({
    sourceType,
    state: sourceState({ sourceType, plan, monitor: bySource.get(sourceType) ?? null, targets }),
  }));
  const coverage = buildCoverage(states);
  // Quoted in the blocked message so a protected surface reads as "we route around
  // it", not "we're stuck".
  const fallbacks = [...coverage.tracked, ...coverage.pending].map(label);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <Link
              href={`/dashboard/competitors/${id}`}
              aria-label="Back to competitor"
              className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft size={16} />
            </Link>
            <div className="min-w-0">
              <h1 className="m-0 text-title font-bold leading-tight tracking-tight">Sources</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                What we collect on{" "}
                <span style={competitorNameColor(competitor.color)}>{competitor.name}</span> ·{" "}
                {coverageHeadline(coverage, label)}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={runAllMonitors}
            disabled={runningAll}
            className="h-8 shrink-0 text-xs"
          >
            {runningAll ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            Scan all
          </Button>
        </div>

        {/* A source we auto-paused after repeated failures keeps its recovery card
            (set a URL / enter the data / resume) — the row above states the problem,
            this offers the diagnosis-specific way out. */}
        <PausedMonitors
          monitors={monitors.filter((m) => m.markedUnscrapable)}
          onResolved={refresh}
        />

        {SOURCE_GROUPS.map((group) => (
          <Card key={group} className="overflow-hidden">
            <div className="border-b border-border px-4 py-2.5">
              <h2 className="text-sm font-semibold tracking-tight">
                {SOURCE_GROUP_LABELS[group]}
              </h2>
            </div>
            <div className="divide-y divide-border">
              {CONFIGURABLE_SOURCES[group].map((sourceType) => {
                const monitor = bySource.get(sourceType) ?? null;
                return (
                  <SourceRow
                    key={sourceType}
                    sourceType={sourceType}
                    monitor={monitor}
                    plan={plan}
                    targets={targets}
                    competitorUrl={competitor.url}
                    fallbacks={fallbacks.filter((f) => f !== label(sourceType))}
                    running={monitor ? isRunning(monitor) : false}
                    monitoringPaused={
                      competitor.monitoringPaused || Boolean(competitor.pausedByPlan)
                    }
                    onRun={requestRunMonitor}
                    onEnable={enableMonitor}
                    onEdit={editMonitor}
                    onSetActive={setMonitorActive}
                    onLockedFrequency={(frequency) =>
                      setPaywall({ code: "plan_locked_frequency", frequency, plan })
                    }
                    onUpgrade={(source) =>
                      setPaywall({ code: "plan_locked_source", source, plan })
                    }
                  />
                );
              })}
            </div>
          </Card>
        ))}

        <CustomSources
          competitorUrl={competitor.url ?? ""}
          plan={plan}
          monitors={monitors}
          scrapingIds={scrapingIds}
          onRun={requestRunMonitor}
          onAdd={addCustomMonitor}
          onDelete={removeCustomMonitor}
          onLocked={() =>
            setPaywall({ code: "plan_limit_custom_monitors", plan, used: 0, limit: 0 })
          }
        />

        <Card className="overflow-hidden">
          <div className="border-b border-border px-4 py-2.5">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
              <Radio size={13} className="text-muted-foreground" /> Automatic sources
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Monitored automatically — can&apos;t be turned off. They cost you nothing
              and need no configuration.
            </p>
          </div>
          <ul className="divide-y divide-border">
            {AUTOMATIC_SOURCES.map((sourceType) => {
              const monitor = automaticMonitors.find((m) => m.sourceType === sourceType) ?? null;
              // An automatic source can also be "not applicable" — a competitor with
              // no YouTube channel. Report that neutrally here too, so the read-only
              // list never blames a failure the classifier calls a non-event.
              const state = sourceState({ sourceType, plan, monitor, targets });
              const message =
                state === "not_available"
                  ? sourceCopy({ state, sourceType }).message
                  : monitor
                    ? lastScanLabel(monitor, monitorStatus(monitor, isRunning(monitor)))
                    : "Not seeded yet";
              return (
                <li
                  key={sourceType}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
                >
                  <SourceName
                    label={sourceShortLabel(sourceType)}
                    url={monitor?.pageUrl ?? null}
                  />
                  <span className="text-sm text-muted-foreground">{message}</span>
                </li>
              );
            })}
            {/* Tech stack isn't a monitor — it runs on its own monthly cron keyed on
                competitors.tech_stack_scraped_at — so it has no toggle or schedule
                here either. The Run button is dev-only (stripped from production
                bundles; /api/dev is likewise unmounted in prod). */}
            <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <span className="w-[132px] shrink-0 truncate text-sm font-medium">Tech stack</span>
              <span className="text-sm text-muted-foreground">
                {techScraping
                  ? "Scanning…"
                  : techStack.lastScrapedAt
                    ? `Scanned ${formatDistanceToNow(new Date(techStack.lastScrapedAt), { addSuffix: true })}`
                    : "Never scanned"}
              </span>
              {process.env.NODE_ENV !== "production" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-7 text-xs"
                  onClick={scrapeTechStack}
                  disabled={techScraping}
                >
                  {techScraping ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Play size={11} />
                  )}
                  Run
                </Button>
              )}
            </li>
          </ul>
        </Card>

        <PaywallDialog reason={paywall} onClose={() => setPaywall(null)} />
      </div>
    </TooltipProvider>
  );
}
