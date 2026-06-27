"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Activity, ExternalLink, ArrowRight } from "lucide-react";
import type { CompetitorSignal, ChangeRow } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Eyebrow } from "@/components/outrival/eyebrow";
import { TabCard, TabSection } from "@/components/outrival/tab-shell";
import { SignalSourceLine } from "@/components/outrival/signal-source-line";
import { useLastVisit } from "@/hooks/use-last-visit";
import { ChangeCard } from "./changes";

const SEVERITY_CLASS: Record<string, string> = {
  low: "bg-low text-background",
  medium: "bg-medium text-background",
  high: "bg-high text-background",
  critical: "bg-critical text-background",
};

export function ActivityTab({
  competitorId,
  signals,
  changes,
  onRefresh,
  competitorUrl,
  lastRunMs,
}: {
  competitorId: string;
  signals: CompetitorSignal[];
  changes: ChangeRow[];
  onRefresh?: () => void;
  competitorUrl: string;
  // Newest run across this competitor's sources (0 = never scraped). Lets the
  // empty state say "monitored, nothing changed yet" instead of "nothing here".
  lastRunMs: number;
}) {
  // Every scrape Outrival ran for this competitor — incl. the no-change / baseline
  // runs this tab (signals + changes only) never shows. Lives on the dedicated
  // Activity page, pre-filtered to this competitor.
  const activityHref = `/dashboard/activity?competitorId=${competitorId}`;
  // Highlight what landed since the user last opened this competitor (no server
  // state — purely client). `null` on a first visit → nothing flagged.
  const lastVisit = useLastVisit(`competitor:${competitorId}`);
  const isNew = (createdAt: string) =>
    lastVisit !== null && new Date(createdAt).getTime() > lastVisit;
  const newCount = signals.filter((s) => isNew(s.createdAt)).length;

  if (signals.length === 0 && changes.length === 0) {
    // No signal/change ≠ nothing happened: the sources may have been checked many
    // times with no change. Saying "no activity" reads as broken/idle, so once
    // we've actually scraped we acknowledge the monitoring and point to the runs.
    const hasScraped = lastRunMs > 0;
    return (
      <EmptyState
        icon={Activity}
        title={hasScraped ? "No changes yet" : "No activity yet"}
        description={
          hasScraped
            ? "Monitoring is active — we've been checking this competitor's sources and nothing has changed yet."
            : "Scrape from the Sources section above to start tracking."
        }
        actions={
          hasScraped && (
            <Link
              href={activityHref}
              className="inline-flex items-center gap-1.5 text-sm text-link hover:underline"
            >
              <Activity size={14} aria-hidden />
              View monitoring activity
            </Link>
          )
        }
      />
    );
  }
  const signalChangeIds = new Set(signals.map((s) => s.changeId).filter(Boolean));
  const orphanChanges = changes.filter((c) => !signalChangeIds.has(c.id));
  return (
    <TabCard>
      {signals.length > 0 && (
        <TabSection title="Recent activity" icon={Activity}>
        {newCount > 0 && (
          <div className="mb-1 flex items-center gap-2 text-dense text-muted-foreground">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden />
            <span>
              <span className="font-medium text-foreground">{newCount}</span> new
              since your last visit
            </span>
          </div>
        )}
        <ul className="flex flex-col divide-y divide-border">
          {signals.map((s) => {
            const pageUrl = s.monitorUrl ?? competitorUrl;
            const fresh = isNew(s.createdAt);
            return (
              <li
                key={s.id}
                className={cn(
                  "flex flex-col py-3.5 first:pt-0 last:pb-0",
                  fresh && "border-l-2 border-primary pl-3.5",
                )}
              >
                <div className="flex items-center gap-2 mb-1.5 text-xs flex-wrap">
                  <Badge
                    className={cn(
                      "uppercase tracking-wide text-meta font-bold px-2 py-0",
                      SEVERITY_CLASS[s.severity],
                    )}
                  >
                    {s.severity}
                  </Badge>
                  {fresh && (
                    <span className="rounded-sm bg-primary/15 px-1.5 py-0 text-meta font-medium uppercase tracking-wide text-primary">
                      New
                    </span>
                  )}
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

      {/* This tab shows only signals + classified changes. The full run history —
          including every no-change and baseline check — lives on the Activity
          page, filtered to this competitor. */}
      <div className="px-5 py-3">
        <Link
          href={activityHref}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          View all monitoring activity
          <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    </TabCard>
  );
}
