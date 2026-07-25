"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { format, formatDistanceToNow, isToday, isYesterday } from "date-fns";
import { Activity, ArrowRight, ChevronRight, ExternalLink } from "lucide-react";
import type { CompetitorSignal, ChangeRow } from "@/lib/api";
import { cn } from "@/lib/utils";
import { feedItemMotion } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card } from "@/components/ui/card";
import { SeverityScale } from "@/components/outrival/severity-scale";
import { CatBadge } from "@/components/outrival/data-marks";
import { SignalSourceLine } from "@/components/outrival/signal-source-line";
import { sourceShortLabel } from "@/lib/source-labels";
import type { SourceType } from "@outrival/shared";
import { ChangeCard } from "./changes";

type Severity = "low" | "medium" | "high" | "critical";
const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** A high or critical signal shows its implication without being opened: the more
 *  material the movement, the more of it you see before clicking. */
const SHOW_SO_WHAT_FROM: Severity = "high";

/** Day bucket key + the heading it renders under. */
function dayOf(iso: string): { key: string; label: string; date: Date } {
  const d = new Date(iso);
  const key = format(d, "yyyy-MM-dd");
  const label = isToday(d)
    ? "Today"
    : isYesterday(d)
      ? "Yesterday"
      : Date.now() - d.getTime() < 7 * 86_400_000
        ? format(d, "EEEE")
        : format(d, "d MMM yyyy");
  return { key, label, date: d };
}

/**
 * Activity is the chronology: what happened, newest first, triaged by materiality.
 *
 * It used to render signals and unclassified changes as one flat divided list,
 * repeating severity, category, timestamp and a "View page" link on every row,
 * with no day headings and no way to filter by the two fields the data already
 * carries. Grouping by day gives the feed a rhythm, the severity scale gives it a
 * left-hand scan, and the unclassified changes fold into one line per day so noise
 * stops competing with signal for the same visual weight.
 */
