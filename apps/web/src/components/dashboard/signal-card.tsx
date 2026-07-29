"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowUpRightIcon,
  DotsThreeIcon,
  ListChecksIcon,
  ChatIcon,
  SparkleIcon,
  CaretDownIcon,
  ArchiveIcon,
} from "@/components/icons";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { api, type Signal, type ActionStatus } from "@/lib/api";
import {
  ACTION_OPTIONS,
  ACTION_LABEL,
  SNOOZE_PRESETS,
  FILTERED_REASON_LABEL,
} from "@/lib/signal-actions";
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
import { competitorNameColor } from "@/lib/competitor-color";
import { CompetitorProductChips } from "./product-chip";
import { SeverityBadge } from "./severity-pill";
import { CatPill } from "./cat-pill";
import { CompAvatar } from "./comp-avatar";
import { SignalComments } from "./signal-comments";
import { SignalSourceLine } from "@/components/outrival/signal-source-line";
import { FeedbackButtons } from "@/components/outrival/feedback-buttons";
import { ConfidenceDot } from "@/components/outrival/confidence-dot";
import { ThreatMeter } from "@/components/outrival/threat-meter";
import { AiOutputWarning } from "@/components/outrival/ai-output-warning";

interface SignalCardProps {
  signal: Signal;
  onMarkRead?: (id: string) => void;
  /** Dwell auto-read: fired once the card has lingered in the viewport. */
  onAutoRead?: (id: string) => void;
  /** Revert an auto-read signal back to unread. */
  onMarkUnread?: (id: string) => void;
  /** This signal was read automatically (by dwell), so the click-to-unread affordance shows. */
  wasAutoRead?: boolean;
  onActionChange?: (id: string, status: ActionStatus | null) => void;
  /** Dismiss this signal as noise (hides it + trains the relevance threshold). */
  onDismiss?: (id: string) => void;
  /** Snooze this signal out of the feed for `ms` milliseconds. */
  onSnooze?: (id: string, ms: number) => void;
  highlight?: boolean;
  /** Keyboard-nav focus (j/k). Reuses the deep-link highlight ring. */
  focused?: boolean;
  /** When false, hides the mutating footer (track/feedback/discuss/severity) so
   *  the card can render as a read-only detail (e.g. sample mode). */
  interactive?: boolean;
}

// How long (ms) a card must stay substantially in view before it auto-reads.
// A dwell gate — not first-pixel visibility — so a fast scroll-through doesn't
// bulk-mark everything read (the well-documented "scroll = read" misread trap).
const AUTO_READ_DWELL_MS = 1500;

