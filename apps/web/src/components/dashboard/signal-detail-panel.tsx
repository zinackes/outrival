"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CaretDownIcon,
  CircleIcon,
  ClockIcon,
  ArrowSquareOutIcon,
  ListChecksIcon,
  ChatIcon,
  DotsThreeIcon,
  SparkleIcon,
} from "@/components/icons";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "@/lib/toast";
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
import { CatPill } from "./cat-pill";
import { CompAvatar } from "./comp-avatar";
import { SignalComments } from "./signal-comments";
import { CompetitorProductChips } from "./product-chip";
import { SEV_DOT } from "./signals-list-header";
import { ChangeLedger } from "@/components/outrival/change-ledger";
import { WhyInsightPanel } from "@/components/outrival/why-insight-panel";
import { FeedbackButtons } from "@/components/outrival/feedback-buttons";
import { SeverityScale } from "@/components/outrival/severity-scale";
import { AiOutputWarning } from "@/components/outrival/ai-output-warning";
import { VisualDiff } from "@/components/outrival/visual-diff";
import { ChangeBreakdown } from "@/components/outrival/change-breakdown";
import { DiffPreview, countDiffLines } from "@/components/outrival/diff-preview";
import { SignalFacts } from "@/components/outrival/signal-facts";

/**
 * The workspace's right column: one signal read as a document, not a card.
 *
 * Two devices carry it. The masthead states the verdict — severity as a position
 * on its four-band scale, then the finding, then a mono readout of the facts the
 * machine produced. Below it, section labels hang in a right-aligned margin so
 * the body keeps one continuous left spine: the reading order IS the product's
 * argument (what moved → why it matters → what to do) and it should read as one
 * document, not as five stacked panels. The margin collapses under the label on
 * a narrow pane, where there is no room to spend on it.
 *
 * Exactly one element in the document carries a fill and the accent — the
 * action — because that is the only part the reader is meant to leave with.
 *
 * Mount it keyed on `signal.id`: every disclosure and the scroll position then
 * reset with the signal, which is what "opening the next one" should mean.
 */

// Gutter geometry, declared once so the masthead and footer stay on the same
// spine as the labelled sections.
const RAIL = "@2xl:flex @2xl:gap-6";
const RAIL_GUTTER = "shrink-0 @2xl:w-28 @2xl:text-right";
const RAIL_BODY = "min-w-0 flex-1";
// The reading measure. The container is wide so captures and lists can use the
// pane; prose has to stay a column, so it carries its own cap. 36rem is ~75
// characters at 15px — 42rem allowed ~90, the top of the readable band, and it
// was picked to narrow the gap with the full-width blocks. That traded the
// reading for tidiness, which is the wrong way round.
const PROSE = "max-w-[36rem]";

// "More from <competitor>" is fed the whole loaded feed for that competitor, so on
// a busy one it ran to dozens of rows and pushed the feedback and the thread off
// the bottom of the document. Show a glance, then reveal in feed-sized pages.
const RELATED_INITIAL = 5;
const RELATED_STEP = 10;

// The page's own lines, collapsed and expanded. A glance is enough to see WHICH
// roles or plans moved; the full set is for the reader who wants to audit it.
const DIFF_LINES_COLLAPSED = 8;
const DIFF_LINES_EXPANDED = 80;

// Mirrors ConfidenceDot's tones so the two never disagree about how loud a
// given confidence level is: amber only at "low", neutral at "moderate".
const CONFIDENCE_COPY: Record<
  "low" | "medium",
  { label: string; why: string; chip: string }
> = {
  medium: {
    label: "Moderate",
    why: "Reasonably inferred, with some extrapolation. Worth a quick sanity check.",
    chip: "border-border bg-surface-2 text-muted-foreground",
  },
  low: {
    label: "Low",
    why: "Not enough evidence to be certain. Treat this as a hypothesis, not a fact.",
    chip: "border-medium/30 bg-medium/12 text-medium",
  },
};

