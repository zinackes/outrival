"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Signal } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SeverityPill } from "./severity-pill";
import { CatPill } from "./cat-pill";
import { CompAvatar } from "./comp-avatar";
import { SignalSourceLine } from "@/components/outrival/signal-source-line";
import { FeedbackButtons } from "@/components/outrival/feedback-buttons";
import { SeverityFeedback } from "@/components/outrival/severity-feedback";
import { ConfidenceDot } from "@/components/outrival/confidence-dot";
import { AiOutputWarning } from "@/components/outrival/ai-output-warning";

interface SignalCardProps {
  signal: Signal;
  onMarkRead?: (id: string) => void;
  onOpenCompetitor?: (id: string) => void;
  first?: boolean;
}

export function SignalCard({
  signal,
  onMarkRead,
  onOpenCompetitor,
  first,
}: SignalCardProps) {
  const [flagged, setFlagged] = useState(signal.aiFlagged ?? false);
  const hasDetails = Boolean(
    signal.soWhat ||
      (signal.recommendedAction && signal.recommendedAction !== "—"),
  );
  const timeAgo = formatDistanceToNow(new Date(signal.createdAt), {
    addSuffix: true,
  });

  return (
    <div
      className={cn(
        "p-[22px]",
        !first && "border-t border-border",
        signal.isRead && "opacity-65",
      )}
    >
      <div className="flex items-center gap-3 mb-3.5 flex-wrap">
        {/* Prefer the user's severity override (patch-21) over the AI rating. */}
        <SeverityPill severity={signal.severityOverride ?? signal.severity} />
        <CatPill>{signal.category}</CatPill>
        <span className="w-px h-3 bg-border" />
        <CompAvatar name={signal.competitorName} size={24} />
        <span className="font-semibold text-[13px]">
          {signal.competitorName}
        </span>
        {/* AI confidence (patch-24): renders nothing when confidence is high. */}
        <ConfidenceDot confidence={signal.aiConfidence ?? "high"} />
        <span className="flex-1" />
        <span className="tabular-nums font-mono text-muted-foreground/80 text-[11px]">
          {timeAgo}
        </span>
        {!signal.isRead && (
          <span className="w-[7px] h-[7px] rounded-full bg-primary" />
        )}
      </div>

      {/* Self-check warning (patch-24): shown above the content, which stays
          visible — transparency, not silent removal. */}
      {flagged && (
        <AiOutputWarning
          targetType="signal"
          targetId={signal.id}
          onResolved={() => setFlagged(false)}
        />
      )}

      <p className="text-[15px] leading-normal mb-4 font-medium tracking-tight">
        {signal.insight}
      </p>

      {/* Strategic narrative (patch-16): contextual explanation of a significant
          structured homepage change. Visually distinct (amber, left rule, italic),
          adds context below the title — never replaces it. Absent → unchanged. */}
      {signal.narrative && (
        <p className="mb-4 border-l-2 border-primary/40 pl-3 text-[13.5px] italic leading-relaxed text-primary/90">
          {signal.narrative}
        </p>
      )}

      {hasDetails && (
        <div className="grid grid-cols-[100px_1fr] gap-x-8 gap-y-3.5 pt-4 border-t border-border">
          {signal.soWhat && (
            <>
              <div className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/80 pt-0.5">
                So what
              </div>
              <div className="text-[13.5px] leading-relaxed text-white/85">
                {signal.soWhat}
              </div>
            </>
          )}
          {signal.recommendedAction && signal.recommendedAction !== "—" && (
            <>
              <div className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/80 pt-0.5">
                Action
              </div>
              <div className="text-[13.5px] leading-relaxed text-white/85">
                {signal.recommendedAction}
              </div>
            </>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-1.5">
        {onOpenCompetitor && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenCompetitor(signal.competitorId)}
          >
            View competitor
          </Button>
        )}
        {!signal.isRead && onMarkRead && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onMarkRead(signal.id)}
          >
            <Check size={11} /> Mark as read
          </Button>
        )}
      </div>

      <div className="mt-3.5 pt-3.5 border-t border-border">
        <SignalSourceLine
          signalId={signal.id}
          sourceType={signal.sourceType}
          detectedAt={signal.createdAt}
        />
        {/* Inline quality feedback (patch-21): verdict on the signal + a discreet
            severity-adjustment control. */}
        <div className="mt-2.5 flex items-center justify-between gap-3">
          <FeedbackButtons
            targetType="signal"
            targetId={signal.id}
            currentVerdict={signal.feedbackVerdict}
          />
          <SeverityFeedback signalId={signal.id} />
        </div>
      </div>
    </div>
  );
}
