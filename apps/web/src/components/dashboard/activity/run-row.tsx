"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { CaretRightIcon, ArrowSquareOutIcon } from "@/components/icons";
import { formatDistanceToNow } from "date-fns";
import type {
  ActivityCaptured,
  ActivityCapturedDelta,
  ActivityChange,
  ActivityEvent,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatTime, formatDateTime } from "@/lib/format-date";
import { disclosureMotion } from "@/lib/motion";
import { sourceLabel } from "@/lib/source-labels";
import { CompAvatar } from "@/components/dashboard/comp-avatar";
import {
  capturedSummary,
  duration,
  eventOutcome,
  fmtPrice,
  hasCapturedDetail,
  kindLabel,
  PERIOD_SHORT,
  sectionName,
  skipCopy,
  STATIC_PHRASE,
  type Outcome,
} from "./format";

// One run. The outcome is carried by the WEIGHT of the mark in the gutter, not by
// a colour repeated down a column: solid for a change, hollow for a baseline,
// hairline for a quiet run. Only a failure spends colour, so a healthy page reads
// calm and the row that needs acting on cannot be missed. The mark is always
// reinforced by the sentence beside it, which is why the status column could go.

const MARK: Record<Outcome, string> = {
  change: "bg-foreground",
  failed: "bg-critical",
  first_capture: "bg-transparent ring-1 ring-inset ring-border-strong",
  no_change: "bg-border-strong",
};

function whatHappened(e: ActivityEvent, outcome: Outcome): string {
  if (outcome === "change") return e.changeSummary ?? "Something changed on this page";
  if (outcome === "first_capture") return "First capture, saved as the baseline";
  if (outcome === "failed") return "We couldn't reach the page, nothing was captured";
  // A skip is quiet, but it is not "nothing new": no page was opened at all.
  return skipCopy(e)?.short ?? "Nothing new";
}

// The right-hand cell: what the run holds. A change row shows what MOVED (a total
// reads oddly next to "what changed"); a quiet row shows the standing total, which
// is the whole value of a run that found nothing.
function CapturedCell({ event }: { event: ActivityEvent }) {
  if (event.capturedDelta) return <CapturedDeltaContent delta={event.capturedDelta} />;
  if (event.captured) {
    const summary = capturedSummary(event.captured);
    return summary ? (
      <span className="tabular-nums">{summary}</span>
    ) : (
      <span>Nothing found</span>
    );
  }
  // A structured homepage change carries no data payload; name the regions that
  // moved instead, so the cell is never empty on a row that found something.
  const kinds = event.structuredChanges ?? [];
  if (kinds.length > 0) {
    const first = kindLabel(kinds[0]!.kind).toLowerCase();
    return (
      <span>
        {first}
        {kinds.length > 1 && `, +${kinds.length - 1}`}
      </span>
    );
  }
  if (eventOutcome(event) === "failed") return <span>no capture</span>;
  return null;
}

