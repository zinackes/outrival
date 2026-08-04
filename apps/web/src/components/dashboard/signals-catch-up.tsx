"use client";

import { CheckIcon, SparkleIcon, StackIcon, XIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

/**
 * Catch-up strip: what a backlog needs that grouping cannot give it.
 *
 * Folding answers redundancy (N rows that read as one sentence). It does NOT
 * answer volume: fifty signals that are all different are still fifty reads, and
 * collapsing them would only hide distinct information behind a chevron. So past
 * a backlog threshold the list leads with the three moves that actually shorten
 * it: read the week in one paragraph, fold what is redundant, or clear the rest.
 *
 * Nothing here hides a signal on its own — every action is the user's, and
 * "Mark all read" is the undoable one the kebab already owned.
 */
export function CatchUpBanner({
  unread,
  brief,
  foldable,
  onReadBrief,
  onFold,
  onMarkAllRead,
  onDismiss,
}: {
  unread: number;
  /** The AI brief of the feed, when there is one. */
  brief: string | null;
  /** How many rows folding similar signals would collapse. 0 hides the action. */
  foldable: number;
  onReadBrief: () => void;
  onFold: () => void;
  onMarkAllRead: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="shrink-0 border-b border-border bg-surface-2/60 px-4 py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight">
            <span className="tabular-nums">{unread}</span> unread signals
          </p>
          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {brief ??
              "Fold the near-duplicates, or clear the backlog in one move."}
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
        {foldable > 0 && (
          <Button variant="outline" size="sm" className="h-8" onClick={onFold}>
            <StackIcon size={16} />
            Fold similar
            <span className="tabular-nums text-muted-foreground">{foldable}</span>
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
