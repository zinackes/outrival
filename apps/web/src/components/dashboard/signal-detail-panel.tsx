"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  Circle,
  Clock,
  ExternalLink,
  ListTodo,
  MessageSquare,
  MoreHorizontal,
  Sparkles,
  Target,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { motion } from "motion/react";
import { api, type ActionStatus, type Signal, type SignalDetail } from "@/lib/api";
import {
  ACTION_OPTIONS,
  ACTION_LABEL,
  FILTERED_REASON_LABEL,
  SNOOZE_PRESETS,
} from "@/lib/signal-actions";
import { cn } from "@/lib/utils";
import { competitorNameColor } from "@/lib/competitor-color";
import { sourceLabel } from "@/lib/source-labels";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SeverityBadge } from "./severity-pill";
import { CatPill } from "./cat-pill";
import { CompAvatar } from "./comp-avatar";
import { SignalComments } from "./signal-comments";
import { CompetitorProductChips } from "./product-chip";
import { SEV_DOT } from "./signals-list-header";
import { ChangeLedger } from "@/components/outrival/change-ledger";
import { SignalSourceLine } from "@/components/outrival/signal-source-line";
import { FeedbackButtons } from "@/components/outrival/feedback-buttons";
import { ConfidenceDot } from "@/components/outrival/confidence-dot";
import { ThreatMeter } from "@/components/outrival/threat-meter";
import { AiOutputWarning } from "@/components/outrival/ai-output-warning";
import { VisualDiff } from "@/components/outrival/visual-diff";
import { ChangeBreakdown } from "@/components/outrival/change-breakdown";

/**
 * The workspace's right column: one signal read as a document, not a card.
 *
 * The reading order IS the product's argument — what moved, why it matters, what
 * to do — so each beat is a flat section separated by a hairline instead of a
 * boxed panel. The one accent in the whole document sits on the action, because
 * that is the only part the reader is meant to leave with.
 *
 * Mount it keyed on `signal.id`: every disclosure and the scroll position then
 * reset with the signal, which is what "opening the next one" should mean.
 */
