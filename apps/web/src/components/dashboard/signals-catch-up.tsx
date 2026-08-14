"use client";

import { CheckIcon, SparkleIcon, XIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { URGENCY_META, URGENCY_ORDER, type DigestUrgency } from "@/lib/signal-shape";

/**
 * Catch-up strip: what a backlog needs that grouping cannot give it.
 *
 * It states the SHAPE of the backlog in two lines — how much is waiting, how it
 * splits across the brief's three tiers, and over how many competitors — then
 * offers the two moves that shorten it: read the week in the pane, or clear the
 * rest. It used to lead with the brief's opening paragraph instead; that was a
 * third block of prose above a list already made of prose, and the reader had to
 * read it to learn a number. The paragraph is still one press away, behind
 * "Read the brief".
 *
 * The tier counts are the LOADED unread rows (the list pages in), the headline
 * is the server's whole-set count. When they disagree the second line says so
 * rather than implying a breakdown that doesn't add up.
 *
 * Nothing here hides a signal on its own — every action is the user's, and
 * "Mark all read" is the undoable one the kebab already owned.
 */
export function CatchUpBanner({
  unread,
  tiers,
  competitors,
  brief,
  onReadBrief,
  onMarkAllRead,
  onDismiss,
}: {
  unread: number;
  /** Unread rows per digest tier, over what is loaded. */
  tiers: Record<DigestUrgency, number>;
  /** How many distinct competitors those rows come from. */
  competitors: number;
  /** Whether the feed has an AI brief to open. */
  brief: boolean;
  onReadBrief: () => void;
  onMarkAllRead: () => void;
  onDismiss: () => void;
}) {
  const counted = URGENCY_ORDER.reduce((n, tier) => n + tiers[tier], 0);
  const shown = URGENCY_ORDER.filter((tier) => tiers[tier] > 0);

  return (
    <div className="shrink-0 border-b border-border bg-surface-2/60 px-4 py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight">
            <span className="tabular-nums">{unread}</span> unread
            {competitors > 0 && (
              <>
                {" "}
                across <span className="tabular-nums">{competitors}</span>{" "}
                {competitors === 1 ? "competitor" : "competitors"}
              </>
            )}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {counted < unread && <span>In view:</span>}
            {shown.length === 0 ? (
              <span>Nothing loaded yet.</span>
            ) : (
              shown.map((tier) => (
                <span key={tier} className="flex items-center gap-1.5">
                  <span
                    className={`size-1.5 rounded-full ${URGENCY_META[tier].swatch}`}
                    aria-hidden
                  />
                  <span className="tabular-nums">{tiers[tier]}</span>
                  <span>{URGENCY_META[tier].label.toLowerCase()}</span>
                </span>
              ))
            )}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Dismiss catch-up"
          onClick={onDismiss}
        >
          <XIcon size={16} />
        </Button>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {brief && (
          <Button variant="outline" size="sm" className="h-8" onClick={onReadBrief}>
            <SparkleIcon size={16} />
            Read the brief
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-8" onClick={onMarkAllRead}>
          <CheckIcon size={16} />
          Mark all read
        </Button>
      </div>
    </div>
  );
}
