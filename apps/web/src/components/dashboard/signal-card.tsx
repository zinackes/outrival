"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, MoreHorizontal, ListTodo, MessageSquare } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { api, type Signal, type ActionStatus } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SeverityPill } from "./severity-pill";
import { CatPill } from "./cat-pill";
import { CompAvatar } from "./comp-avatar";
import { SignalComments } from "./signal-comments";
import { SignalSourceLine } from "@/components/outrival/signal-source-line";
import { FeedbackButtons } from "@/components/outrival/feedback-buttons";
import { ConfidenceDot } from "@/components/outrival/confidence-dot";
import { AiOutputWarning } from "@/components/outrival/ai-output-warning";

interface SignalCardProps {
  signal: Signal;
  onMarkRead?: (id: string) => void;
  onActionChange?: (id: string, status: ActionStatus | null) => void;
  highlight?: boolean;
}

const ACTION_OPTIONS: { value: ActionStatus; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "doing", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "dismissed", label: "Dismissed" },
];
const ACTION_LABEL: Record<ActionStatus, string> = {
  todo: "To do",
  doing: "In progress",
  done: "Done",
  dismissed: "Dismissed",
};

export function SignalCard({ signal, onMarkRead, onActionChange, highlight }: SignalCardProps) {
  const [flagged, setFlagged] = useState(signal.aiFlagged ?? false);
  const [severityAdjusted, setSeverityAdjusted] = useState(false);
  const [actionStatus, setActionStatus] = useState<ActionStatus | null>(signal.actionStatus);
  const [showComments, setShowComments] = useState(false);
  const [commentCount, setCommentCount] = useState<number | null>(null);

  async function setAction(status: ActionStatus | null) {
    const prev = actionStatus;
    setActionStatus(status);
    onActionChange?.(signal.id, status);
    try {
      await api.setSignalAction(signal.id, status);
    } catch {
      setActionStatus(prev);
      onActionChange?.(signal.id, prev);
      toast.error("Couldn't update the action. Try again.");
    }
  }

  async function adjustSeverity(
    reason: "too_high_severity" | "too_low_severity",
  ) {
    try {
      const res = await api.submitQualityFeedback({
        targetType: "severity_classification",
        targetId: signal.id,
        verdict: "not_useful",
        reason,
      });
      setSeverityAdjusted(true);
      if (res.immediateAction) toast(res.immediateAction.description);
    } catch {
      toast.error("Couldn't adjust severity. Try again.");
    }
  }

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
        "rounded-md border border-border bg-card p-[22px] transition-[box-shadow,background-color] duration-500",
        signal.isRead && "opacity-65",
        highlight && "ring-2 ring-primary/70 bg-primary/[0.05]",
      )}
    >
      <div className="flex items-center gap-3 mb-3.5 flex-wrap">
        {/* Prefer the user's severity override (patch-21) over the AI rating. */}
        <SeverityPill severity={signal.severityOverride ?? signal.severity} />
        <CatPill>{signal.category}</CatPill>
        <span className="w-px h-3 bg-border" />
        <Link
          href={`/dashboard/competitors/${signal.competitorId}`}
          className="group inline-flex items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <CompAvatar name={signal.competitorName} size={24} />
          <span className="font-semibold text-content group-hover:underline underline-offset-2">
            {signal.competitorName}
          </span>
          <ArrowUpRight
            size={13}
            className="-translate-x-1 text-muted-foreground opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100"
          />
        </Link>
        {/* AI confidence (patch-24): renders nothing when confidence is high. */}
        <ConfidenceDot confidence={signal.aiConfidence ?? "high"} />
        <span className="flex-1" />
        <span className="tabular-nums font-mono text-muted-foreground text-xs">
          {timeAgo}
        </span>
        {/* Unread dot doubles as the read toggle (patch-29): clicking it marks the
            signal read, replacing the former dedicated "Mark as read" button. */}
        {!signal.isRead &&
          (onMarkRead ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onMarkRead(signal.id)}
                  aria-label="Mark as read"
                  className="-m-1 rounded-full p-1 text-primary transition-colors hover:text-primary/60 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span className="block size-2 rounded-full bg-current" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Mark as read</TooltipContent>
            </Tooltip>
          ) : (
            <span className="size-2 rounded-full bg-primary" />
          ))}
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

      <p className="text-lead leading-snug mb-4 font-medium tracking-tight">
        {signal.insight}
      </p>

      {/* Strategic narrative (patch-16): contextual explanation of a significant
          structured homepage change. Visually distinct (amber, left rule, italic),
          adds context below the title — never replaces it. Absent → unchanged. */}
      {signal.narrative && (
        <p className="mb-4 border-l-2 border-primary/40 pl-3 text-content italic leading-relaxed text-primary/90">
          {signal.narrative}
        </p>
      )}

      {hasDetails && (
        <div className="grid grid-cols-[100px_1fr] gap-x-8 gap-y-3.5 pt-4">
          {signal.soWhat && (
            <>
              <div className="text-dense font-medium text-muted-foreground pt-0.5">
                So what
              </div>
              <div className="text-content leading-relaxed text-foreground/85">
                {signal.soWhat}
              </div>
            </>
          )}
          {signal.recommendedAction && signal.recommendedAction !== "—" && (
            <>
              <div className="text-dense font-medium text-muted-foreground pt-0.5">
                Action
              </div>
              <div className="text-content leading-relaxed text-foreground/85">
                {signal.recommendedAction}
              </div>
            </>
          )}
        </div>
      )}

      {/* One quiet footer (patch-29): evidence on the left, feedback + the rare
          AI-severity correction (tucked in the menu) on the right. The former
          stack of action / source / feedback rows collapses into this line. */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border pt-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <SignalSourceLine
            signalId={signal.id}
            sourceType={signal.sourceType}
            detectedAt={signal.createdAt}
            showDetected={false}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 text-xs text-muted-foreground"
            onClick={() => setShowComments((v) => !v)}
          >
            <MessageSquare size={13} />
            {commentCount && commentCount > 0 ? commentCount : "Discuss"}
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={actionStatus ? "outline" : "ghost"}
                size="sm"
                className={cn("h-7 text-xs", !actionStatus && "text-muted-foreground")}
              >
                <ListTodo size={13} />
                {actionStatus ? ACTION_LABEL[actionStatus] : "Track"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Action status
              </DropdownMenuLabel>
              {ACTION_OPTIONS.map((o) => (
                <DropdownMenuItem
                  key={o.value}
                  onSelect={() => setAction(o.value)}
                  className={cn(actionStatus === o.value && "font-medium")}
                >
                  {o.label}
                </DropdownMenuItem>
              ))}
              {actionStatus && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => setAction(null)}
                    className="text-muted-foreground"
                  >
                    Clear
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="w-px h-3 bg-border" />
          <span className="text-xs text-muted-foreground">Helpful?</span>
          <FeedbackButtons
            targetType="signal"
            targetId={signal.id}
            currentVerdict={signal.feedbackVerdict}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground"
                aria-label="More actions"
              >
                <MoreHorizontal size={15} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                {severityAdjusted
                  ? "Severity feedback sent"
                  : "Is the AI severity right?"}
              </DropdownMenuLabel>
              <DropdownMenuItem
                disabled={severityAdjusted}
                onSelect={() => adjustSeverity("too_high_severity")}
              >
                Rated too high
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={severityAdjusted}
                onSelect={() => adjustSeverity("too_low_severity")}
              >
                Rated too low
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {showComments && (
        <SignalComments signalId={signal.id} onCountChange={setCommentCount} />
      )}
    </div>
  );
}