export function SignalDetailPanel({
  signal,
  interactive = true,
  detail: injectedDetail,
  related,
  onSelectRelated,
  onBack,
  onMarkRead,
  onMarkUnread,
  onActionChange,
  onDismiss,
  onSnooze,
}: {
  signal: Signal;
  /** false hides every mutating control (sample / demo mode). */
  interactive?: boolean;
  /** Inject a fixture instead of fetching — sample mode. */
  detail?: SignalDetail | null;
  related: Signal[];
  onSelectRelated: (id: string) => void;
  /** Mobile only: dismiss the full-screen sheet. */
  onBack?: () => void;
  onMarkRead?: (id: string) => void;
  onMarkUnread?: (id: string) => void;
  onActionChange?: (id: string, status: ActionStatus | null) => void;
  onDismiss?: (id: string) => void;
  onSnooze?: (id: string, ms: number) => void;
}) {
  const [actionStatus, setActionStatus] = useState<ActionStatus | null>(
    signal.actionStatus,
  );
  const [trackOpen, setTrackOpen] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [showAllChanges, setShowAllChanges] = useState(false);
  const [commentCount, setCommentCount] = useState<number | null>(null);
  const [flagged, setFlagged] = useState(signal.aiFlagged ?? false);
  const [severityAdjusted, setSeverityAdjusted] = useState(false);

  const injected = injectedDetail !== undefined;
  // Shares the ["signalDetail", id] cache with the "Why this insight?" panel.
  const detailQ = useQuery({
    queryKey: ["signalDetail", signal.id],
    queryFn: () => api.getSignalDetail(signal.id).then((r) => r.signal),
    enabled: !injected,
  });
  const detail = injected ? injectedDetail : (detailQ.data ?? null);

  // Keyboard actions dispatched by the view on the focused signal (t / c). The
  // panel is the single mount point for a signal's controls, so it listens on
  // the document rather than the view reaching into its internals.
  useEffect(() => {
    function onKbd(e: Event) {
      const action = (e as CustomEvent<string>).detail;
      if (action === "track") setTrackOpen(true);
      else if (action === "discuss") setShowComments((v) => !v);
    }
    document.addEventListener("signal-detail-action", onKbd as EventListener);
    return () =>
      document.removeEventListener("signal-detail-action", onKbd as EventListener);
  }, []);

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

  async function adjustSeverity(reason: "too_high_severity" | "too_low_severity") {
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

  const severity = signal.severityOverride ?? signal.severity;
  const created = new Date(signal.createdAt);
  const hasVisual = Boolean(detail?.screenshots?.before && detail?.screenshots?.after);
  const changes = detail?.changes ?? [];
  const hasEvidence = hasVisual || changes.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Action bar — who moved and what to do about it, always in reach. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 py-2.5 backdrop-blur-md lg:px-6">
        {onBack && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            aria-label="Back to signals"
            onClick={onBack}
          >
            <ArrowLeft size={16} />
          </Button>
        )}
        <Link
          href={`/dashboard/competitors/${signal.competitorId}`}
          className="group inline-flex min-w-0 items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <CompAvatar
            name={signal.competitorName}
            url={signal.competitorUrl}
            size={22}
          />
          <span
            className="truncate text-dense font-semibold underline-offset-2 group-hover:underline"
            style={competitorNameColor(signal.competitorColor)}
          >
            {signal.competitorName}
          </span>
        </Link>
        <span className="hidden shrink-0 text-dense text-muted-foreground sm:inline">
          · {sourceLabel(signal.sourceType)}
        </span>
        <CompetitorProductChips competitorId={signal.competitorId} />

        <span className="flex-1" />

        {detail?.sourceUrl && (
          <Button variant="outline" size="sm" className="h-8 shrink-0" asChild>
            <a href={detail.sourceUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={13} />
              <span className="hidden xl:inline">Open source</span>
            </a>
          </Button>
        )}

        {interactive && (
          <>
            <DropdownMenu open={trackOpen} onOpenChange={setTrackOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={actionStatus ? "secondary" : "default"}
                  size="sm"
                  className="h-8 shrink-0"
                >
                  <ListTodo size={13} />
                  {actionStatus ? ACTION_LABEL[actionStatus] : "Track"}
                  <ChevronDown size={11} className="opacity-60" />
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

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground"
                  aria-label="More actions"
                >
                  <MoreHorizontal size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem
                  onSelect={() =>
                    signal.isRead
                      ? onMarkUnread?.(signal.id)
                      : onMarkRead?.(signal.id)
                  }
                >
                  <Circle size={13} />
                  {signal.isRead ? "Mark unread" : "Mark read"}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setShowComments((v) => !v)}>
                  <MessageSquare size={13} /> Discuss
                </DropdownMenuItem>
                {onSnooze && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                      <Clock size={13} /> Snooze
                    </DropdownMenuLabel>
                    {SNOOZE_PRESETS.map((p) => (
                      <DropdownMenuItem
                        key={p.label}
                        onSelect={() => onSnooze(signal.id, p.ms)}
                      >
                        {p.label}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
                {onDismiss && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onDismiss(signal.id)}>
                      Dismiss as noise
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
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
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <motion.article
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className="mx-auto max-w-[820px] px-5 py-6 lg:px-8"
        >
          <div className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
            <SeverityBadge severity={severity} />
            <CatPill size="compact">{signal.category}</CatPill>
            {signal.filteredReason === "backfill" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 font-medium">
                    <Archive className="size-3" />
                    From archive
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Reconstructed from the web archive — this change happened before we
                  started monitoring, so it wasn&apos;t sent as an alert.
                </TooltipContent>
              </Tooltip>
            )}
            <span aria-hidden>·</span>
            <time dateTime={signal.createdAt} className="tabular-nums">
              {format(created, "MMM d, HH:mm")}
            </time>
            <span aria-hidden>·</span>
            <span className="tabular-nums">
              {formatDistanceToNow(created, { addSuffix: true })}
            </span>
            <ConfidenceDot confidence={signal.aiConfidence ?? "high"} />
            <ThreatMeter score={signal.threatScore} />
            {signal.filteredReason && signal.filteredReason !== "backfill" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="shrink-0">· Held back</span>
                </TooltipTrigger>
                <TooltipContent>
                  Not sent as an alert —{" "}
                  {FILTERED_REASON_LABEL[signal.filteredReason] ??
                    signal.filteredReason.replace(/_/g, " ")}
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          <h2 className="mt-3 text-xl font-semibold leading-snug tracking-tight text-foreground">
            {signal.insight}
          </h2>

          {interactive && flagged && (
            <div className="mt-4">
              <AiOutputWarning
                targetType="signal"
                targetId={signal.id}
                onResolved={() => setFlagged(false)}
              />
            </div>
          )}

          {(detail?.humanChangeBefore || detail?.humanChangeAfter) && (
            <section className="mt-6">
              <Label>What changed</Label>
              <div className="mt-2">
                <ChangeLedger
                  before={detail.humanChangeBefore}
                  after={detail.humanChangeAfter}
                />
              </div>
            </section>
          )}
          {!injected && detailQ.isFetching && !detail && (
            <div className="mt-6 space-y-2.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}

          {signal.soWhat && (
            <Section label="Why it matters">
              <p className="text-content leading-relaxed text-foreground/85">
                {signal.soWhat}
              </p>
            </Section>
          )}

          {signal.recommendedAction && signal.recommendedAction !== "—" && (
            // The document's single accent, shared with the Track button in the bar
            // above: in this pane the accent means "act". The label uses --link
            // rather than the raw accent so it clears 4.5:1 on the light surface.
            <div className="mt-6 rounded-r-md border-l-2 border-primary bg-surface-2 px-4 py-3.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-dense font-medium text-link">
                <Target size={13} aria-hidden /> What to do
              </div>
              <p className="text-content leading-relaxed text-foreground/90">
                {signal.recommendedAction}
              </p>
            </div>
          )}

          {signal.narrative && (
            <div className="mt-6">
              <button
                type="button"
                onClick={() => setShowContext((v) => !v)}
                aria-expanded={showContext}
                className="flex items-center gap-1.5 text-dense font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
              >
                <Sparkles size={13} className="shrink-0" aria-hidden />
                Context
                <ChevronDown
                  className={cn("size-3.5 transition-transform", showContext && "rotate-180")}
                  aria-hidden
                />
              </button>
              {showContext && (
                <p className="mt-2 rounded-md bg-surface-2 px-4 py-3 text-content leading-relaxed text-foreground/85">
                  {signal.narrative}
                </p>
              )}
            </div>
          )}

          {hasEvidence && (
            <Section label="Source captures">
              {hasVisual && <VisualDiff signalId={signal.id} />}
              {changes.length > 0 &&
                (hasVisual || detail?.humanChangeAfter ? (
                  <div className={cn(hasVisual && "mt-4")}>
                    <button
                      type="button"
                      onClick={() => setShowAllChanges((v) => !v)}
                      aria-expanded={showAllChanges}
                      className="flex items-center gap-1.5 text-dense font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
                    >
                      {showAllChanges ? "Hide" : "Show all"} {changes.length} change
                      {changes.length === 1 ? "" : "s"}
                      <ChevronDown
                        className={cn(
                          "size-3.5 transition-transform",
                          showAllChanges && "rotate-180",
                        )}
                        aria-hidden
                      />
                    </button>
                    {showAllChanges && (
                      <div className="mt-3">
                        <ChangeBreakdown changes={changes} />
                      </div>
                    )}
                  </div>
                ) : (
                  <ChangeBreakdown changes={changes} />
                ))}
            </Section>
          )}

          <Section label="Where this came from">
            <SignalSourceLine
              signalId={signal.id}
              sourceType={signal.sourceType}
              detectedAt={signal.createdAt}
            />
          </Section>

          <Section label={`More from ${signal.competitorName}`}>
            {related.length > 0 ? (
              <ul className="-mx-2">
                {related.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => onSelectRelated(s.id)}
                      className="group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/40"
                    >
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          SEV_DOT[s.severityOverride ?? s.severity],
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-dense text-foreground/90 group-hover:text-foreground">
                        {s.insight}
                      </span>
                      <time className="shrink-0 text-meta tabular-nums text-muted-foreground">
                        {formatDistanceToNow(new Date(s.createdAt), { addSuffix: false })}
                      </time>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-dense text-muted-foreground">
                No other signals from this competitor yet.
              </p>
            )}
            <Link
              href={`/dashboard/competitors/${signal.competitorId}`}
              className="mt-3 inline-flex items-center gap-1 text-dense text-muted-foreground transition-colors hover:text-foreground"
            >
              View {signal.competitorName} profile
              <ArrowUpRight size={13} />
            </Link>
          </Section>

          {interactive && (
            <Section label="Discussion">
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 h-7 text-muted-foreground"
                onClick={() => setShowComments((v) => !v)}
                aria-expanded={showComments}
              >
                <MessageSquare size={13} />
                {commentCount && commentCount > 0
                  ? `${commentCount} comment${commentCount === 1 ? "" : "s"}`
                  : "Add a comment"}
              </Button>
              {showComments && (
                <SignalComments signalId={signal.id} onCountChange={setCommentCount} />
              )}
            </Section>
          )}

          {interactive && (
            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <span className="text-dense text-muted-foreground">
                Was this signal useful?
              </span>
              <FeedbackButtons
                targetType="signal"
                targetId={signal.id}
                currentVerdict={signal.feedbackVerdict}
                currentFeedbackId={signal.feedbackId}
              />
            </div>
          )}
        </motion.article>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-dense font-medium text-muted-foreground">{children}</div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 border-t border-border pt-5">
      <Label>{label}</Label>
      <div className="mt-2">{children}</div>
    </section>
  );
}