// Same buckets as the feed's threat meter, said in words: three bars and a
// four-band severity scale in the same masthead would read as one instrument.
function threatLabel(score: number): string {
  if (score >= 0.4) return "Elevated";
  if (score >= 0.2) return "Moderate";
  return "Low";
}

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
  const [showAllLines, setShowAllLines] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [visualFailed, setVisualFailed] = useState(false);
  const [relatedShown, setRelatedShown] = useState(RELATED_INITIAL);

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

  // The thread's size, read before it is opened: a "Discuss" button that only
  // learns there are three comments after you click it hides the discussion
  // from everyone who had no reason to click. Shares SignalComments' cache key,
  // so opening the section costs no second fetch.
  const commentsQ = useQuery({
    queryKey: ["signalComments", signal.id],
    queryFn: () => api.listSignalComments(signal.id).then((r) => r.comments),
    enabled: interactive,
  });
  const commentCount = commentsQ.data?.length ?? null;

  // An existing thread is content, not an action: show it rather than making
  // the reader open it. Runs once per signal (the panel is keyed on its id).
  useEffect(() => {
    if (commentCount && commentCount > 0) setShowComments(true);
  }, [commentCount]);

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
  // null at high confidence: nothing to warn about, so nothing is drawn.
  const conf = signal.aiConfidence ?? "high";
  const confidence = conf === "high" ? null : CONFIDENCE_COPY[conf];
  // The detail's screenshot flags are a pHash proxy — R2 can still miss — so a
  // capture that fails to load retracts the whole Evidence block it anchored,
  // rather than leaving a labelled empty frame.
  const hasVisual =
    Boolean(detail?.screenshots?.before && detail?.screenshots?.after) &&
    !visualFailed;
  // A backfill signal quotes a capture, not the live page: the lines it cites
  // were removed weeks or months ago, so "Open source" lands on a page where
  // none of them are left. The archived capture is replayable, and the chip that
  // already declares the provenance is the honest place to reach it from.
  const archive = detail?.archive ?? null;
  const archivedOn = archive?.capturedAt
    ? format(new Date(archive.capturedAt), "MMM d")
    : null;
  const archiveChip = (
    <>
      <ArchiveIcon className="size-3.5" />
      {archivedOn ? `Archived ${archivedOn}` : "From archive"}
    </>
  );
  const archiveChipClass =
    "inline-flex items-center gap-1 rounded-sm border border-border bg-surface-2 px-2 py-0.5 text-meta font-medium text-muted-foreground";
  const changes = detail?.changes ?? [];
  // The lines the page added and removed. For the sources with no structured
  // breakdown, which is most of them, this is what makes the Evidence section
  // exist at all: without it a jobs or pricing signal showed the reader no fact.
  const diffText = detail?.diffText ?? null;
  // What the render will actually produce, not what the payload contains: the
  // control promises a number the reader then counts, so it has to be the
  // parser's count with the same denoising applied.
  const diffLineCount = diffText ? countDiffLines(diffText, true) : 0;
  // Hacker News only: the numbers that say whether the post landed, plus the
  // thread. Stored on the change since the source shipped, read here for the
  // first time.
  const engagement = detail?.engagement ?? null;
  // The rows a sibling extractor wrote for the same capture (roles, plans).
  const facts = detail?.facts ?? null;
  const hasLedger = Boolean(detail?.humanChangeBefore || detail?.humanChangeAfter);
  const hasEvidence =
    hasVisual || changes.length > 0 || Boolean(diffText) || Boolean(engagement);
  const heldBack =
    signal.filteredReason && signal.filteredReason !== "backfill"
      ? signal.filteredReason
      : null;

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
            <ArrowLeftIcon size={16} />
          </Button>
        )}
        <Link
          href={`/dashboard/competitors/${signal.competitorId}`}
          className="group inline-flex min-w-0 items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              <ArrowSquareOutIcon size={16} />
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
                  <ListChecksIcon size={16} />
                  {actionStatus ? ACTION_LABEL[actionStatus] : "Track"}
                  <CaretDownIcon size={16} className="opacity-60" />
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
                  <DotsThreeIcon size={16} />
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
                  <CircleIcon size={16} />
                  {signal.isRead ? "Mark unread" : "Mark read"}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setShowComments((v) => !v)}>
                  <ChatIcon size={16} /> Discuss
                </DropdownMenuItem>
                {onSnooze && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                      <ClockIcon size={16} /> Snooze
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

      {/* Wide and centred, with the measure held by the prose itself (PROSE)
          rather than by the container. Capping the container was what left a
          dead band down the side of a large pane; capping the text instead
          keeps lines readable while the width goes to what actually wants it —
          the before/after captures and the related list. */}
      {/* overscroll-contain: reaching the end of the pane must not hand the
          wheel to whatever scrolls behind it — chaining made the whole page,
          list included, move once the document ran out. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <motion.article
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className="@container mx-auto max-w-[960px] px-5 py-6 lg:px-8"
        >
          {/* Masthead — the verdict in the margin, the finding, its provenance.
              Each fact sits where its nature puts it: the margin carries how
              much to care, the finding's tail carries how it is filed, and the
              line under it carries provenance. A cell that always says the same
              thing is not a fact, it is furniture. */}
          <header className={RAIL}>
            {/* pt-0.5 puts the ticks on the lead's first line, now that nothing
                sits above it for the margin to align against. */}
            <div className={cn(RAIL_GUTTER, "mb-4 @2xl:mb-0 @2xl:pt-0.5")}>
              <SeverityScale severity={severity} layout="column" />
            </div>

            <div className={RAIL_BODY}>
              {/* The labels ride the tail of the finding rather than sitting
                  in a row above it: a chip row pushed the lead off the top of
                  the block, so the severity in the margin had nothing to align
                  with. Read in order it is now one sentence — what happened,
                  then how it is filed. */}
              <h2
                className={cn(
                  PROSE,
                  "text-lead font-semibold leading-snug tracking-tight text-foreground",
                )}
              >
                {signal.insight}{" "}
                <span className="ml-0.5 inline-flex translate-y-px items-center gap-1.5 whitespace-nowrap align-middle">
                  <CatPill size="compact">{signal.category}</CatPill>
                  {signal.filteredReason === "backfill" && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        {archive?.url ? (
                          <a
                            href={archive.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={cn(
                              archiveChipClass,
                              "outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                            )}
                          >
                            {archiveChip}
                          </a>
                        ) : (
                          <span className={archiveChipClass}>{archiveChip}</span>
                        )}
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[280px]">
                        {archive?.url
                          ? "Reconstructed from the web archive, so it was never sent as an alert. Opens the capture this signal quotes; Open source opens the page as it stands now."
                          : "Reconstructed from the web archive. This change happened before we started monitoring, so it wasn't sent as an alert."}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {heldBack && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="rounded-sm border border-border bg-surface-2 px-2 py-0.5 text-meta font-medium text-muted-foreground">
                          Held back
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Not sent as an alert:{" "}
                        {FILTERED_REASON_LABEL[heldBack] ??
                          heldBack.replace(/_/g, " ")}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {/* The page went back and forth on this exact delta. Every flip
                      after the first was folded into this signal, so the chip is
                      where the reader learns the number is not settled — and the
                      tooltip is the only place the two readings are named. */}
                  {signal.oscillation && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="rounded-sm border border-border bg-surface-2 px-2 py-0.5 text-meta font-medium text-muted-foreground tabular-nums">
                          Oscillating ×{signal.oscillation.observations}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[280px]">
                        This page served both readings{" "}
                        {signal.oscillation.observations} times — “
                        {signal.oscillation.variantA}” and “
                        {signal.oscillation.variantB}”. Likely an A/B test still
                        running, so the later flips were folded in here instead of
                        raising a signal each.
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {/* Confidence only shows when it is worth a second look — the
                      rule ConfidenceDot has always applied. A permanent "High"
                      spends a slot on a non-event. */}
                  {confidence && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className={cn(
                            "rounded-sm border px-2 py-0.5 text-meta font-medium",
                            confidence.chip,
                          )}
                        >
                          {confidence.label} confidence
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[260px]">
                        {confidence.why}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </span>
              </h2>

              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-dense text-muted-foreground">
                <span>Detected</span>
                <time
                  dateTime={signal.createdAt}
                  className="tabular-nums text-foreground"
                >
                  {format(created, "MMM d, HH:mm")}
                </time>
                <span aria-hidden>·</span>
                <span>{formatDistanceToNow(created, { addSuffix: true })}</span>
                <span aria-hidden>·</span>
                {/* Threat sits with the provenance rather than beside severity:
                    it IS the severity weighted by overlap and relevance, so as a
                    peer it invited reading one piece of evidence as two. */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      className="cursor-default rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {threatLabel(signal.threatScore)} threat
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[260px]">
                    Severity weighted by how much this competitor overlaps with you,
                    and how relevant the change is.
                  </TooltipContent>
                </Tooltip>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  onClick={() => setShowWhy(true)}
                  className="rounded-sm underline underline-offset-2 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Why this insight?
                </button>
              </div>

              <WhyInsightPanel
                signalId={signal.id}
                open={showWhy}
                onOpenChange={setShowWhy}
              />

              {interactive && flagged && (
                <div className="mt-4">
                  <AiOutputWarning
                    targetType="signal"
                    targetId={signal.id}
                    onResolved={() => setFlagged(false)}
                  />
                </div>
              )}
            </div>
          </header>

          {(hasLedger || facts) && (
            <Section label="What changed">
              {hasLedger && (
                <ChangeLedger
                  before={detail!.humanChangeBefore}
                  after={detail!.humanChangeAfter}
                />
              )}
              {/* The structured rows the same capture produced. On a jobs signal
                  the pair above is usually absent (the change is a SET of roles,
                  which the classifier answers with null), so this IS the answer to
                  "what changed": the roles, by name, with their apply links. */}
              {facts && (
                <div className={cn("max-w-[36rem]", hasLedger && "mt-4 border-t border-border pt-3")}>
                  <SignalFacts facts={facts} />
                </div>
              )}
            </Section>
          )}
          {!injected && detailQ.isFetching && !detail && (
            <Section label="What changed">
              <Skeleton className="h-16 w-full" />
            </Section>
          )}

          {(signal.soWhat || signal.narrative) && (
            <Section label="Why it matters">
              {signal.soWhat && (
                <p className={cn(PROSE, "text-content leading-relaxed text-foreground")}>
                  {signal.soWhat}
                </p>
              )}
              {signal.narrative && (
                <div className={cn(signal.soWhat && "mt-3")}>
                  <button
                    type="button"
                    onClick={() => setShowContext((v) => !v)}
                    aria-expanded={showContext}
                    className="flex items-center gap-1.5 rounded-sm text-dense font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <SparkleIcon size={14} className="shrink-0" aria-hidden />
                    Full context
                    <CaretDownIcon
                      className={cn(
                        "size-3.5 transition-transform",
                        showContext && "rotate-180",
                      )}
                      aria-hidden
                    />
                  </button>
                  {showContext && (
                    <p className={cn(PROSE, "mt-2.5 text-content leading-relaxed text-foreground")}>
                      {signal.narrative}
                    </p>
                  )}
                </div>
              )}
            </Section>
          )}

          {signal.recommendedAction && signal.recommendedAction !== "—" && (
            // The document's single fill and single accent, shared with the Track
            // button in the bar above: in this pane the accent means "act".
            <Section label="What to do" tone="action">
              <p className={cn(PROSE, "rounded-md bg-surface-2 px-4 py-3.5 text-content leading-relaxed text-foreground")}>
                {signal.recommendedAction}
              </p>
            </Section>
          )}

          {hasEvidence && (
            <Section label="Evidence">
              {engagement && (
                <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-dense">
                  {engagement.points !== null && (
                    <span className="text-foreground">
                      <span className="tabular-nums font-medium">
                        {engagement.points}
                      </span>{" "}
                      points
                    </span>
                  )}
                  {engagement.comments !== null && (
                    <span className="text-muted-foreground">
                      <span className="tabular-nums">{engagement.comments}</span>{" "}
                      comments
                    </span>
                  )}
                  {engagement.url && (
                    <a
                      href={engagement.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-sm text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Read the thread
                      <ArrowSquareOutIcon size={14} aria-hidden />
                    </a>
                  )}
                </div>
              )}
              {hasVisual && (
                <VisualDiff
                  signalId={signal.id}
                  beforeCapturedAt={detail?.screenshots?.beforeCapturedAt}
                  afterCapturedAt={detail?.screenshots?.afterCapturedAt}
                  onUnavailable={() => setVisualFailed(true)}
                />
              )}
              {changes.length > 0 &&
                (hasVisual || detail?.humanChangeAfter ? (
                  <div className={cn(hasVisual && "mt-4")}>
                    <button
                      type="button"
                      onClick={() => setShowAllChanges((v) => !v)}
                      aria-expanded={showAllChanges}
                      className="flex items-center gap-1.5 rounded-sm text-dense font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {showAllChanges ? "Hide" : "Show all"} {changes.length} change
                      {changes.length === 1 ? "" : "s"}
                      <CaretDownIcon
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
              {diffText && (
                <div className={cn((hasVisual || changes.length > 0) && "mt-4")}>
                  <DiffPreview
                    diffText={diffText}
                    maxLines={showAllLines ? DIFF_LINES_EXPANDED : DIFF_LINES_COLLAPSED}
                    hideTruncationNote={diffLineCount > DIFF_LINES_COLLAPSED}
                    denoise
                  />
                  {diffLineCount > DIFF_LINES_COLLAPSED && (
                    <button
                      type="button"
                      onClick={() => setShowAllLines((v) => !v)}
                      aria-expanded={showAllLines}
                      className="mt-2 flex items-center gap-1.5 rounded-sm text-dense font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {showAllLines ? "Show fewer lines" : `Show all ${diffLineCount} lines`}
                      <CaretDownIcon
                        className={cn(
                          "size-3.5 transition-transform",
                          showAllLines && "rotate-180",
                        )}
                        aria-hidden
                      />
                    </button>
                  )}
                </div>
              )}
            </Section>
          )}

          <Section label={`More from ${signal.competitorName}`}>
            {related.length > 0 ? (
              <ul className="-mx-2">
                {related.slice(0, relatedShown).map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => onSelectRelated(s.id)}
                      className="group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
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
                        {formatDistanceToNow(new Date(s.createdAt), {
                          addSuffix: false,
                        })}
                      </time>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No other signals from this competitor yet.
              </p>
            )}
            {related.length > relatedShown && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 w-full text-muted-foreground"
                onClick={() => setRelatedShown((n) => n + RELATED_STEP)}
              >
                {related.length - relatedShown > RELATED_STEP
                  ? `Show ${RELATED_STEP} more · ${related.length - relatedShown} left`
                  : `Show ${related.length - relatedShown} more`}
              </Button>
            )}
            <Link
              href={`/dashboard/competitors/${signal.competitorId}`}
              className="mt-3 inline-flex items-center gap-1 rounded-sm text-dense text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              View {signal.competitorName} profile
              <ArrowUpRightIcon size={14} />
            </Link>
          </Section>

          {interactive && (
            <div className={cn("mt-8 border-t border-border pt-4", RAIL)}>
              <div className={cn(RAIL_GUTTER, "hidden @2xl:block")} aria-hidden />
              <div className={RAIL_BODY}>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-dense text-muted-foreground">
                      Was this useful?
                    </span>
                    <FeedbackButtons
                      targetType="signal"
                      targetId={signal.id}
                      currentVerdict={signal.feedbackVerdict}
                      currentFeedbackId={signal.feedbackId}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-mr-2 h-7 text-muted-foreground"
                    onClick={() => setShowComments((v) => !v)}
                    aria-expanded={showComments}
                  >
                    <ChatIcon size={16} />
                    {commentCount && commentCount > 0
                      ? `${commentCount} comment${commentCount === 1 ? "" : "s"}`
                      : "Discuss"}
                  </Button>
                </div>
                {showComments && <SignalComments signalId={signal.id} />}
              </div>
            </div>
          )}
        </motion.article>
      </div>
    </div>
  );
}

/**
 * A beat of the document. The label hangs in the right-aligned margin once the
 * pane is wide enough to spend the space on it (container query, not viewport —
 * the pane is a column inside the view, not the window), and stacks above the
 * content below that.
 */
function Section({
  label,
  children,
  tone = "default",
}: {
  label: string;
  children: React.ReactNode;
  /** `action` gives the label the document's one accent. */
  tone?: "default" | "action";
}) {
  return (
    <section className={cn("mt-6 border-t border-border pt-5", RAIL)}>
      <h3
        className={cn(
          RAIL_GUTTER,
          "text-dense font-medium @2xl:pt-0.5",
          tone === "action" ? "text-link" : "text-muted-foreground",
        )}
      >
        {label}
      </h3>
      <div className={cn(RAIL_BODY, "mt-2 @2xl:mt-0")}>{children}</div>
    </section>
  );
}
