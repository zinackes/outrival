"use client";

import Link from "next/link";
import { ArrowRightIcon, CheckIcon } from "@/components/icons";
import type { Signal } from "@/lib/api";
import { cn } from "@/lib/utils";
import { shortAge } from "@/lib/format-date";
import { sourceLabel } from "@/lib/source-labels";
import { competitorNameColor } from "@/lib/competitor-color";
import { SeverityGauge } from "@/components/outrival/severity-scale";
import { Button } from "@/components/ui/button";
import { SectionHead } from "./section-head";
import { CatText } from "./cat-pill";

/** Why a signal is in the queue. Drives the row's trailing tag. */
type Reason = "critical" | "high" | "todo" | "doing";

const REASON_LABEL: Record<Reason, string> = {
  critical: "Unread, critical",
  high: "Unread, high",
  todo: "Yours, to do",
  doing: "Yours, doing",
};

export interface QueueItem {
  signal: Signal;
  reason: Reason;
}

/**
 * What wants a decision, as opposed to what is most severe.
 *
 * The old "Recent signals" block was the inbox's top five re-sorted by severity
 * then date, so it never emptied and never distinguished "I have not looked at
 * this" from "I looked and moved on". This queue is keyed on state instead:
 * unread criticals and highs, plus anything the user put in to-do or doing. That
 * makes an empty queue meaningful, which is why the cleared state is a statement
 * rather than a blank panel.
 */
export function OverviewQueue({
  items,
  windowCount,
  rangeLabel,
  nextRunLabel,
}: {
  items: QueueItem[];
  /** Signals in the window at all, which decides which cleared copy is true. */
  windowCount: number;
  rangeLabel: string;
  /** When the next scrape lands, when we know. */
  nextRunLabel: string | null;
}) {
  return (
    <section>
      <SectionHead
        title="Needs a decision"
        sub={items.length === 0 ? "cleared" : undefined}
        divider={false}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/signals">
              Signals inbox <ArrowRightIcon size={14} />
            </Link>
          </Button>
        }
      />

      {items.length === 0 ? (
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-border bg-card px-5 py-5">
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-full border border-positive/40 bg-positive/10 text-positive"
            aria-hidden
          >
            <CheckIcon size={16} />
          </span>
          <span>
            <span className="block text-sm font-semibold">Nothing waiting.</span>
            {/* `nextRunLabel` is clock-relative, so it can differ between the server
                render and hydration a second later. */}
            <span className="text-sm text-muted-foreground" suppressHydrationWarning>
              {/* Precise on purpose: "you handled everything" would be a claim even
                  when the window only ever held mediums. */}
              {windowCount > 0
                ? `No unread critical or high in the ${rangeLabel}, and nothing in your to-do.`
                : `No signal has needed a decision in the ${rangeLabel}.`}
              {nextRunLabel ? ` Next scan ${nextRunLabel}.` : ""}
            </span>
          </span>
        </div>
      ) : (
        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
          {items.map(({ signal: s, reason }) => (
            <Link
              key={s.id}
              href={`/dashboard/signals?focus=${s.id}`}
              // Opening the signal marks it read (see signals-view), which is how a
              // row leaves this queue. No separate row action is needed.
              className="flex items-center gap-3 border-b border-border px-3.5 py-2.5 outline-none transition-colors last:border-b-0 hover:bg-accent/40 focus-visible:bg-accent/40"
            >
              <SeverityGauge severity={s.severityOverride ?? s.severity} className="shrink-0" />
              <span className="min-w-0 flex-1">
                {/* The finding leads; who and where sit under it as attribution. */}
                <span
                  className={cn(
                    "block truncate text-dense leading-snug",
                    reason === "todo" || reason === "doing"
                      ? "font-medium text-muted-foreground"
                      : "font-semibold",
                  )}
                >
                  {s.insight}
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground">
                  <span
                    className="truncate font-medium"
                    style={competitorNameColor(s.competitorColor)}
                  >
                    {s.competitorName}
                  </span>
                  {s.sourceType && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="truncate">{sourceLabel(s.sourceType)}</span>
                    </>
                  )}
                  <span aria-hidden>·</span>
                  <CatText category={s.category} />
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-sm border px-1.5 py-0.5 text-meta font-medium",
                  reason === "critical"
                    ? "border-critical/30 bg-critical/10 text-critical"
                    : reason === "high"
                      ? "border-high/30 bg-high/10 text-high"
                      : "border-primary/30 bg-primary/10 text-link",
                )}
              >
                {REASON_LABEL[reason]}
              </span>
              <time
                className="w-8 shrink-0 text-right text-meta text-muted-foreground tabular-nums"
                dateTime={s.createdAt}
                suppressHydrationWarning
              >
                {shortAge(s.createdAt)}
              </time>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