export function ActivityTab({
  competitorId,
  signals,
  changes,
  onRefresh,
  competitorUrl,
  lastRunMs,
  lastVisit,
}: {
  competitorId: string;
  signals: CompetitorSignal[];
  changes: ChangeRow[];
  onRefresh?: () => void;
  competitorUrl: string;
  /** Newest run across this competitor's sources (0 = never scraped). */
  lastRunMs: number;
  /** Previous visit (epoch ms), owned by the page so the band and this list agree. */
  lastVisit: number | null;
}) {
  const [severity, setSeverity] = useState<Severity | null>(null);
  const [category, setCategory] = useState<string | null>(null);

  const activityHref = `/dashboard/activity?competitorId=${competitorId}`;
  const isNew = (createdAt: string) =>
    lastVisit !== null && new Date(createdAt).getTime() > lastVisit;

  const severityCounts = useMemo(() => {
    const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const s of signals) counts[s.severity] += 1;
    return counts;
  }, [signals]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of signals) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [signals]);

  const visible = useMemo(
    () =>
      signals.filter(
        (s) =>
          (severity === null || s.severity === severity) &&
          (category === null || s.category === category),
      ),
    [signals, severity, category],
  );

  // Signals and their unclassified siblings share one chronology, bucketed by day.
  const signalChangeIds = new Set(signals.map((s) => s.changeId).filter(Boolean));
  const orphanChanges = changes.filter((c) => !signalChangeIds.has(c.id));
  const days = useMemo(() => {
    const map = new Map<
      string,
      { label: string; date: Date; signals: CompetitorSignal[]; changes: ChangeRow[] }
    >();
    const bucket = (iso: string) => {
      const { key, label, date } = dayOf(iso);
      let entry = map.get(key);
      if (!entry) {
        entry = { label, date, signals: [], changes: [] };
        map.set(key, entry);
      }
      return entry;
    };
    for (const s of visible) bucket(s.createdAt).signals.push(s);
    // Unclassified changes ride along only when no filter is active: they carry
    // neither severity nor category, so a filtered view must not imply they matched.
    if (severity === null && category === null) {
      for (const c of orphanChanges) bucket(c.detectedAt).changes.push(c);
    }
    return [...map.values()].sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [visible, orphanChanges, severity, category]);

  if (signals.length === 0 && changes.length === 0) {
    // No signal or change is not the same as nothing happening: the sources may
    // have been checked many times with no change. Saying "no activity" reads as
    // broken, so once we have actually scraped we acknowledge the monitoring.
    const hasScraped = lastRunMs > 0;
    return (
      <EmptyState
        icon={Activity}
        title={hasScraped ? "No changes yet" : "No activity yet"}
        description={
          hasScraped
            ? "Monitoring is active. We've been checking this competitor's sources and nothing has changed yet."
            : "Scrape from the Sources rail to start tracking."
        }
        actions={
          hasScraped && (
            <Link
              href={activityHref}
              className="inline-flex items-center gap-1.5 text-sm text-link hover:underline"
            >
              <Activity size={14} aria-hidden />
              View monitoring activity
            </Link>
          )
        }
      />
    );
  }

  const filtered = severity !== null || category !== null;

  return (
    <Card className="overflow-hidden rounded-lg">
      {/* Severity and category were on every row and filterable by neither. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <div className="inline-flex overflow-hidden rounded-md border border-border">
          <FilterButton pressed={severity === null} onClick={() => setSeverity(null)}>
            All <Count n={signals.length} />
          </FilterButton>
          {SEVERITIES.filter((s) => severityCounts[s] > 0).map((s) => (
            <FilterButton
              key={s}
              pressed={severity === s}
              onClick={() => setSeverity(severity === s ? null : s)}
              className="border-l border-border"
            >
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  s === "critical"
                    ? "bg-critical"
                    : s === "high"
                      ? "bg-high"
                      : s === "medium"
                        ? "bg-medium"
                        : "bg-low",
                )}
              />
              <span className="capitalize">{s}</span>
              <Count n={severityCounts[s]} />
            </FilterButton>
          ))}
        </div>

        {categoryCounts.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {categoryCounts.map(([cat, n]) => (
              <button
                key={cat}
                type="button"
                aria-pressed={category === cat}
                onClick={() => setCategory(category === cat ? null : cat)}
                className={cn(
                  // The full pill is reserved for interactive filters, so shape
                  // alone separates a control from the static CatBadge on a row.
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  category === cat
                    ? "border-border-strong bg-surface-3 font-medium text-foreground"
                    : "border-border text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                )}
              >
                <span className="capitalize">{cat.replace(/_/g, " ")}</span>
                <Count n={n} />
              </button>
            ))}
          </div>
        )}

        {filtered && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 text-xs text-muted-foreground"
            onClick={() => {
              setSeverity(null);
              setCategory(null);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* The list used to be re-keyed on the active filters, so picking one threw the
          whole feed away and faded a new one in. It carries the competitors-list
          choreography now: the rows a filter drops leave, the rows it keeps travel. */}
      {days.length === 0 ? (
        <p className="border-t border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing matches those filters.
        </p>
      ) : (
        <AnimatePresence initial={false} mode="popLayout">
          {days.map((day) => (
            <motion.div
              key={day.label + day.date.getTime()}
              {...feedItemMotion}
              layout="position"
            >
              <div className="flex items-baseline gap-2.5 border-t border-border px-5 pb-2 pt-3">
                <span className="text-dense font-semibold">{day.label}</span>
                <span className="text-xs text-muted-foreground">
                  {day.signals.length > 0 &&
                    `${day.signals.length} ${day.signals.length === 1 ? "signal" : "signals"}`}
                  {day.signals.length > 0 && day.changes.length > 0 && ", "}
                  {day.changes.length > 0 &&
                    `${day.changes.length} other ${day.changes.length === 1 ? "change" : "changes"}`}
                </span>
                <span className="ml-auto font-mono text-meta tabular-nums text-muted-foreground">
                  {format(day.date, "d MMM")}
                </span>
              </div>

              <AnimatePresence initial={false} mode="popLayout">
                {day.signals.map((s) => (
                  <motion.div key={s.id} {...feedItemMotion} layout="position">
                    <SignalRow
                      signal={s}
                      unread={isNew(s.createdAt)}
                      competitorUrl={competitorUrl}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>

              {day.changes.length > 0 && (
                <OtherChanges
                  changes={day.changes}
                  onRefresh={onRefresh}
                  competitorUrl={competitorUrl}
                />
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      )}

      {/* This tab shows signals and classified changes. The full run history,
          including every no-change and baseline check, lives on the Activity page. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
        <span className="text-dense text-muted-foreground">
          {signals.length} {signals.length === 1 ? "signal" : "signals"} captured for this
          competitor.
        </span>
        <Link
          href={activityHref}
          className="inline-flex items-center gap-1.5 text-dense text-link hover:underline"
        >
          Every check we ran, including no-change runs
          <ArrowRight size={13} aria-hidden />
        </Link>
      </div>
    </Card>
  );
}

function Count({ n }: { n: number }) {
  return <span className="font-mono text-meta tabular-nums text-muted-foreground">{n}</span>;
}

function FilterButton({
  pressed,
  onClick,
  className,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        pressed
          ? "bg-surface-2 font-semibold text-foreground"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * One signal. Severity leads (the scale, not a pill: it is ordinal and the four
 * ticks say "out of what"), then the headline, then the implication. Category and
 * time hold the right column. Unread is a dot beside the timestamp rather than an
 * accent bar down the edge, which is the most recognisable generated-UI signature
 * and used to stack with a second one on the detail.
 */
function SignalRow({
  signal: s,
  unread,
  competitorUrl,
}: {
  signal: CompetitorSignal;
  unread: boolean;
  competitorUrl: string;
}) {
  const pageUrl = s.monitorUrl ?? competitorUrl;
  const leadsWithSoWhat = RANK[s.severity] >= RANK[SHOW_SO_WHAT_FROM] && !!s.soWhat;
  const sourceLabel = s.sourceType ? sourceShortLabel(s.sourceType as SourceType) : null;

  return (
    <details className="details-smooth group border-t border-border">
      <summary
        className={cn(
          "grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 px-5 py-3",
          "transition-colors hover:bg-surface-2",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        <span className="col-start-1 flex min-w-0 flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
            <SeverityScale severity={s.severity} size="compact" />
            {sourceLabel && <span>{sourceLabel}</span>}
          </span>
          <span className="text-content leading-snug">{s.insight}</span>
          {leadsWithSoWhat && (
            <span className="text-dense leading-snug text-muted-foreground">{s.soWhat}</span>
          )}
        </span>
        <span className="col-start-2 row-start-1 flex items-center gap-2.5">
          <CatBadge category={s.category} />
          <span className="inline-flex items-center gap-1.5 font-mono text-meta tabular-nums text-muted-foreground">
            {unread && (
              <span
                aria-label="Unread"
                className="size-1.5 shrink-0 rounded-full bg-primary"
              />
            )}
            {formatDistanceToNow(new Date(s.createdAt))}
          </span>
        </span>
      </summary>

      {/* Labelled rows, the same language as the fact strips: a label in the margin
          does the job the accent rail did, and additionally says what the block is. */}
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 px-5 pb-4 pt-0.5 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
        {!leadsWithSoWhat && s.soWhat && (
          <>
            <dt className="text-xs text-muted-foreground">So what</dt>
            <dd className="m-0 text-sm leading-relaxed text-muted-foreground">{s.soWhat}</dd>
          </>
        )}
        {s.recommendedAction && (
          <>
            <dt className="text-xs text-muted-foreground">Recommended</dt>
            <dd className="m-0 text-sm leading-relaxed">{s.recommendedAction}</dd>
          </>
        )}
        <dt className="text-xs text-muted-foreground">Evidence</dt>
        <dd className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <SignalSourceLine
            signalId={s.id}
            sourceType={s.sourceType}
            detectedAt={s.createdAt}
          />
          <a
            href={pageUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-xs text-link hover:underline"
          >
            View page <ExternalLink size={11} />
          </a>
        </dd>
      </dl>
    </details>
  );
}

/**
 * Changes that never became signals. They used to stack below the feed under a
 * long heading, at the same visual weight as a signal, so noise read like signal.
 * Folded to one line per day they keep their place in the chronology and leave
 * the scan alone.
 */
function OtherChanges({
  changes,
  onRefresh,
  competitorUrl,
}: {
  changes: ChangeRow[];
  onRefresh?: () => void;
  competitorUrl: string;
}) {
  const sources = [...new Set(changes.map((c) => sourceShortLabel(c.sourceType as SourceType)))];
  return (
    <details className="details-smooth group border-t border-border">
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-2 px-5 py-2.5 text-dense text-muted-foreground",
          "transition-colors hover:bg-surface-2 hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        <ChevronRight
          size={13}
          aria-hidden
          className="shrink-0 transition-transform group-open:rotate-90"
        />
        {changes.length} other {changes.length === 1 ? "change" : "changes"} with no signal
        <span className="truncate text-xs text-muted-foreground">
          {sources.join(", ").toLowerCase()}
        </span>
      </summary>
      <ul className="flex flex-col divide-y divide-border px-5 pb-3">
        {changes.map((c) => (
          <li key={c.id} className="py-3 first:pt-1 last:pb-0">
            <ChangeCard change={c} onRefresh={onRefresh} fallbackUrl={competitorUrl} />
          </li>
        ))}
      </ul>
    </details>
  );
}