export function SignalCard({
  signal,
  onMarkRead,
  onAutoRead,
  onMarkUnread,
  wasAutoRead,
  onActionChange,
  onDismiss,
  onSnooze,
  highlight,
  focused,
  interactive = true,
}: SignalCardProps) {
  const [flagged, setFlagged] = useState(signal.aiFlagged ?? false);
  const [severityAdjusted, setSeverityAdjusted] = useState(false);
  const [actionStatus, setActionStatus] = useState<ActionStatus | null>(signal.actionStatus);
  const [showComments, setShowComments] = useState(false);
  // The strategic narrative (patch-16) lives in a collapsed "Context" below the
  // decision path, closed by default — it was duplicating "So what" up top.
  const [showContext, setShowContext] = useState(false);
  // Reads SignalComments' own cache once the thread is open, rather than being
  // pushed a count. A card in a feed must not fetch a thread it isn't showing —
  // the detail panel, which shows one signal, does prefetch it.
  const commentsQ = useQuery({
    queryKey: ["signalComments", signal.id],
    queryFn: () => api.listSignalComments(signal.id).then((r) => r.comments),
    enabled: interactive && showComments,
  });
  const commentCount = commentsQ.data?.length ?? null;
  const [trackOpen, setTrackOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Held in a ref so the parent re-creating the callback each render doesn't tear
  // down and rebuild the observer (which would keep resetting the dwell timer).
  const onAutoReadRef = useRef(onAutoRead);
  onAutoReadRef.current = onAutoRead;

  // Intelligent auto-read: mark read only once the card has dwelled ≥60% in the
  // viewport for AUTO_READ_DWELL_MS. IntersectionObserver tracks visibility; the
  // timer is the dwell gate. Cleared the moment the card leaves view, so flicking
  // past it doesn't mark it read.
  const canRevert = Boolean(signal.isRead && wasAutoRead && onMarkUnread);
  useEffect(() => {
    if (signal.isRead || !onAutoReadRef.current) return;
    const el = rootRef.current;
    if (!el) return;
    let dwell: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          if (!dwell)
            dwell = setTimeout(() => onAutoReadRef.current?.(signal.id), AUTO_READ_DWELL_MS);
        } else if (dwell) {
          clearTimeout(dwell);
          dwell = null;
        }
      },
      { threshold: [0, 0.6, 1] },
    );
    observer.observe(el);
    return () => {
      if (dwell) clearTimeout(dwell);
      observer.disconnect();
    };
  }, [signal.id, signal.isRead]);

  // Keyboard actions: signals-view dispatches a `signal-kbd` CustomEvent on this
  // card's root when it's the focused card. Handled with real React state — far
  // more reliable than simulating clicks/keydowns on a Radix trigger.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    function onKbd(e: Event) {
      const action = (e as CustomEvent<string>).detail;
      if (action === "track") setTrackOpen(true);
      else if (action === "discuss") setShowComments((v) => !v);
    }
    el.addEventListener("signal-kbd", onKbd as EventListener);
    return () => el.removeEventListener("signal-kbd", onKbd as EventListener);
  }, []);

  // Click anywhere on an auto-read card (outside its own controls) to bring it back.
  function handleCardClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!canRevert) return;
    if ((e.target as HTMLElement).closest("a, button, input, [role='menuitem'], [data-comments]"))
      return;
    onMarkUnread?.(signal.id);
  }

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
      ref={rootRef}
      id={`signal-${signal.id}`}
      tabIndex={-1}
      role="article"
      aria-label={`${signal.competitorName}: ${signal.severityOverride ?? signal.severity} ${signal.category} signal`}
      onClick={handleCardClick}
      className={cn(
        "rounded-md border border-border bg-card p-6 outline-none transition-[box-shadow,background-color,opacity] duration-500",
        canRevert && "cursor-pointer hover:opacity-90",
        (highlight || focused) && "ring-2 ring-primary/70",
        highlight && "bg-primary/[0.05]",
      )}
    >
      <div className="flex items-center gap-3 mb-3.5 flex-wrap">
        {/* Prefer the user's severity override (patch-21) over the AI rating.
            Solid severity badge, matching the Overview's "Recent signals" list. */}
        <SeverityBadge severity={signal.severityOverride ?? signal.severity} />
        <CatPill size="compact">{signal.category}</CatPill>
        {/* Provenance (L2): this signal was reconstructed from the web archive at
            onboarding, not caught live — a visible badge, not a footnote. */}
        {signal.filteredReason === "backfill" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-meta font-medium text-muted-foreground">
                <ArchiveIcon className="size-3.5" />
                From archive
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Reconstructed from the web archive. This change happened before we
              started monitoring, so it wasn&apos;t sent as an alert.
            </TooltipContent>
          </Tooltip>
        )}
        <span className="w-px h-3 bg-border" />
        <Link
          href={`/dashboard/competitors/${signal.competitorId}`}
          className="group inline-flex items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <CompAvatar
            name={signal.competitorName}
            url={signal.competitorUrl}
            size={28}
          />
          <span
            className="font-semibold text-base group-hover:underline underline-offset-2"
            style={competitorNameColor(signal.competitorColor)}
          >
            {signal.competitorName}
          </span>
          <ArrowUpRightIcon
            size={16}
            className="-translate-x-1 text-muted-foreground opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100"
          />
        </Link>
        {/* Product attribution (patch-28): which product(s) this competitor is
            specific to. Renders nothing unless in all-products scope with a specific
            link — see CompetitorProductChips. */}
        <CompetitorProductChips competitorId={signal.competitorId} />
        {/* Confidence + threat used to crowd this header (9+ chips read as slop);
            they moved to the quiet meta line in the footer. */}
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
              <TooltipContent className="flex items-center gap-1.5">
                Mark as read
                <kbd className="rounded-sm border border-border/60 px-1 font-mono text-meta">
                  R
                </kbd>
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="size-2 rounded-full bg-primary" />
          ))}
        {/* Auto-read affordance: a hollow dot to bring the signal back to unread.
            (Clicking anywhere on the card body does the same.) */}
        {canRevert && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onMarkUnread?.(signal.id)}
                aria-label="Mark as unread"
                className="-m-1 rounded-full p-1 text-muted-foreground transition-colors hover:text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span className="block size-2 rounded-full border border-current" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="flex items-center gap-1.5">
              Read automatically · mark unread
              <kbd className="rounded-sm border border-border/60 px-1 font-mono text-meta">
                R
              </kbd>
            </TooltipContent>
          </Tooltip>
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

      <p className="text-content leading-snug mb-4 font-medium tracking-tight">
        {signal.insight}
      </p>

      {hasDetails && (
        // Labels stacked above their text so the values align full-width with the
        // insight above them (the old 64px label column indented them ~86px, which
        // read as misaligned against the flush insight/narrative).
        <div className="space-y-3.5 pt-4">
          {signal.soWhat && (
            <div>
              <div className="mb-1 text-dense font-medium text-muted-foreground">
                So what
              </div>
              <p className="text-content leading-relaxed text-foreground/85">
                {signal.soWhat}
              </p>
            </div>
          )}
          {signal.recommendedAction && signal.recommendedAction !== "—" && (
            <div>
              <div className="mb-1 text-dense font-medium text-muted-foreground">
                Action
              </div>
              <p className="text-content leading-relaxed text-foreground/85">
                {signal.recommendedAction}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Strategic narrative (patch-16), demoted to a collapsed "Context" so it stops
          duplicating "So what" at the top of the card. Closed by default → the decision
          path (insight → so what → action) reads first. */}
      {signal.narrative && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowContext((v) => !v)}
            aria-expanded={showContext}
            className="flex items-center gap-1.5 text-dense font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
          >
            <SparkleIcon size={14} className="shrink-0" aria-hidden />
            Context
            <CaretDownIcon
              className={cn(
                "size-3.5 transition-transform",
                showContext && "rotate-180",
              )}
              aria-hidden
            />
          </button>
          {showContext && (
            <p className="mt-2 rounded-md bg-surface-2 px-3 py-2.5 text-content leading-relaxed text-foreground/85">
              {signal.narrative}
            </p>
          )}
        </div>
      )}

      {/* Single-row footer: the discreet meta (source, confidence, threat) sits
          flush-left, the action cluster (discuss / track / helpful / correction)
          flush-right, both on one baseline so the two never read as misaligned.
          Wraps to stacked lines only when the card is too narrow (mobile sheet). */}
      {interactive && (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 border-t border-border pt-3.5">
        {/* Meta line — provenance + calibration: source (opens "Why this insight?"),
            AI confidence (renders nothing when high), the threat meter, held-back. */}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SignalSourceLine
            signalId={signal.id}
            sourceType={signal.sourceType}
            detectedAt={signal.createdAt}
            showDetected={false}
          />
          <ConfidenceDot confidence={signal.aiConfidence ?? "high"} />
          <ThreatMeter score={signal.threatScore} />
          {/* Backfill provenance moved to a header badge; the footer keeps the
              quiet "held back" note for genuine moderation suppressions. */}
          {signal.filteredReason && signal.filteredReason !== "backfill" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="shrink-0 text-xs text-muted-foreground">· Held back</span>
              </TooltipTrigger>
              <TooltipContent>
                Not sent as an alert:{" "}
                {FILTERED_REASON_LABEL[signal.filteredReason] ??
                  signal.filteredReason.replace(/_/g, " ")}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {/* Action cluster — what to do with the signal. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 text-xs text-muted-foreground"
            onClick={() => setShowComments((v) => !v)}
          >
            <ChatIcon size={16} />
            {commentCount && commentCount > 0 ? commentCount : "Discuss"}
          </Button>
          <span className="w-px h-3 bg-border" />
          <DropdownMenu open={trackOpen} onOpenChange={setTrackOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant={actionStatus ? "outline" : "ghost"}
                size="sm"
                className={cn("h-7 text-xs", !actionStatus && "text-muted-foreground")}
              >
                <ListChecksIcon size={16} />
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
          <FeedbackButtons
            targetType="signal"
            targetId={signal.id}
            currentVerdict={signal.feedbackVerdict}
            currentFeedbackId={signal.feedbackId}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground"
                aria-label="More actions"
              >
                <DotsThreeIcon size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {onDismiss && (
                <>
                  <DropdownMenuItem onSelect={() => onDismiss(signal.id)}>
                    Dismiss as noise
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {onSnooze && (
                <>
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    Snooze
                  </DropdownMenuLabel>
                  {SNOOZE_PRESETS.map((p) => (
                    <DropdownMenuItem
                      key={p.label}
                      onSelect={() => onSnooze(signal.id, p.ms)}
                    >
                      {p.label}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                </>
              )}
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
      )}

      {interactive && showComments && (
        <div data-comments>
          <SignalComments signalId={signal.id} />
        </div>
      )}
    </div>
  );
}
