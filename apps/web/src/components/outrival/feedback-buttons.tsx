"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown, X } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type QualityFeedbackReason,
  type QualityFeedbackVerdict,
} from "@/lib/api";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Atomic 1-click feedback on an AI output (patch-21). The verdict is one click;
// the reason is always optional. Re-clicking the active verdict cancels it (and
// reverts the immediate action server-side). Severity feedback and NPS have their
// own controls — this component covers signal / discovery / battle card / digest.
type ThumbsTargetType = "signal" | "discovery_suggestion" | "battle_card" | "digest";

interface FeedbackButtonsProps {
  targetType: ThumbsTargetType;
  targetId: string;
  currentVerdict?: QualityFeedbackVerdict | null;
  currentFeedbackId?: string | null;
  size?: "sm" | "md";
  className?: string;
}

// Optional reasons offered after a "not useful", scoped per target so the user
// only sees relevant ones.
const REASONS_BY_TYPE: Record<ThumbsTargetType, QualityFeedbackReason[]> = {
  signal: ["irrelevant", "incorrect", "trivial", "duplicate", "outdated", "other"],
  discovery_suggestion: ["irrelevant", "duplicate", "other"],
  battle_card: ["incorrect", "outdated", "other"],
  digest: ["irrelevant", "trivial", "other"],
};

const REASON_LABELS: Record<QualityFeedbackReason, string> = {
  irrelevant: "Not relevant",
  incorrect: "Inaccurate",
  trivial: "Too trivial",
  too_high_severity: "Severity too high",
  too_low_severity: "Severity too low",
  duplicate: "Duplicate",
  outdated: "Outdated",
  other: "Other",
};

export function FeedbackButtons({
  targetType,
  targetId,
  currentVerdict = null,
  currentFeedbackId = null,
  size = "sm",
  className,
}: FeedbackButtonsProps) {
  const [verdict, setVerdict] = useState<QualityFeedbackVerdict | null>(currentVerdict);
  const [feedbackId, setFeedbackId] = useState<string | null>(currentFeedbackId);
  const [showReasons, setShowReasons] = useState(false);
  const [busy, setBusy] = useState(false);

  const iconSize = size === "sm" ? 14 : 16;

  const handleVerdict = async (next: "useful" | "not_useful") => {
    if (busy) return;
    setBusy(true);
    try {
      // Re-clicking the active verdict cancels it.
      if (verdict === next && feedbackId) {
        await api.deleteQualityFeedback(feedbackId);
        setVerdict(null);
        setFeedbackId(null);
        setShowReasons(false);
        toast("Feedback removed.");
        return;
      }
      const res = await api.submitQualityFeedback({ targetType, targetId, verdict: next });
      setVerdict(next);
      setFeedbackId(res.feedbackId);
      setShowReasons(next === "not_useful");
      if (res.immediateAction) toast(res.immediateAction.description);
    } catch {
      toast.error("Couldn't save your feedback. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleReason = async (reason: QualityFeedbackReason) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.submitQualityFeedback({
        targetType,
        targetId,
        verdict: "not_useful",
        reason,
      });
      setFeedbackId(res.feedbackId);
      setShowReasons(false);
    } catch {
      toast.error("Couldn't save your feedback. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("flex items-center gap-1.5 text-xs text-text-subtle", className)}>
      <span className="sr-only">Was this useful?</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Mark as useful"
            aria-pressed={verdict === "useful"}
            disabled={busy}
            onClick={() => handleVerdict("useful")}
            className={cn(
              "rounded p-1 transition-colors hover:text-foreground disabled:opacity-50",
              verdict === "useful" && "text-positive",
            )}
          >
            <ThumbsUp size={iconSize} />
          </button>
        </TooltipTrigger>
        <TooltipContent>{verdict === "useful" ? "Remove feedback" : "Useful"}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Mark as not useful"
            aria-pressed={verdict === "not_useful"}
            disabled={busy}
            onClick={() => handleVerdict("not_useful")}
            className={cn(
              "rounded p-1 transition-colors hover:text-foreground disabled:opacity-50",
              verdict === "not_useful" && "text-critical",
            )}
          >
            <ThumbsDown size={iconSize} />
          </button>
        </TooltipTrigger>
        <TooltipContent>{verdict === "not_useful" ? "Remove feedback" : "Not useful"}</TooltipContent>
      </Tooltip>

      {showReasons && (
        <div className="flex flex-wrap items-center gap-1">
          {REASONS_BY_TYPE[targetType].map((reason) => (
            <button
              key={reason}
              type="button"
              disabled={busy}
              onClick={() => handleReason(reason)}
              className="rounded border border-border px-1.5 py-0.5 text-meta text-text-subtle transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50"
            >
              {REASON_LABELS[reason]}
            </button>
          ))}
          <button
            type="button"
            aria-label="Dismiss reason selector"
            onClick={() => setShowReasons(false)}
            className="rounded p-0.5 text-text-subtle hover:text-foreground"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
