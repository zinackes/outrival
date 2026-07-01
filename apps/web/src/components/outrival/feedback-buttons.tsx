"use client";

import { useEffect, useRef, useState } from "react";
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
//
// Legibility (2026-07): every action confirms with a toast (even "useful", which
// has no server side-effect), the current verdict is shown inline in words, and
// the state is preloaded — from server props (signals feed) or self-fetched
// (autoHydrate) — so re-clicking to remove works after a reload instead of
// silently re-submitting.
type ThumbsTargetType = "signal" | "discovery_suggestion" | "battle_card" | "digest";

interface FeedbackButtonsProps {
  targetType: ThumbsTargetType;
  targetId: string;
  currentVerdict?: QualityFeedbackVerdict | null;
  currentFeedbackId?: string | null;
  currentReason?: QualityFeedbackReason | null;
  /**
   * Fetch the user's existing verdict on mount. Use where the parent can't cheaply
   * preload it (e.g. a single battle card). Skipped on high-cardinality lists
   * (the signals feed), which preload the verdict + id through their own query.
   */
  autoHydrate?: boolean;
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
  currentReason = null,
  autoHydrate = false,
  size = "sm",
  className,
}: FeedbackButtonsProps) {
  const [verdict, setVerdict] = useState<QualityFeedbackVerdict | null>(currentVerdict);
  const [feedbackId, setFeedbackId] = useState<string | null>(currentFeedbackId);
  const [reason, setReason] = useState<QualityFeedbackReason | null>(currentReason);
  const [showReasons, setShowReasons] = useState(currentVerdict === "not_useful");
  const [busy, setBusy] = useState(false);
  // Once the user interacts, a late-arriving hydrate must not clobber their choice.
  const touched = useRef(false);

  const iconSize = size === "sm" ? 14 : 16;

  useEffect(() => {
    if (!autoHydrate || currentFeedbackId) return;
    let cancelled = false;
    void api
      .getQualityFeedback(targetType, targetId)
      .then((res) => {
        if (cancelled || touched.current || !res.feedback) return;
        setVerdict(res.feedback.verdict);
        setFeedbackId(res.feedback.id);
        setReason(res.feedback.reason);
        setShowReasons(res.feedback.verdict === "not_useful");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [autoHydrate, currentFeedbackId, targetType, targetId]);

  const handleVerdict = async (next: "useful" | "not_useful") => {
    if (busy) return;
    touched.current = true;
    setBusy(true);
    try {
      // Re-clicking the active verdict cancels it.
      if (verdict === next && feedbackId) {
        await api.deleteQualityFeedback(feedbackId);
        setVerdict(null);
        setFeedbackId(null);
        setReason(null);
        setShowReasons(false);
        toast("Feedback removed.");
        return;
      }
      const res = await api.submitQualityFeedback({ targetType, targetId, verdict: next });
      setVerdict(next);
      setFeedbackId(res.feedbackId);
      setReason(null);
      setShowReasons(next === "not_useful");
      // "not useful" has a visible server side-effect (its description); "useful"
      // has none, so give it its own confirmation — otherwise the click feels dead.
      toast(
        res.immediateAction?.description ??
          (next === "useful" ? "Thanks — marked as useful." : "Thanks for the feedback."),
      );
    } catch {
      toast.error("Couldn't save your feedback. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleReason = async (next: QualityFeedbackReason) => {
    if (busy) return;
    touched.current = true;
    setBusy(true);
    try {
      const res = await api.submitQualityFeedback({
        targetType,
        targetId,
        verdict: "not_useful",
        reason: next,
      });
      setFeedbackId(res.feedbackId);
      setReason(next);
      setShowReasons(false);
      toast(`Noted — “${REASON_LABELS[next]}”. Thanks.`);
    } catch {
      toast.error("Couldn't save your feedback. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const statusText =
    verdict === "useful"
      ? "Marked useful"
      : verdict === "not_useful"
        ? reason
          ? `Not useful · ${REASON_LABELS[reason]}`
          : "Marked not useful"
        : null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 text-xs text-text-subtle", className)}>
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

      {/* Persistent, plain-words readout of what the user submitted — so the state
          is legible at a glance (and after a reload), not just a subtle icon tint. */}
      {statusText && (
        <span aria-live="polite" className="text-xs text-text-subtle">
          {statusText}
        </span>
      )}

      {showReasons && (
        <div className="flex flex-wrap items-center gap-1">
          {REASONS_BY_TYPE[targetType].map((r) => (
            <button
              key={r}
              type="button"
              disabled={busy}
              aria-pressed={reason === r}
              onClick={() => handleReason(r)}
              className={cn(
                "rounded border px-1.5 py-0.5 text-meta transition-colors disabled:opacity-50",
                reason === r
                  ? "border-border-strong text-foreground"
                  : "border-border text-text-subtle hover:border-border-strong hover:text-foreground",
              )}
            >
              {REASON_LABELS[r]}
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