export function RunRow({
  event,
  isOpen,
  onToggle,
}: {
  event: ActivityEvent;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const outcome = eventOutcome(event);
  const href = event.isSelf
    ? "/dashboard/products"
    : `/dashboard/competitors/${event.competitorId}`;

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        title={formatDateTime(event.recordedAt)}
        className={cn(
          "grid w-full grid-cols-[3px_minmax(0,1fr)_14px] items-start gap-x-3 gap-y-1 rounded-md px-2 py-2.5 text-left text-dense text-muted-foreground transition-colors",
          // Centred, not baseline-aligned: the row is one line, and the mark and
          // the favicon are objects that have to sit on the name's midline rather
          // than hang off its baseline.
          "sm:grid-cols-[46px_3px_minmax(0,1.15fr)_minmax(0,2fr)_minmax(0,0.95fr)_14px] sm:items-center",
          "hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
          isOpen && "bg-surface-2",
        )}
      >
        <span className="text-meta text-text-subtle tabular-nums max-sm:col-start-2">
          {formatTime(event.recordedAt)}
        </span>
        <span
          className={cn(
            "h-3.5 rounded-sm max-sm:col-start-1 max-sm:row-span-4 max-sm:h-full max-sm:min-h-4",
            MARK[outcome],
          )}
          aria-hidden
        />
        <span className="flex min-w-0 items-center gap-1.5 max-sm:col-start-2">
          <CompAvatar name={event.competitorName} url={event.url} size={15} />
          <span className="truncate">
            <span className="font-medium text-foreground">{event.competitorName}</span>
            <span className="text-muted-foreground"> · {sourceLabel(event.sourceType)}</span>
          </span>
        </span>
        <span
          className={cn(
            "truncate max-sm:col-start-2",
            (outcome === "change" || outcome === "failed") && "text-foreground",
          )}
        >
          {whatHappened(event, outcome)}
        </span>
        <span className="truncate max-sm:col-start-2">
          <CapturedCell event={event} />
        </span>
        <CaretRightIcon
          className={cn(
            "size-3.5 justify-self-end text-text-subtle transition-transform max-sm:col-start-3 max-sm:row-start-1",
            isOpen && "rotate-90",
          )}
          aria-hidden
        />
      </button>
      {/* The panel used to appear in one frame, which moved every row under it by
          its full height with no sign of what pushed them. It opens on the feed's
          spring now, so the rows below travel with it. */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div {...disclosureMotion}>
            <RunPanel event={event} outcome={outcome} entityHref={href} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// Everything the row could not hold, in ONE place: what changed, what the run
// captured, how long it took, and the page it read. The captured breakdown used
// to live in a modal opened from the row it was already inside.
function RunPanel({
  event,
  outcome,
  entityHref,
}: {
  event: ActivityEvent;
  outcome: Outcome;
  entityHref: string;
}) {
  return (
    <div className="flex flex-col gap-3 px-2 pb-4 pt-1 text-sm sm:pl-[61px]">
      {outcome === "change" ? (
        <ChangeDetail event={event} />
      ) : (
        <QuietDetail event={event} outcome={outcome} />
      )}
      {hasCapturedDetail(event.captured) && <CapturedDetail captured={event.captured!} />}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-dense text-muted-foreground">
        <span className="tabular-nums">Checked in {duration(event.durationMs)}</span>
        <PageLink event={event} outcome={outcome} />
        <Link href={entityHref} className="text-link hover:underline">
          Open {event.isSelf ? "your product" : event.competitorName}
        </Link>
      </div>
    </div>
  );
}

// The way out of the panel, named for what the run actually did. A capture links
// to the page it read; a failed run links to the page it tried, which is still
// the useful thing to open. A skip links nowhere — the whole point of it is that
// there was no such page, and the old fallback to the competitor's homepage put
// "View the page we read" on a URL nothing had ever opened.
function PageLink({ event, outcome }: { event: ActivityEvent; outcome: Outcome }) {
  const href = event.readUrl ?? (outcome === "failed" ? event.targetUrl : null);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-link hover:underline"
    >
      <ArrowSquareOutIcon className="size-3.5" aria-hidden />
      {event.readUrl ? "View the page we read" : "View the page we tried"}
    </a>
  );
}

// One labeled before→after line. The arrow appears only when both sides exist;
// otherwise it degrades to a single value (added or removed) or a static phrase.
function ChangeLine({ change }: { change: ActivityChange }) {
  const before = change.before?.trim() || null;
  const after = change.after?.trim() || null;
  const subject = sectionName(change.field);

  let body: ReactNode;
  if (before && after) {
    body = (
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-muted-foreground line-through">{before}</span>
        <span className="text-text-subtle" aria-hidden>
          →
        </span>
        <span className="text-foreground">{after}</span>
      </span>
    );
  } else if (after) {
    body = <span className="text-foreground">{after}</span>;
  } else if (before) {
    body = <span className="text-muted-foreground line-through">{before}</span>;
  } else if (subject) {
    body = <span className="capitalize text-foreground">{subject}</span>;
  } else {
    body = <span className="text-muted-foreground">{STATIC_PHRASE[change.kind] ?? "Updated"}</span>;
  }

  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="w-28 shrink-0 text-dense text-muted-foreground">{kindLabel(change.kind)}</span>
      <div className="min-w-0 flex-1">{body}</div>
    </div>
  );
}

function ChangeDetail({ event }: { event: ActivityEvent }) {
  const changes = event.structuredChanges ?? [];
  if (changes.length > 0) {
    return (
      <div className="flex flex-col gap-1.5">
        {changes.map((c, i) => (
          <ChangeLine key={`${c.kind}-${c.field}-${i}`} change={c} />
        ))}
      </div>
    );
  }
  if (event.humanChangeBefore || event.humanChangeAfter) {
    return (
      <ChangeLine
        change={{
          kind: "",
          field: "",
          before: event.humanChangeBefore ?? null,
          after: event.humanChangeAfter ?? null,
        }}
      />
    );
  }
  return (
    <p className="text-muted-foreground">
      {event.changeSummary ?? "No detail was captured for this change."}
    </p>
  );
}

// A quiet run is not a dead end: it says what it means and, for a no-change run,
// when the page last actually moved.
function QuietDetail({ event, outcome }: { event: ActivityEvent; outcome: Outcome }) {
  const skip = skipCopy(event);
  return (
    <div className="flex flex-col gap-1.5 text-muted-foreground">
      <p>
        {skip
          ? skip.detail
          : outcome === "first_capture"
            ? "The first time we captured this page. It is the baseline now: every later check is compared against it, and anything that moves shows up here."
            : outcome === "failed"
              ? "The site did not serve the page. We stop rather than push, so nothing was captured and the source will be tried again on its next check."
              : "We read this page and it matches our last capture, so nothing changed."}
      </p>
      {!skip && outcome === "no_change" && event.lastChangedAt && (
        <p>
          Last actual change{" "}
          <span className="tabular-nums">
            {formatDistanceToNow(new Date(event.lastChangedAt), { addSuffix: true })}
          </span>
          .
        </p>
      )}
    </div>
  );
}

function DeltaArrow({ before, after }: { before: ReactNode; after: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1 tabular-nums">
      <span className="text-muted-foreground">{before}</span>
      <span className="text-text-subtle" aria-hidden>
        →
      </span>
      <span className="text-foreground">{after}</span>
    </span>
  );
}

export function CapturedDeltaContent({ delta }: { delta: ActivityCapturedDelta }) {
  if (delta.kind === "jobs") {
    return (
      <span className="inline-flex items-baseline gap-1">
        <DeltaArrow before={delta.before} after={delta.after} />
        <span>roles</span>
      </span>
    );
  }
  if (delta.kind === "pricingCount") {
    return (
      <span className="inline-flex items-baseline gap-1">
        <DeltaArrow before={delta.before} after={delta.after} />
        <span>plans</span>
      </span>
    );
  }
  if (delta.kind === "reviews") {
    if (delta.unit === "score") {
      return (
        <DeltaArrow before={`${delta.before.toFixed(1)}★`} after={`${delta.after.toFixed(1)}★`} />
      );
    }
    return (
      <span className="inline-flex items-baseline gap-1">
        <DeltaArrow before={delta.before.toLocaleString()} after={delta.after.toLocaleString()} />
        <span>reviews</span>
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5">
      <span className="min-w-0 truncate text-foreground">{delta.plan}</span>
      <DeltaArrow
        before={fmtPrice(delta.before, delta.currency)}
        after={fmtPrice(delta.after, delta.currency)}
      />
      {delta.more > 0 && <span className="shrink-0">+{delta.more} more</span>}
    </span>
  );
}

const REVIEW_SUBS: Array<{
  key: keyof NonNullable<Extract<ActivityCaptured, { kind: "reviews" }>["subScores"]>;
  label: string;
}> = [
  { key: "easeOfUse", label: "Ease of use" },
  { key: "support", label: "Support" },
  { key: "features", label: "Features" },
  { key: "value", label: "Value" },
];

function CapturedDetail({ captured }: { captured: ActivityCaptured }) {
  if (captured.kind === "jobs") {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-dense text-muted-foreground">Open roles by team</p>
        <ul className="flex max-w-md flex-col gap-0.5">
          {captured.byDept.map((d) => (
            <li key={d.department} className="flex items-baseline justify-between gap-4 text-dense">
              <span className="min-w-0 truncate text-foreground">{d.department}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">{d.count}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (captured.kind === "pricing") {
    const removed = captured.removedPlans ?? [];
    const priceLabel = (p: { price: number | null; currency: string; billingPeriod: string }) =>
      p.price != null
        ? `${fmtPrice(p.price, p.currency)}/${PERIOD_SHORT[p.billingPeriod] ?? p.billingPeriod}`
        : "Custom";
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-dense text-muted-foreground">Every plan on the page now</p>
        <ul className="flex max-w-md flex-col gap-0.5">
          {captured.plans.map((p, i) => (
            <li
              key={`${p.planName}-${i}`}
              className="flex items-baseline justify-between gap-4 text-dense"
            >
              <span className="inline-flex min-w-0 items-baseline gap-1.5">
                <span className={cn("min-w-0 truncate", p.isNew ? "text-positive" : "text-foreground")}>
                  {p.planName}
                </span>
                {p.isNew && <span className="shrink-0 text-meta font-medium text-positive">New</span>}
              </span>
              <span
                className={cn(
                  "shrink-0 tabular-nums",
                  p.isNew ? "text-positive" : "text-muted-foreground",
                )}
              >
                {priceLabel(p)}
              </span>
            </li>
          ))}
          {removed.map((p, i) => (
            <li
              key={`removed-${p.planName}-${i}`}
              className="flex items-baseline justify-between gap-4 text-dense"
            >
              <span className="inline-flex min-w-0 items-baseline gap-1.5">
                <span className="min-w-0 truncate text-muted-foreground line-through">{p.planName}</span>
                <span className="shrink-0 text-meta font-medium text-critical">Removed</span>
              </span>
              <span className="shrink-0 text-muted-foreground line-through tabular-nums">
                {priceLabel(p)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-dense text-muted-foreground">
        <span className="text-foreground tabular-nums">{captured.score?.toFixed(1)}★</span>
        {captured.reviewCount > 0 && (
          <>
            {" from "}
            <span className="tabular-nums">{captured.reviewCount.toLocaleString()}</span> reviews
          </>
        )}
      </p>
      {captured.subScores && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-dense text-muted-foreground">
          {REVIEW_SUBS.map(({ key, label }) => {
            const v = captured.subScores![key];
            if (v == null) return null;
            return (
              <li key={key}>
                {label} <span className="text-foreground tabular-nums">{v.toFixed(1)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
