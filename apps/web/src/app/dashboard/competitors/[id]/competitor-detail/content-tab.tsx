"use client";

import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ArrowUpIcon, ArrowDownIcon, ArrowSquareOutIcon } from "@/components/icons";
import { Fact, FactStrip } from "@/components/outrival/data-marks";
import { api, type ContentItemRow, type ContentSummary, type CompetitorSignal } from "@/lib/api";
import { cn } from "@/lib/utils";
import { TabCard, TabSection } from "@/components/outrival/tab-shell";
import { Button } from "@/components/ui/button";
import {
  Empty,
  TabLoading,
  scrapeActivity,
  type MonitorSourceProps,
  type ScrapeActivity,
} from "./shared";

/**
 * What a competitor publishes (Content Intelligence v2 P4).
 *
 * Blog, changelog, roadmap and docs used to reach this page as a paragraph each:
 * a diff, classified, then forgotten. `content_items` turned them into rows, and
 * this tab is those rows read back — a timeline of what they published, how often
 * they publish it, and which subjects they have moved onto.
 *
 * Two rules run through the whole surface, and both are visible in it:
 *
 *  - AN ITEM WE HAVE NOT READ IS STILL SHOWN. Title, date, source, and a plain "not
 *    read yet" instead of a type badge. Hiding it would make the timeline claim the
 *    competitor published less than they did, which is the one thing a competitive
 *    feed must never do.
 *  - COUNTING NEEDS THE FEED, NOT THE POST. Cadence is real from the first capture,
 *    because it counts entries; themes need each post opened. So a competitor we
 *    have only just started reading gets a working chart and an honest blank where
 *    the themes go, rather than an empty tab.
 *
 * Zero AI on this path: every number here is counted from rows P1/P2 wrote.
 */

/** The four sources this tab reads, in stacking order, with their series colour. */
const SOURCES = [
  { key: "changelog", label: "Changelog", color: "var(--chart-1)" },
  { key: "blog", label: "Blog", color: "var(--chart-2)" },
  { key: "roadmap", label: "Roadmap", color: "var(--chart-3)" },
  { key: "docs", label: "Docs", color: "var(--chart-4)" },
] as const;

const SOURCE_COLOR: Record<string, string> = Object.fromEntries(
  SOURCES.map((s) => [s.key, s.color]),
);

const TYPE_LABEL: Record<string, string> = {
  feature: "Feature",
  improvement: "Improvement",
  fix: "Fix",
  breaking: "Breaking",
  deprecation: "Deprecation",
  security: "Security",
  feature_announcement: "Feature announcement",
  case_study: "Case study",
  thought_leadership: "Thought leadership",
  tutorial: "Tutorial",
  seo: "SEO",
  company_news: "Company news",
  roadmap_entry: "Roadmap entry",
  doc_page: "New page",
};

/**
 * Colour is spent on the three types that alert, and nowhere else.
 *
 * `breaking`, `deprecation` and `security` are the ones the pipeline emits a signal
 * on, so the timeline scans for exactly what the product acts on. Tinting all
 * fourteen types would turn a dense list into a sticker sheet and leave nothing to
 * scan by — the same reason severity is rationed everywhere else in the product.
 */
const LOUD_TYPE: Record<string, string> = {
  breaking: "bg-critical/14 text-critical",
  deprecation: "bg-high/14 text-high",
  security: "bg-high/14 text-high",
};

const PERIODS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "12 months" },
  { days: 0, label: "All" },
] as const;

/** Rows per page. The timeline pages rather than shipping a publication history. */
const PAGE = 20;

/** How recent an editorial_pivot signal must be to still head the tab. */
const PIVOT_SHOWN_DAYS = 90;

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const DAY_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
  timeZone: "UTC",
});
const MONTH_SHORT = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

/** `published_at ?? first_seen_at` — the date an item is placed on, as the API does. */
function itemDate(item: ContentItemRow): Date {
  return new Date(item.publishedAt ?? item.firstSeenAt);
}

