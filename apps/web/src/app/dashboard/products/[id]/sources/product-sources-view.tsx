"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, CardsThreeIcon, SpinnerIcon, PlayIcon } from "@/components/icons";
import {
  ALL_SELF_CONFIGURABLE_SOURCES,
  SELF_CONFIGURABLE_SOURCES,
  SELF_SOURCE_GROUPS,
  SOURCE_GROUP_LABELS,
  buildCoverage,
  sourceState,
} from "@outrival/shared";
import type { Monitor } from "@/lib/api";
import { productDetailQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PaywallDialog } from "@/components/outrival/paywall-dialog";
import { PausedMonitors } from "@/components/outrival/monitor-alternatives";
import { ListError } from "@/components/outrival/list-error";
import { sourceShortLabel } from "@/lib/source-labels";
import { scrapeActivity } from "../../../competitors/[id]/competitor-detail/shared";
import { useMonitorActions } from "../../../competitors/[id]/competitor-detail/use-monitor-actions";
import { GroupLabel } from "../../../competitors/[id]/sources/sources-view";
import { SourceRow } from "../../../competitors/[id]/sources/source-row";
import { CustomSources } from "../../../competitors/[id]/sources/custom-sources";

const label = (s: (typeof ALL_SELF_CONFIGURABLE_SOURCES)[number]) =>
  sourceShortLabel(s).toLowerCase();

/**
 * The product counterpart of the competitor Sources page: everything that governs
 * what we collect on the product's OWN site. Same rows, same drawer, same custom
 * pages — the catalog is just the self view of it (no reviews, no status/docs/
 * roadmap: those watch surfaces the org already owns).
 *
 * Resolves the product first because the monitors live on its self-competitor,
 * and the monitor hook needs that id before it can mount.
 */
export function ProductSourcesView({ productId }: { productId: string }) {
  const detailQ = useQuery(productDetailQuery(productId));
  const product = detailQ.data?.product ?? null;

  if (detailQ.isError) {
    return (
      <div className="xl:px-6 2xl:px-12">
        <EmptyState
          icon={CardsThreeIcon}
          title="Product not found"
          description="This product doesn't exist or you don't have access to it."
          actions={
            <Button asChild>
              <Link href="/dashboard/products?product=all">Back to products</Link>
            </Button>
          }
        />
      </div>
    );
  }
  if (!product) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <SpinnerIcon className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="xl:px-6 2xl:px-12">
      <ProductSourcesSheet
        productId={productId}
        productName={product.name}
        selfCompetitorId={product.selfCompetitorId}
      />
    </div>
  );
}

function ProductSourcesSheet({
  productId,
  productName,
  selfCompetitorId,
}: {
  productId: string;
  productName: string;
  selfCompetitorId: string;
}) {
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
  } = useMonitorActions(selfCompetitorId);

  if (error && !data) {
    return (
      <div className="mt-10">
        <ListError error={error} onRetry={refresh} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <SpinnerIcon className="size-5 animate-spin" />
      </div>
    );
  }

  const { competitor, monitors, plan } = data;
  const bySource = new Map(monitors.map((m) => [m.sourceType, m]));
  const activityOf = (m: Monitor) => scrapeActivity(m, scrapingIds.has(m.id));
  const monitoringPaused = competitor.monitoringPaused || Boolean(competitor.pausedByPlan);

  // Quoted in the blocked message, same as on a competitor: what we still read.
  const states = ALL_SELF_CONFIGURABLE_SOURCES.map((sourceType) => ({
    sourceType,
    state: sourceState({
      sourceType,
      plan,
      monitor: bySource.get(sourceType) ?? null,
      targets: null,
    }),
  }));
  const coverage = buildCoverage(states);
  const fallbacks = [...coverage.tracked, ...coverage.pending].map(label);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <Link
              href={`/dashboard/products/${productId}`}
              aria-label="Back to product"
              className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeftIcon size={16} />
            </Link>
            <div className="min-w-0">
              <h1 className="m-0 text-title font-bold leading-tight tracking-tight">Sources</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                What we watch on {productName}, your own product
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={runAllMonitors}
            disabled={runningAll}
            className="h-8 shrink-0 text-xs"
          >
            {runningAll ? <SpinnerIcon size={16} className="animate-spin" /> : <PlayIcon size={16} />}
            Scan all
          </Button>
        </div>

        {/* A source we auto-paused after repeated failures keeps its recovery card. */}
        <PausedMonitors
          monitors={monitors.filter((m) => m.markedUnscrapable)}
          onResolved={refresh}
        />

        <Card className="overflow-hidden">
          {SELF_SOURCE_GROUPS.map((group) => {
            const sources = SELF_CONFIGURABLE_SOURCES[group] ?? [];
            if (sources.length === 0) return null;
            return (
              <div key={group}>
                <GroupLabel>{SOURCE_GROUP_LABELS[group]}</GroupLabel>
                {sources.map((sourceType) => {
                  const monitor = bySource.get(sourceType) ?? null;
                  return (
                    <SourceRow
                      key={sourceType}
                      sourceType={sourceType}
                      monitor={monitor}
                      plan={plan}
                      targets={null}
                      competitorUrl={competitor.url}
                      fallbacks={fallbacks.filter((f) => f !== label(sourceType))}
                      activity={monitor ? activityOf(monitor) : null}
                      monitoringPaused={monitoringPaused}
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
            );
          })}
        </Card>

        {/* Watching a page needs a site to watch it on — a repo-only product has none. */}
        {competitor.url && (
          <CustomSources
            competitorUrl={competitor.url}
            plan={plan}
            monitors={monitors}
            scrapingIds={scrapingIds}
            monitoringPaused={monitoringPaused}
            onRun={requestRunMonitor}
            onAdd={addCustomMonitor}
            onEdit={editMonitor}
            onSetActive={setMonitorActive}
            onDelete={removeCustomMonitor}
            onLockedFrequency={(frequency) =>
              setPaywall({ code: "plan_locked_frequency", frequency, plan })
            }
            onLocked={() =>
              setPaywall({ code: "plan_limit_custom_monitors", plan, used: 0, limit: 0 })
            }
          />
        )}

        <PaywallDialog reason={paywall} onClose={() => setPaywall(null)} />
      </div>
    </TooltipProvider>
  );
}
