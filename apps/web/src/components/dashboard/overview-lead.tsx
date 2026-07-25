"use client";

import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import type { Signal } from "@/lib/api";
import { cn } from "@/lib/utils";
import { shortAge } from "@/lib/format-date";
import { sourceLabel } from "@/lib/source-labels";
import { competitorNameColor } from "@/lib/competitor-color";
import { SeverityScale } from "@/components/outrival/severity-scale";
import { Button } from "@/components/ui/button";
import { BarSpark } from "./bar-spark";
import { CatText } from "./cat-pill";
import { CompAvatar } from "./comp-avatar";

export interface PulseData {
  /** Signals inside the picked window. */
  count: number;
  /** Signals in the window of the same length immediately before it. */
  prevCount: number;
  /**
   * False when the fetched page (newest N) doesn't reach back far enough to cover
   * the previous window. The comparison is then withheld rather than understated.
   */
  comparable: boolean;
  /** One bucket per bar, oldest first. */
  bars: number[];
  /** One label per bucket, for the hover tooltip. */
  barLabels: string[];
  /** Unread criticals in the window, and who they belong to. */
  criticals: number;
  criticalLead: string | null;
  /** Monitored competitor sources, or null when the health read failed. */
  sources: { ok: number; total: number; failing: number; paused: number } | null;
}

/**
 * The lead: the one signal of the window worth reading first, with the period's
 * numbers beside it rather than above it.
 *
 * The page used to open on four counters and then a top five sorted by severity
 * then date, which put a six day old critical above a twenty minute old high and
 * duplicated the Signals inbox. A monitoring product's home should answer "what
 * happened" in one read, so the highest-threat signal of the window is promoted to
 * a story carrying all three layers the pipeline generates (what changed, why it
 * matters, what to do), and the counters become a rail: three stats, each with a
 * comparison or a destination.
 */
