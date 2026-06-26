"use client";

import { formatDistanceToNow } from "date-fns";
import { Activity, ExternalLink, ArrowRight } from "lucide-react";
import type { CompetitorSignal, ChangeRow } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
}: {
  competitorId: string;
  signals: CompetitorSignal[];
  changes: ChangeRow[];
  onRefresh?: () => void;
  competitorUrl: string;
}) {
  // Highlight what landed since the user last opened this competitor (no server
  // state — purely client). `null` on a first visit → nothing flagged.
  const lastVisit = useLastVisit(`competitor:${competitorId}`);
  const isNew = (createdAt: string) =>
    lastVisit !== null && new Date(createdAt).getTime() > lastVisit;
  const newCount = signals.filter((s) => isNew(s.createdAt)).length;

  if (signals.length === 0 && changes.length === 0) {
    return (
      <Card className="px-6 py-10 text-center border-dashed flex flex-col items-center gap-2.5">
        <p className="text-sm font-semibold text-foreground">No activity yet</p>
        <p className="text-sm text-muted-foreground max-w-md">
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
    </TabCard>
  );
}