export function ContentTab({
  competitorId,
  signals,
  monitors,
  scrapingIds,
  onRun,
  onEnable,
}: {
  competitorId: string;
  /** Already on the page; carries the editorial_shift signal the callout renders. */
  signals: CompetitorSignal[];
} & MonitorSourceProps) {
  const [source, setSource] = useState<string>("all");
  const [type, setType] = useState<string>("all");
  const [period, setPeriod] = useState<number>(90);
  const [pages, setPages] = useState(1);

  const summaryQuery = useQuery({
    queryKey: ["competitor", competitorId, "contentSummary"],
    queryFn: () => api.getCompetitorContentSummary(competitorId),
    placeholderData: keepPreviousData,
  });
  const timelineQuery = useQuery({
    queryKey: ["competitor", competitorId, "content", source, type, period, pages],
    queryFn: () =>
      api.getCompetitorContent(competitorId, {
        source,
        type,
        period,
        limit: PAGE * pages,
        offset: 0,
      }),
    placeholderData: keepPreviousData,
  });

  const summary = summaryQuery.data ?? null;
  const timeline = timelineQuery.data ?? null;

  const reset = (apply: () => void) => {
    apply();
    setPages(1);
  };

  if (summaryQuery.isError || timelineQuery.isError)
    return <Empty text="Couldn't load this data right now. Try again in a moment." />;
  if (!summary || !timeline) return <TabLoading />;

  const everPublished = summary.cadence.reduce((n, m) => n + m.total, 0);
  if (everPublished === 0) {
    return (
      <NothingPublished monitors={monitors} scrapingIds={scrapingIds} onRun={onRun} onEnable={onEnable} />
    );
  }

  const { totals, windowDays } = summary;
  const leadingTheme = summary.themes.find((t) => t.now > 0)?.topic ?? null;
  const perMonthDelta =
    totals.previousPerMonth > 0
      ? Math.round((totals.perMonth / totals.previousPerMonth - 1) * 100)
      : null;

  const pivot = signals.find(
    (s) =>
      s.sourceType === "editorial_shift" &&
      Date.now() - new Date(s.createdAt).getTime() < PIVOT_SHOWN_DAYS * 86_400_000,
  );

  // Nothing opened yet: cadence still works (it counts entries), themes cannot.
  const unreadOnly = totals.postsRead === 0 && totals.unread > 0;

  const verdict = (() => {
    const n = totals.published;
    if (n === 0) return `Nothing published in the last ${windowDays} days.`;
    const rate = totals.perMonth.toFixed(totals.perMonth >= 10 ? 0 : 1);
    const move =
      totals.previousPublished === 0
        ? ""
        : totals.perMonth > totals.previousPerMonth
          ? `, up from ${totals.previousPerMonth.toFixed(totals.previousPerMonth >= 10 ? 0 : 1)}`
          : totals.perMonth < totals.previousPerMonth
            ? `, down from ${totals.previousPerMonth.toFixed(totals.previousPerMonth >= 10 ? 0 : 1)}`
            : "";
    return `They published ${n} ${n === 1 ? "item" : "items"} in the last ${windowDays} days, ${rate} a month${move}.`;
  })();

  const contentMonitors = monitors.filter((m) => SOURCES.some((s) => s.key === m.sourceType));

  return (
    <TabCard>
      <TabSection>
        <h3 className="text-xl font-semibold leading-snug tracking-tight text-balance">
          {verdict}
        </h3>
      </TabSection>

      <TabSection>
        <FactStrip>
          <Fact label={`Published · ${windowDays} days`}>
            <span className="tabular-nums">{totals.published}</span>
          </Fact>
          <Fact label="Per month" tone={perMonthDelta !== null && perMonthDelta > 0 ? "warn" : undefined}>
            <span className="tabular-nums">
              {totals.perMonth.toFixed(totals.perMonth >= 10 ? 0 : 1)}
            </span>
            {perMonthDelta !== null && perMonthDelta !== 0 && (
              <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                {perMonthDelta > 0 ? "+" : ""}
                {perMonthDelta}%
              </span>
            )}
          </Fact>
          <Fact label="Leading theme" muted={!leadingTheme}>
            {leadingTheme ?? "Not read yet"}
          </Fact>
          <Fact label="Posts naming you" muted={totals.namesYou === 0}>
            {totals.namesYou > 0 ? (
              <span className="tabular-nums">{totals.namesYou}</span>
            ) : (
              "None"
            )}
          </Fact>
        </FactStrip>
      </TabSection>

      {pivot && <PivotCallout signal={pivot} />}

      {unreadOnly && (
        <div className="flex items-start gap-3 bg-surface-2/55 px-5 py-3.5">
          <span aria-hidden className="w-[3px] self-stretch rounded-full bg-border-strong" />
          <p className="max-w-[74ch] text-dense text-muted-foreground">
            <span className="font-semibold text-foreground">Titles and dates only, so far.</span>{" "}
            Counting what they publish needs nothing but the feed, so the cadence below is already
            real. Themes, types and summaries come from opening each item, which happens on the
            next few captures — <span className="tabular-nums">{totals.unread}</span> are queued.
          </p>
        </div>
      )}

      <CadenceChart cadence={summary.cadence} />

      <Themes themes={summary.themes} postsRead={totals.postsRead} windowDays={windowDays} />

      <div className="flex flex-wrap items-center gap-2 bg-surface-2/45 px-5 py-3">
        <div className="inline-flex flex-wrap gap-1" role="group" aria-label="Source">
          <FilterPill active={source === "all"} onClick={() => reset(() => setSource("all"))}>
            All <span className="tabular-nums opacity-70">{sumCounts(timeline.sourceCounts)}</span>
          </FilterPill>
          {SOURCES.filter((s) => (timeline.sourceCounts[s.key] ?? 0) > 0).map((s) => (
            <FilterPill
              key={s.key}
              active={source === s.key}
              onClick={() => reset(() => setSource(s.key))}
            >
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: s.color }}
              />
              {s.label}{" "}
              <span className="tabular-nums opacity-70">{timeline.sourceCounts[s.key]}</span>
            </FilterPill>
          ))}
        </div>

        <label className="sr-only" htmlFor="content-type">
          Type
        </label>
        <select
          id="content-type"
          value={type}
          onChange={(e) => reset(() => setType(e.target.value))}
          className="h-[30px] rounded-md border border-border bg-surface px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <option value="all">All types</option>
          {summary.typeMix.map((t) => (
            <option key={t.itemType ?? "unread"} value={t.itemType ?? "unread"}>
              {t.itemType ? (TYPE_LABEL[t.itemType] ?? t.itemType) : "Not read yet"} ({t.count})
            </option>
          ))}
        </select>

        <div className="inline-flex flex-wrap gap-1" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <FilterPill
              key={p.days}
              active={period === p.days}
              onClick={() => reset(() => setPeriod(p.days))}
            >
              {p.label}
            </FilterPill>
          ))}
        </div>

        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {timeline.total} {timeline.total === 1 ? "item" : "items"} ·{" "}
          {period === 0
            ? "all time"
            : `last ${PERIODS.find((p) => p.days === period)?.label.toLowerCase()}`}
        </span>
      </div>

      <Timeline items={timeline.items} />

      {timeline.hasMore && (
        <div className="flex justify-center px-5 py-3.5">
          <Button variant="outline" size="sm" onClick={() => setPages((n) => n + 1)}>
            Show {Math.min(PAGE, timeline.total - timeline.items.length)} more ·{" "}
            <span className="tabular-nums">{timeline.total - timeline.items.length}</span> left
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-xs text-muted-foreground">
        {contentMonitors.length > 0 && (
          <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5">
            Read from
            {contentMonitors.map((m, i) => (
              <span key={m.id} className="inline-flex min-w-0 items-center">
                {i > 0 && <span className="mr-1.5">,</span>}
                {m.pageUrl ? (
                  <a
                    href={m.pageUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="truncate font-mono text-meta text-link hover:underline"
                  >
                    {m.pageUrl.replace(/^https?:\/\//, "")}
                  </a>
                ) : (
                  <span>{m.sourceType}</span>
                )}
              </span>
            ))}
          </span>
        )}
        {contentMonitors[0]?.lastRunAt && (
          <span>
            last check{" "}
            {formatDistanceToNow(new Date(contentMonitors[0].lastRunAt), { addSuffix: true })}
          </span>
        )}
        {contentMonitors[0] && (
          <RescanLink
            activity={scrapeActivity(
              contentMonitors[0],
              scrapingIds.has(contentMonitors[0].id),
            )}
            onRun={() => onRun(contentMonitors[0]!.id)}
          />
        )}
      </div>
    </TabCard>
  );
}

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((n, v) => n + v, 0);
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-[30px] items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        active
          ? "border-border-strong bg-surface-3 text-foreground"
          : "border-border bg-surface text-muted-foreground hover:bg-surface-3 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The editorial_pivot signal, when there is a recent one.
 *
 * A medium-severity tick and a tinted band rather than an alert box: the move is
 * real but it is a quarter-scale reading, and the callout has to sit above a dense
 * timeline without shouting over it.
 */
function PivotCallout({ signal }: { signal: CompetitorSignal }) {
  // The emitter writes "Editorial shift — rising: a, b · declining: c, d" as the
  // insight's opening, so the two lists are parsed back out rather than restated.
  const match = /rising:\s*(.+?)\s*·\s*declining:\s*(.+?)(?:\.|$)/i.exec(signal.insight);
  const rising = match?.[1] ?? null;
  const declining = match?.[2] ?? null;

  return (
    <section className="flex gap-3.5 bg-medium/[0.07] px-5 py-4" aria-labelledby="pivot-heading">
      <span aria-hidden className="w-[3px] shrink-0 rounded-full bg-medium" />
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 id="pivot-heading" className="text-content font-semibold tracking-tight">
            Editorial shift
          </h3>
          <span className="text-xs text-muted-foreground">
            signalled {formatDistanceToNow(new Date(signal.createdAt), { addSuffix: true })} ·{" "}
            {signal.severity}
          </span>
        </div>
        {rising && declining ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm">
              <span className="inline-flex w-[74px] items-center gap-1.5 text-muted-foreground">
                <ArrowUpIcon size={14} className="text-high" aria-hidden />
                Rising
              </span>
              {rising}
            </p>
            <p className="text-sm">
              <span className="inline-flex w-[74px] items-center gap-1.5 text-muted-foreground">
                <ArrowDownIcon size={14} className="text-positive" aria-hidden />
                Declining
              </span>
              {declining}
            </p>
          </div>
        ) : (
          <p className="text-sm">{signal.insight}</p>
        )}
        <p className="text-xs text-muted-foreground">
          <a href={`/dashboard/signals?signal=${signal.id}`} className="text-link hover:underline">
            Open the signal
          </a>
        </p>
      </div>
    </section>
  );
}

/**
 * Items per month, stacked by source.
 *
 * The month still running is drawn OPEN, not dropped: the cadence detector never
 * evaluates a partial month (comparing three days against three full months reports
 * a freeze at every competitor on the 3rd), and a chart that silently omitted it
 * would leave the reader wondering where this month went.
 *
 * CSS bars rather than a charting library: twelve stacked columns and one hatched
 * one is what this needs, and the repo's lazy-loaded chart draws lines.
 */
function CadenceChart({ cadence }: { cadence: ContentSummary["cadence"] }) {
  const peak = Math.max(...cadence.map((m) => m.total), 1);
  const step = peak <= 12 ? 4 : peak <= 40 ? 8 : 20;
  const top = Math.ceil(peak / step) * step;
  const gridlines = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  const present = SOURCES.filter((s) => cadence.some((m) => (m.bySource[s.key] ?? 0) > 0));

  return (
    <TabSection
      title="Cadence"
      action={<span className="shrink-0 text-xs text-muted-foreground">items per month, by source</span>}
    >
      <div className="flex flex-wrap gap-3">
        {present.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden className="size-2 rounded-[2px]" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2">
        <div className="relative h-[180px] text-meta tabular-nums text-muted-foreground">
          {gridlines.map((v) => (
            <span
              key={v}
              className="absolute right-0 -translate-y-1/2"
              style={{ top: `${100 - (v / top) * 100}%` }}
            >
              {v}
            </span>
          ))}
        </div>
        <div>
          <div className="relative h-[180px]">
            <div className="absolute inset-0">
              {gridlines.map((v) => (
                <i
                  key={v}
                  aria-hidden
                  className="absolute inset-x-0 block h-px bg-border"
                  style={{ top: `${100 - (v / top) * 100}%` }}
                />
              ))}
            </div>
            <div className="absolute inset-0 flex items-end gap-1.5">
              {cadence.map((m) => (
                <div
                  key={m.month}
                  title={`${m.month} — ${m.total} ${m.total === 1 ? "item" : "items"}${m.partial ? " (month still running)" : ""}`}
                  className={cn(
                    "flex h-full min-w-0 flex-1 flex-col justify-end overflow-hidden rounded-t-[3px]",
                    m.partial && "opacity-75",
                  )}
                  style={{ height: `${(m.total / top) * 100}%` }}
                >
                  {[...SOURCES].reverse().map((s) => {
                    const n = m.bySource[s.key] ?? 0;
                    if (n === 0 || m.total === 0) return null;
                    return (
                      <div
                        key={s.key}
                        className={cn("w-full", m.partial && "cadence-open")}
                        style={{ background: s.color, height: `${(n / m.total) * 100}%` }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-1.5 flex gap-1.5">
            {cadence.map((m) => (
              <span
                key={m.month}
                className={cn(
                  "min-w-0 flex-1 overflow-hidden text-center text-meta tabular-nums",
                  m.partial ? "text-muted-foreground/70" : "text-muted-foreground",
                )}
              >
                {MONTH_SHORT.format(new Date(`${m.month}-01T00:00:00Z`))}
              </span>
            ))}
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        This month is still running, so it is drawn open and counts toward nothing — the cadence
        read only ever compares months that have ended.
      </p>
      {/* Hatch for the open column. Inline because it is the one place in the
          product that needs it, and it has to sit on top of the series colour. */}
      <style>{`.cadence-open{background-image:repeating-linear-gradient(45deg,transparent 0 3px,var(--surface) 3px 6px)}`}</style>
    </TabSection>
  );
}

/**
 * What they are writing about, this quarter against the one before.
 *
 * One row per subject, carrying BOTH windows: the bar is now, the tick is where it
 * stood 90 days ago. A second bar would say the same thing twice, and an arrow
 * alone would say the direction without the distance.
 */
function Themes({
  themes,
  postsRead,
  windowDays,
}: {
  themes: ContentSummary["themes"];
  postsRead: number;
  windowDays: number;
}) {
  if (themes.length === 0) {
    return (
      <TabSection title="Themes">
        <p className="text-sm text-muted-foreground">
          Nothing to show yet. A theme is a word taken out of a post we have read, and we have not
          read one of theirs yet.
        </p>
      </TabSection>
    );
  }

  const max = Math.max(...themes.map((t) => Math.max(t.now, t.then)), 1);

  return (
    <TabSection
      title="Themes"
      action={
        <span className="shrink-0 text-xs text-muted-foreground">
          last {windowDays} days vs the {windowDays} before
        </span>
      }
    >
      <ul className="flex flex-col gap-2.5">
        {themes.map((t) => {
          const delta = t.now - t.then;
          return (
            <li
              key={t.topic}
              className="grid grid-cols-[minmax(6rem,1fr)_minmax(0,2.2fr)_auto] items-center gap-3"
            >
              <span className="min-w-0 truncate text-sm">{t.topic}</span>
              <span className="relative flex h-3.5 items-center" title={`was ${t.then}`}>
                <span aria-hidden className="absolute inset-x-0 h-1.5 rounded-full bg-surface-2" />
                <span
                  aria-hidden
                  className="absolute left-0 h-1.5 rounded-full bg-link"
                  style={{ width: `${t.now > 0 ? Math.max((t.now / max) * 100, 3) : 0}%` }}
                />
                <span
                  aria-hidden
                  className="absolute top-px h-3 w-0.5 rounded-[1px] bg-muted-foreground/65"
                  style={{ left: `calc(${(t.then / max) * 100}% - 1px)` }}
                />
              </span>
              <span className="inline-flex items-center gap-1.5 justify-self-end text-dense tabular-nums text-muted-foreground">
                {delta > 0 ? (
                  <ArrowUpIcon size={14} className="text-high" aria-hidden />
                ) : delta < 0 ? (
                  <ArrowDownIcon size={14} className="text-positive" aria-hidden />
                ) : null}
                <span className="font-semibold text-foreground">{t.now}</span>
                was {t.then}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        Topics come from the <span className="tabular-nums">{postsRead}</span>{" "}
        {postsRead === 1 ? "post" : "posts"} we were able to read this window. The tick marks where
        each subject sat in the previous {windowDays} days.
      </p>
    </TabSection>
  );
}

/** The items themselves, grouped by the month they were published in. */
function Timeline({ items }: { items: ContentItemRow[] }) {
  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; items: ContentItemRow[] }> = [];
    for (const item of items) {
      const at = itemDate(item);
      const key = `${at.getUTCFullYear()}-${at.getUTCMonth()}`;
      const last = out[out.length - 1];
      if (last?.key === key) last.items.push(item);
      else out.push({ key, label: MONTH_LABEL.format(at), items: [item] });
    }
    return out;
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
        <p className="text-content font-semibold">Nothing matches those filters</p>
        <p className="text-sm text-muted-foreground">Widen the period, or clear the type.</p>
      </div>
    );
  }

  return (
    <div>
      {groups.map((group) => (
        <div key={group.key}>
          <div className="flex items-baseline gap-2 border-t border-border bg-surface-2/55 px-5 py-2.5 first:border-t-0">
            <h4 className="text-xs font-semibold tracking-tight">{group.label}</h4>
            <span className="text-xs tabular-nums text-muted-foreground">
              {group.items.length} {group.items.length === 1 ? "item" : "items"}
            </span>
          </div>
          {group.items.map((item) => (
            <TimelineRow key={item.id} item={item} />
          ))}
        </div>
      ))}
    </div>
  );
}

function TimelineRow({ item }: { item: ContentItemRow }) {
  const at = itemDate(item);
  const typeLabel = item.itemType ? (TYPE_LABEL[item.itemType] ?? item.itemType) : null;
  const loud = item.itemType ? LOUD_TYPE[item.itemType] : undefined;

  return (
    <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3.5 gap-y-1 border-t border-border px-5 py-3 transition-colors hover:bg-surface-3/55 sm:grid-cols-[3.25rem_minmax(0,1fr)]">
      <span className="row-span-3 flex items-baseline gap-1.5 pt-px text-xs tabular-nums text-muted-foreground">
        <span
          aria-hidden
          title={item.sourceType}
          className="size-1.5 shrink-0 -translate-y-0.5 rounded-full"
          style={{ background: SOURCE_COLOR[item.sourceType] ?? "var(--muted-foreground)" }}
        />
        {DAY_LABEL.format(at)}
      </span>

      <span className="flex min-w-0 flex-wrap items-baseline gap-2">
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-baseline gap-1 rounded-sm text-sm font-medium text-foreground underline-offset-2 outline-none hover:text-link hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {item.title}
            <ArrowSquareOutIcon size={14} className="shrink-0 self-center text-muted-foreground" aria-hidden />
          </a>
        ) : (
          <span className="text-sm font-medium">{item.title}</span>
        )}

        <span className="text-meta text-muted-foreground">{item.sourceType}</span>

        {/* Roadmap entries carry a status, not a type: "planned → shipped" IS the
            reason to watch a portal, so it takes the badge slot. */}
        {item.sourceType === "roadmap" && item.status ? (
          <Badge tone={/ship|deliver|complete|done|launch/i.test(item.status) ? "bg-positive/14 text-positive" : undefined}>
            {item.status}
          </Badge>
        ) : item.enriched && typeLabel ? (
          <Badge tone={loud}>{typeLabel}</Badge>
        ) : (
          <em className="text-meta not-italic text-muted-foreground">not read yet</em>
        )}
      </span>

      {item.summary && (
        <span className="max-w-[68ch] text-dense text-muted-foreground">{item.summary}</span>
      )}

      {item.topics.length > 0 && (
        <span className="flex flex-wrap gap-1.5">
          {item.topics.map((topic) => (
            <span
              key={topic}
              className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-meta text-muted-foreground"
            >
              {topic}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

function Badge({ tone, children }: { tone?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-sm px-1.5 py-0.5 text-meta font-medium capitalize",
        tone ?? "bg-surface-2 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/**
 * Nothing to read at all: not one of the four sources has produced an item.
 *
 * Each source is named with its own state rather than one blanket line, because
 * "we watch it and it has published nothing" and "they have no changelog" and "this
 * is switched off" are three different facts, and only the third is actionable.
 */
function NothingPublished({ monitors, scrapingIds, onRun, onEnable }: MonitorSourceProps) {
  const [enabling, setEnabling] = useState<string | null>(null);

  return (
    <TabCard>
      <div className="flex flex-col items-center gap-2.5 px-5 py-10 text-center">
        <h3 className="text-content font-semibold tracking-tight">
          Nothing published that we can read yet
        </h3>
        <p className="max-w-[52ch] text-sm text-muted-foreground">
          This tab reads what they publish: their blog, their changelog, their public roadmap and
          their developer docs. None of them has produced an entry so far.
        </p>

        <ul className="mt-1.5 flex w-full max-w-[34rem] flex-col">
          {SOURCES.map((s) => {
            const monitor = monitors.find((m) => m.sourceType === s.key);
            const activity = monitor ? scrapeActivity(monitor, scrapingIds.has(monitor.id)) : null;
            return (
              <li
                key={s.key}
                className="flex items-center gap-2.5 border-t border-border py-2.5 text-dense first:border-t-0"
              >
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: s.color }}
                />
                <span className="font-medium">{s.label}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {!monitor ? (
                    onEnable ? (
                      <button
                        type="button"
                        disabled={enabling === s.key}
                        onClick={async () => {
                          setEnabling(s.key);
                          try {
                            await onEnable(s.key as never);
                          } finally {
                            setEnabling(null);
                          }
                        }}
                        className="rounded-sm text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
                      >
                        {enabling === s.key ? "Turning on…" : `Turn on ${s.label.toLowerCase()} monitoring`}
                      </button>
                    ) : (
                      "not monitored"
                    )
                  ) : monitor.markedUnscrapable ? (
                    "no such surface found on their site"
                  ) : activity === "scraping" ? (
                    "reading it now"
                  ) : activity === "queued" ? (
                    "queued"
                  ) : monitor.lastRunAt ? (
                    "watched · no entries yet"
                  ) : (
                    "watched · not read yet"
                  )}
                </span>
              </li>
            );
          })}
        </ul>

        {monitors.some((m) => SOURCES.some((s) => s.key === m.sourceType)) && (
          <div className="mt-2">
            <Button
              size="sm"
              onClick={() => {
                const first = monitors.find((m) => SOURCES.some((s) => s.key === m.sourceType));
                if (first) onRun(first.id);
              }}
            >
              Re-scan now
            </Button>
          </div>
        )}
      </div>
    </TabCard>
  );
}

/** Three states, because "Scanning…" over a job still waiting for a scanner lies. */
function RescanLink({ activity, onRun }: { activity: ScrapeActivity; onRun: () => void }) {
  return (
    <button
      type="button"
      onClick={onRun}
      disabled={activity !== null}
      className="ml-auto rounded-sm text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
    >
      {activity === "scraping" ? "Scanning…" : activity === "queued" ? "Queued" : "Re-scan now"}
    </button>
  );
}