export function OverviewLead({
  signal,
  pulse,
  onMarkRead,
  rangeLabel,
}: {
  signal: Signal;
  pulse: PulseData;
  /** Omitted in sample mode (nothing to write). */
  onMarkRead?: (id: string) => void;
  rangeLabel: string;
}) {
  const severity = signal.severityOverride ?? signal.severity;

  return (
    <div className="grid overflow-hidden rounded-lg border border-border-strong bg-card lg:grid-cols-[minmax(0,1fr)_264px]">
      <div className="flex min-w-0 flex-col gap-3 px-5 py-4">
        {/* Who and how bad, before what. Same order as the signal detail pane. */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
          <SeverityScale severity={severity} size="compact" />
          <span aria-hidden>·</span>
          <Link
            href={`/dashboard/competitors/${signal.competitorId}`}
            className="inline-flex items-center gap-2 font-semibold hover:underline"
            style={competitorNameColor(signal.competitorColor)}
          >
            <CompAvatar name={signal.competitorName} url={signal.competitorUrl} size={20} />
            {signal.competitorName}
          </Link>
          <span aria-hidden>·</span>
          <CatText category={signal.category} />
          {signal.sourceType && (
            <>
              <span aria-hidden>·</span>
              <span>{sourceLabel(signal.sourceType)}</span>
            </>
          )}
          <span aria-hidden>·</span>
          <time className="font-mono tabular-nums" dateTime={signal.createdAt}>
            {shortAge(signal.createdAt)}
          </time>
        </div>

        <p className="m-0 max-w-[44ch] text-lead font-medium leading-snug tracking-tight text-pretty lg:text-xl">
          {signal.insight}
        </p>

        {signal.soWhat && (
          <p className="m-0 max-w-[62ch] text-sm text-muted-foreground">{signal.soWhat}</p>
        )}

        {signal.recommendedAction && (
          <div className="mt-0.5 flex max-w-[66ch] items-start gap-2.5 border-t border-dashed border-border pt-3 text-sm">
            <span className="shrink-0 pt-px text-xs text-muted-foreground">Do this</span>
            <span>{signal.recommendedAction}</span>
          </div>
        )}

        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <Button asChild size="sm">
            <Link href={`/dashboard/signals?focus=${signal.id}`}>Open the signal</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/dashboard/competitors/${signal.competitorId}`}>
              View {signal.competitorName}
            </Link>
          </Button>
          {onMarkRead && !signal.isRead && (
            <Button size="sm" variant="ghost" onClick={() => onMarkRead(signal.id)}>
              <Check size={13} /> Mark read
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col border-border bg-background-2 max-lg:flex-row max-lg:border-t max-sm:flex-col lg:border-l">
        <PulseStat
          label="Signals"
          // Only when there is a prior period to compare against: with nothing
          // before, the value line ("13 this period, 0 before") already is the
          // comparison, and a "+13" chip beside it says it twice.
          trailing={
            pulse.comparable && pulse.prevCount > 0 && pulse.prevCount !== pulse.count ? (
              <span className="font-mono tabular-nums">
                {pulse.count > pulse.prevCount ? "+" : ""}
                {pulse.count - pulse.prevCount}
              </span>
            ) : null
          }
        >
          <StatValue value={pulse.count} />
          <span className="text-xs text-muted-foreground">
            {pulse.comparable
              ? `this period, ${pulse.prevCount} before`
              : `in the ${rangeLabel}`}
          </span>
          <div className="mt-1">
            <BarSpark data={pulse.bars} labels={pulse.barLabels} unit="signal" />
            <div className="mt-1 flex justify-between font-mono text-meta text-muted-foreground">
              <span>{pulse.barLabels[0]}</span>
              <span>{pulse.barLabels[pulse.barLabels.length - 1]}</span>
            </div>
          </div>
        </PulseStat>

        <PulseStat
          label="Critical, open"
          href={pulse.criticals > 0 ? "/dashboard/signals?view=critical" : undefined}
        >
          <StatValue value={pulse.criticals} tone={pulse.criticals > 0 ? "critical" : undefined} />
          <span className="text-xs text-muted-foreground">
            {pulse.criticals > 0 ? pulse.criticalLead : "nothing to handle"}
          </span>
        </PulseStat>

        {pulse.sources && (
          <PulseStat label="Sources healthy" href="/dashboard/activity">
            <StatValue value={pulse.sources.ok} />
            <span className="text-xs text-muted-foreground">
              of {pulse.sources.total} watched
            </span>
            <span className="text-xs text-link">
              {pulse.sources.failing === 0 && pulse.sources.paused === 0
                ? "all reporting"
                : [
                    pulse.sources.failing > 0 ? `${pulse.sources.failing} failing` : null,
                    pulse.sources.paused > 0 ? `${pulse.sources.paused} paused` : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
            </span>
          </PulseStat>
        )}
      </div>
    </div>
  );
}

/**
 * One rail cell. Wraps in a link when the stat has somewhere to go, so every
 * number on the rail is either compared or clickable (the old strip had three
 * dead cells out of four).
 */
function PulseStat({
  label,
  trailing,
  href,
  children,
}: {
  label: string;
  trailing?: React.ReactNode;
  href?: string;
  children: React.ReactNode;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          {label}
          {href && (
            <ArrowRight
              size={11}
              className="opacity-0 transition-opacity group-hover/stat:opacity-100"
              aria-hidden
            />
          )}
        </span>
        {trailing && <span className="text-muted-foreground">{trailing}</span>}
      </div>
      {children}
    </>
  );
  const className = cn(
    "group/stat flex min-w-0 flex-1 flex-col gap-1 border-border px-4 py-3",
    "border-b last:border-b-0 max-lg:border-b-0 max-lg:border-r max-lg:last:border-r-0",
    "max-sm:border-b max-sm:border-r-0 max-sm:last:border-b-0",
    href && "outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/40",
  );
  return href ? (
    <Link href={href} className={className}>
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  );
}

function StatValue({ value, tone }: { value: number; tone?: "critical" }) {
  return (
    <span
      className={cn(
        "font-mono text-xl font-semibold leading-none tracking-tight tabular-nums",
        tone === "critical" && "text-critical",
      )}
    >
      {value}
    </span>
  );
}

