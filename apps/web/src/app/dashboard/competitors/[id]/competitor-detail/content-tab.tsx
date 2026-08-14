"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useInfiniteQuery, useQuery, keepPreviousData } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ArrowUpIcon, ArrowDownIcon, ArrowSquareOutIcon, LockIcon } from "@/components/icons";
import { Fact, FactStrip } from "@/components/outrival/data-marks";
import {
  hasNoTargetError,
  minPlanForSource,
  planAllowsMonitorSource,
  PLAN_LABELS,
  type Plan,
  type SourceType,
} from "@outrival/shared";
import {
  api,
  type ContentItemRow,
  type ContentSummary,
  type ContentTimeline,
  type CompetitorSignal,
  type Monitor,
} from "@/lib/api";
import {
  boardColumns,
  docsSections,
  groupByMonth,
  itemDate,
  kindGroups,
  pathnameOf,
  viewFor,
  SOURCE_COLOR,
  SOURCE_KEYS,
  SOURCES,
} from "./content-derive";
import { cn } from "@/lib/utils";
import { TabCard, TabSection } from "@/components/outrival/tab-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Empty,
  TabLoading,
  scrapeActivity,
  type MonitorSourceProps,
  type ScrapeActivity,
} from "./shared";

// recharts is heavy + client-only: lazy-load the plot so it stays off this route's
// first-load bundle, exactly as the pricing / reviews / hiring tabs do.
const CadenceBars = dynamic(() => import("./content-cadence-chart"), {
  ssr: false,
  loading: () => <Skeleton className="h-[200px] w-full" />,
});

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
 * THE SOURCE PICKS THE READING, and that is the third rule (OUT-13). One dated list
 * was the wrong shape for three of the four sources, because they do not publish the
 * same kind of thing:
 *
 *  - A ROADMAP IS A BOARD, NOT A FEED. Its entries carry a status and a vote count
 *    and mostly no date at all, so a chronological list sorted them by when WE saw
 *    them and buried the only two questions worth asking — what have they committed
 *    to, and what are their own customers shouting for. It gets a kanban, in
 *    commitment order, cards ranked by votes.
 *  - A CHANGELOG IS READ BY KIND. Whether a release breaks something is the scan,
 *    so the kind takes the left gutter and runs down the page as a column.
 *  - DOCS ARE READ BY AREA. A docs surface publishes pages and endpoints with no
 *    dates on them; grouping by month files them all under "this month". Grouped by
 *    the section of the site they landed in, the list says WHERE the product grew.
 *  - A BLOG, and the mixed "All" view, stay a dated timeline: that is what they are.
 *
 * Zero AI on this path: every number here is counted from rows P1/P2 wrote.
 */

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
  doc_endpoint: "New endpoint",
};

/**
 * Colour is spent on the three types that alert, and nowhere else.
 *
 * `breaking`, `deprecation` and `security` are the ones the pipeline emits a signal
 * on, so they borrow the product's severity badges and the timeline scans for
 * exactly what it acts on. Tinting all fourteen types would turn a dense list into a
 * sticker sheet and leave nothing to scan by.
 */
const LOUD_VARIANT: Record<string, "critical" | "high"> = {
  breaking: "critical",
  deprecation: "high",
  security: "high",
};

const PERIODS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "12 months" },
  { days: 0, label: "All" },
] as const;

/** Rows per fetch. The timeline pages rather than shipping a publication history. */
const FEED_PAGE = 20;
/** The board asks for more: six columns off twenty rows is not a roadmap. */
const BOARD_PAGE = 50;

/** How recent an editorial_pivot signal must be to still head the tab. */
const PIVOT_SHOWN_DAYS = 90;

const DAY_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
  timeZone: "UTC",
});

export function ContentTab({
  competitorId,
  signals,
  monitors,
  scrapingIds,
  onRun,
  onRunAll,
  onEnable,
  plan,
  onLockedSource,
}: {
  competitorId: string;
  /** Already on the page; carries the editorial_shift signal the callout renders. */
  signals: CompetitorSignal[];
  /** Runs the content sources this plan may actually run — see {@link runnableKeys}. */
  onRunAll: (only: readonly SourceType[]) => void;
  plan: Plan;
  /** Opens the paywall for a source above this plan (roadmap / docs). */
  onLockedSource?: (source: SourceType) => void;
} & MonitorSourceProps) {
  const [source, setSource] = useState<string>("all");
  const [type, setType] = useState<string>("all");
  const [period, setPeriod] = useState<number>(90);

  const pageSize = source === "roadmap" ? BOARD_PAGE : FEED_PAGE;

  // A re-scan must not ask for a source the plan freezes: after a downgrade the
  // roadmap/docs monitor rows are still there and the run route answers 403. Gated
  // through planAllowsMonitorSource rather than planIncludesSource because
  // `changelog` is in no plan's allowedSources at all — ungated, never locked.
  const runnableKeys = SOURCE_KEYS.filter((key) => planAllowsMonitorSource(plan, key));

  const summaryQuery = useQuery({
    queryKey: ["competitor", competitorId, "contentSummary"],
    queryFn: () => api.getCompetitorContentSummary(competitorId),
    placeholderData: keepPreviousData,
  });
  // Paged by OFFSET, one page appended to the last. It used to re-ask for a bigger
  // and bigger single page, which the endpoint caps at 50 — so the third press of
  // "Show more" asked for 60, was rejected as an invalid query, and dropped the
  // whole tab into its error state.
  const timelineQuery = useInfiniteQuery({
    queryKey: ["competitor", competitorId, "content", source, type, period],
    queryFn: ({ pageParam }) =>
      api.getCompetitorContent(competitorId, {
        source,
        type,
        period,
        limit: pageSize,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (last: ContentTimeline, all: ContentTimeline[]) =>
      last.hasMore ? all.reduce((n, page) => n + page.items.length, 0) : undefined,
    placeholderData: keepPreviousData,
  });

  const summary = summaryQuery.data ?? null;
  // Counts and totals come off the FIRST page: they describe the period, not the
  // slice of it that has been fetched.
  const timeline = timelineQuery.data?.pages[0] ?? null;
  const items = timelineQuery.data?.pages.flatMap((page) => page.items) ?? [];

  // The reading follows the ROWS, not the pill that was just pressed. A source
  // switch keeps the previous rows on screen while it loads, and reading those in
  // the new source's layout puts a board full of blog posts under a Planned column.
  const view = items.every((i) => i.sourceType === source) ? viewFor(source) : "feed";

  // A kind belongs to a source ("breaking" is a changelog word), so moving the
  // source pill leaves a kind that can only ever match nothing.
  const pickSource = (next: string) => {
    setSource(next);
    setType("all");
  };

  if (summaryQuery.isError || timelineQuery.isError)
    return <Empty text="Couldn't load this data right now. Try again in a moment." />;
  if (!summary || !timeline) return <TabLoading />;

  const everPublished = summary.cadence.reduce((n, m) => n + m.total, 0);
  if (everPublished === 0) {
    return (
      <NothingPublished
        monitors={monitors}
        scrapingIds={scrapingIds}
        onRunAll={onRunAll}
        onEnable={onEnable}
        plan={plan}
        onLockedSource={onLockedSource}
        runnableKeys={runnableKeys}
      />
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
  // The freshness FLOOR of the tab, not the first source's stamp: this timeline is
  // fed by four sources, so it is only as current as the one checked longest ago.
  const oldestCheck = contentMonitors.reduce<Date | null>((oldest, m) => {
    if (!m.lastRunAt) return oldest;
    const at = new Date(m.lastRunAt);
    return !oldest || at < oldest ? at : oldest;
  }, null);
  // At least one source tried since its last capture and did not come back. The tab
  // dot no longer shouts it in critical red over a full timeline, so the footer says
  // it here in words, next to the date it froze at and the link that retries it: the
  // entries below are real, they are simply the last ones we managed to read.
  const frozenByFailure = contentMonitors.some((m) => {
    if (!m.lastFailedAt) return false;
    const failed = new Date(m.lastFailedAt).getTime();
    if (Number.isNaN(failed)) return false;
    const run = m.lastRunAt ? new Date(m.lastRunAt).getTime() : 0;
    return failed >= run;
  });
  // The sources that actually put rows on this page. An enabled monitor can have
  // handed us nothing — never captured, or a page that lists no entries — and
  // naming it as somewhere this was "read from" credits the reading to pages we
  // never opened. Counted off the cadence rather than the timeline so the list
  // holds still when the period toggle moves.
  const published = totalsBySource(summary.cadence);
  const readMonitors = contentMonitors.filter((m) => (published[m.sourceType] ?? 0) > 0);

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

      {/* The source strip is the page's OWN tab component, one level down, because
          that is what it is: picking a source picks a reading, not a filter value.
          As a row of outlined pills it read as a third filter next to Kind and
          Period, and matched nothing else in the product. Kind and period stay
          toggles — they narrow what is on screen, they do not change its shape. */}
      <Tabs value={source} onValueChange={pickSource} className="gap-0 divide-y divide-border">
        <TabsList
          variant="line"
          className="w-full justify-start border-b-0 px-2"
          aria-label="Where it was published"
        >
          <TabsTrigger value="all">
            All
            <span className="tabular-nums opacity-70">{sumCounts(timeline.sourceCounts)}</span>
          </TabsTrigger>
          {SOURCES.filter((s) => (timeline.sourceCounts[s.key] ?? 0) > 0).map((s) => (
            <TabsTrigger key={s.key} value={s.key}>
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: s.color }}
              />
              {s.label}
              <span className="tabular-nums opacity-70">{timeline.sourceCounts[s.key]}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={source} className="flex flex-col divide-y divide-border">
          <div className="flex flex-wrap items-center gap-2 bg-surface-2/45 px-5 py-3">
            <KindFilter
              counts={timeline.typeCounts}
              source={source}
              value={type}
              onChange={setType}
            />

            <ToggleGroup
              type="single"
              value={String(period)}
              onValueChange={(v) => v && setPeriod(Number(v))}
              variant="outline"
              size="sm"
              aria-label="Period"
            >
              {PERIODS.map((p) => (
                <ToggleGroupItem key={p.days} value={String(p.days)} className="text-xs">
                  {p.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {timeline.total} {timeline.total === 1 ? "item" : "items"} ·{" "}
              {period === 0
                ? "all time"
                : `last ${PERIODS.find((p) => p.days === period)?.label.toLowerCase()}`}
            </span>
          </div>

          <QuietSources
            counts={timeline.sourceCounts}
            cadence={summary.cadence}
            monitors={monitors}
            scrapingIds={scrapingIds}
            onEnable={onEnable}
            plan={plan}
            onLockedSource={onLockedSource}
          />

          {items.length === 0 ? (
            <NoMatch />
          ) : view === "board" ? (
            <RoadmapBoard items={items} />
          ) : view === "releases" ? (
            <ReleaseNotes items={items} />
          ) : view === "pages" ? (
            <DocsAreas items={items} />
          ) : (
            <Timeline items={items} showSource={source === "all"} />
          )}

          {timelineQuery.hasNextPage && (
            <div className="flex justify-center px-5 py-3.5">
              <Button
                variant="outline"
                size="sm"
                disabled={timelineQuery.isFetchingNextPage}
                onClick={() => void timelineQuery.fetchNextPage()}
              >
                {timelineQuery.isFetchingNextPage ? (
                  "Loading…"
                ) : (
                  <>
                    Show {Math.min(pageSize, timeline.total - items.length)} more ·{" "}
                    <span className="tabular-nums">{timeline.total - items.length}</span> left
                  </>
                )}
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-xs text-muted-foreground">
        {readMonitors.length > 0 && (
          <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5">
            Read from
            {readMonitors.map((m, i) => (
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
        {oldestCheck && (
          <span>
            {frozenByFailure ? "last successful check " : "last check "}
            {formatDistanceToNow(oldestCheck, { addSuffix: true })}
          </span>
        )}
        {frozenByFailure && <span>a later scan failed, so this is where it stops</span>}
        {contentMonitors.length > 0 && (
          <RescanLink
            activity={groupActivity(contentMonitors, scrapingIds)}
            onRun={() => onRunAll(runnableKeys)}
          />
        )}
      </div>
    </TabCard>
  );
}

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((n, v) => n + v, 0);
}

/** source_type → items over the whole cadence, the rows the tab's own totals count. */
function totalsBySource(cadence: ContentSummary["cadence"]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const month of cadence) {
    for (const [key, n] of Object.entries(month.bySource)) out[key] = (out[key] ?? 0) + n;
  }
  return out;
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
 * The plot itself is recharts, lazy-loaded (`content-cadence-chart`), like every
 * other chart in the product: this is the frame around it. It was hand-drawn CSS
 * columns carrying a `title` attribute, so reading a month meant waiting on the
 * browser's own tooltip for one line of text with no breakdown.
 */
function CadenceChart({ cadence }: { cadence: ContentSummary["cadence"] }) {
  const present = SOURCES.filter((s) => cadence.some((m) => (m.bySource[s.key] ?? 0) > 0));
  const hasPartial = cadence.some((m) => m.partial);

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

      <CadenceBars cadence={cadence} sources={[...present]} />

      {hasPartial && (
        <p className="text-xs text-muted-foreground">
          This month is still running, so it is drawn open and counts toward nothing — the cadence
          read only ever compares months that have ended.
        </p>
      )}
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
                <span aria-hidden className="absolute inset-x-0 h-1.5 rounded-full bg-track" />
                <span
                  aria-hidden
                  className="absolute left-0 h-1.5 rounded-full bg-link"
                  style={{ width: `${t.now > 0 ? Math.max((t.now / max) * 100, 3) : 0}%` }}
                />
                {/* "Where it was" — the whole point of the row, so it takes the 3:1
                    floor. At muted-foreground/65 it measured 2.6:1 on the gutter and
                    1.4:1 where it crossed the fill, i.e. it disappeared exactly when
                    the bar had grown past it. Full foreground + a track ring reads on
                    both. */}
                <span
                  aria-hidden
                  className="absolute top-px h-3 w-0.5 rounded-[1px] bg-foreground ring-1 ring-track"
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

/**
 * Why the sources that filed nothing filed nothing.
 *
 * The toggles above only show a source that produced rows, so a tab fed by the blog
 * alone looked like a competitor who only blogs — the other three vanished with no
 * account of themselves. Each one is named here with its own state, because "we
 * watch it and it has published nothing", "they have no public portal" and "this is
 * switched off" are three different facts and only some of them are actionable.
 *
 * State comes from the monitor, never from a guess: a source we watched successfully
 * and hold nothing for is reported as exactly that.
 */
function QuietSources({
  counts,
  cadence,
  monitors,
  scrapingIds,
  onEnable,
  plan,
  onLockedSource,
}: {
  /** Rows in the SELECTED PERIOD, per source. */
  counts: Record<string, number>;
  /** The full cadence window, so a source silent only in this period says so. */
  cadence: ContentSummary["cadence"];
  monitors: Monitor[];
  scrapingIds: Set<string>;
  onEnable?: MonitorSourceProps["onEnable"];
  plan: Plan;
  onLockedSource?: (source: SourceType) => void;
}) {
  const [enabling, setEnabling] = useState<string | null>(null);
  const quiet = SOURCES.filter((s) => (counts[s.key] ?? 0) === 0);
  if (quiet.length === 0) return null;

  // A source that HAS filed things, just not inside the period on screen, is not a
  // source we cannot read. Saying "nothing filed yet" about it would be false.
  const filedEver = new Set(
    SOURCES.filter((s) => cadence.some((m) => (m.bySource[s.key] ?? 0) > 0)).map((s) => s.key),
  );

  return (
    <div className="flex flex-col gap-1.5 border-t border-border px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {quiet.map((s) => {
          const monitor = monitors.find((m) => m.sourceType === s.key);
          // The padlock outranks every other reading, exactly as it does in
          // `sourceState`: a plan-frozen source files nothing BECAUSE it is frozen,
          // and "not monitored" next to a Turn on link offers an enable the API 403s.
          const locked = !planAllowsMonitorSource(plan, s.key);
          if (locked) {
            return (
              <span key={s.key} className="inline-flex items-center gap-1.5 text-xs">
                <LockIcon size={14} className="shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">
                  {s.label}: included in {PLAN_LABELS[minPlanForSource(s.key)]}
                </span>
                {onLockedSource && (
                  <button
                    type="button"
                    onClick={() => onLockedSource(s.key)}
                    className="rounded-sm text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Upgrade
                  </button>
                )}
              </span>
            );
          }
          return (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-xs">
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full opacity-45"
                style={{ background: s.color }}
              />
              <span className="text-muted-foreground">
                {s.label}:{" "}
                {filedEver.has(s.key) ? "nothing in this period" : quietState(monitor, scrapingIds)}
              </span>
              {!monitor && onEnable && (
                <button
                  type="button"
                  disabled={enabling === s.key}
                  onClick={async () => {
                    setEnabling(s.key);
                    try {
                      await onEnable(s.key as SourceType);
                    } finally {
                      setEnabling(null);
                    }
                  }}
                  className="rounded-sm text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  {enabling === s.key ? "Turning on…" : "Turn on"}
                </button>
              )}
            </span>
          );
        })}
      </div>
      <p className="max-w-[74ch] text-xs text-muted-foreground">
        A source files entries only where it can read them one by one: a changelog
        needs a feed, a roadmap needs a public portal, and documentation files the
        pages that appear after we start watching. Everything else these sources
        publish is still captured, and still reaches the signals feed as a change.
      </p>
    </div>
  );
}

/** One short phrase per source, from the monitor and nothing else. */
function quietState(monitor: Monitor | undefined, scrapingIds: Set<string>): string {
  if (!monitor) return "not monitored";
  if (monitor.isActive === false) return "paused";
  const activity = scrapeActivity(monitor, scrapingIds.has(monitor.id));
  if (activity === "scraping") return "reading it now";
  if (activity === "queued") return "queued";
  // The neutral outcome ("they publish no portal") is a fact about the competitor and
  // is checked FIRST, before any failure or freshness reading: the worker records it
  // as a benign skip, which stamps lastRunAt and leaves markedUnscrapable false, so
  // nesting it under the failure branch let a roadmap with no portal fall through to
  // "watched, nothing filed yet" — a claim that we are reading a page that isn't there.
  if (hasNoTargetError(monitor.sourceType, monitor.lastError)) return "nothing public to read";
  // Anything else here is a failure of ours, and the Sources page carries the detail.
  // It doesn't belong in a strip this size at full length.
  if (monitor.markedUnscrapable) return "we could not read it";
  if (!monitor.lastRunAt) return "not read yet";
  return "watched, nothing filed yet";
}

/** Same words whichever reading is on screen, since it is the filters that are empty. */
function NoMatch() {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
      <p className="text-content font-semibold">Nothing matches those filters</p>
      <p className="text-sm text-muted-foreground">Widen the period, or clear the kind.</p>
    </div>
  );
}

/**
 * The kind filter — what an item IS, next to the pills that say where it came from.
 *
 * Three things make it read as its own question rather than a second copy of the
 * source pills: the trigger carries the word "Kind" at all times, the options are
 * the selected source's own vocabulary, and on "All" they are grouped under the
 * source each one belongs to. When the source has a single kind there is nothing to
 * choose, so the control is not rendered at all.
 */
function KindFilter({
  counts,
  source,
  value,
  onChange,
}: {
  counts: ContentTimeline["typeCounts"];
  source: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const groups = useMemo(
    () =>
      kindGroups(counts, source).map((group) => ({
        key: group.source,
        label: SOURCES.find((s) => s.key === group.source)?.label ?? group.source,
        kinds: group.kinds.map((kind) => ({
          // `unread` is the API's word for "no type yet" — a state, not a kind.
          value: kind.itemType ?? "unread",
          label: kind.itemType ? (TYPE_LABEL[kind.itemType] ?? kind.itemType) : "Not read yet",
          count: kind.count,
        })),
      })),
    [counts, source],
  );

  const total = groups.reduce((n, g) => n + g.kinds.length, 0);
  // Nothing to choose between — but never while a kind is applied, which would
  // hide the only control that can clear it.
  if (total < 2 && value === "all") return null;

  // Written out rather than mirrored from the selected option: the option carries
  // its count, and a trigger reading "Kind Feature 12" is three numbers of chrome.
  const selected =
    groups.flatMap((g) => g.kinds).find((k) => k.value === value)?.label ?? "Any";

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-[13rem] text-xs" aria-label="Kind of item">
        <span className="flex min-w-0 items-baseline gap-1.5 truncate">
          <span className="text-muted-foreground">Kind</span>
          <SelectValue>{selected}</SelectValue>
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Any</SelectItem>
        {groups.map((group) => (
          <SelectGroup key={group.key}>
            {/* Named even on a single source: it is the word that says these are the
                blog's kinds, not another list of sources. */}
            <SelectLabel>{group.label}</SelectLabel>
            {group.kinds.map((kind) => (
              <SelectItem key={`${group.key}:${kind.value}`} value={kind.value}>
                {kind.label}{" "}
                <span className="tabular-nums text-muted-foreground">{kind.count}</span>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The band that opens a group, in every reading: a name, a count, a caveat. */
function GroupHead({
  title,
  count,
  unit,
  note,
}: {
  title: string;
  count: number;
  /** Singular, plural — "page"/"pages" is not "item"/"items" in a docs section. */
  unit: [string, string];
  note?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 border-t border-border bg-surface-2/55 px-5 py-2.5 first:border-t-0">
      <h4 className="text-xs font-semibold capitalize tracking-tight">{title}</h4>
      <span className="text-xs tabular-nums text-muted-foreground">
        {count} {count === 1 ? unit[0] : unit[1]}
      </span>
      {note && <span className="text-xs text-muted-foreground">· {note}</span>}
    </div>
  );
}

/** The title, linked out when the source gave us a URL. */
function ItemLink({ item }: { item: ContentItemRow }) {
  if (!item.url) return <span className="text-sm font-medium">{item.title}</span>;
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-baseline gap-1 rounded-sm text-sm font-medium text-foreground underline-offset-2 outline-none hover:text-link hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      {item.title}
      <ArrowSquareOutIcon size={14} className="shrink-0 self-center text-muted-foreground" aria-hidden />
    </a>
  );
}

/** The kind, or the honest blank when nobody has read the item yet. */
function KindBadge({ item }: { item: ContentItemRow }) {
  const label = item.itemType ? (TYPE_LABEL[item.itemType] ?? item.itemType) : null;
  const loud = item.itemType ? LOUD_VARIANT[item.itemType] : undefined;
  if (!item.enriched || !label)
    return <em className="text-meta not-italic text-muted-foreground">not read yet</em>;
  return (
    <Badge variant={loud ?? "secondary"} className={loud ? undefined : "text-meta capitalize"}>
      {label}
    </Badge>
  );
}

/**
 * A competitor's roadmap as the board it is published as.
 *
 * Columns run in COMMITMENT order and are headed by our word for the state and, when
 * the portal spells it differently, by the portal's own: "Up next" is what their
 * customers read, and translating it silently would put words in their mouth. The
 * grouping and the ranking are in {@link boardColumns}.
 */
function RoadmapBoard({ items }: { items: ContentItemRow[] }) {
  const columns = useMemo(() => boardColumns(items), [items]);

  const anyVotes = items.some((i) => i.votes !== null);
  const anyUndated = items.some((i) => i.publishedAt === null);

  return (
    <div className="flex flex-col">
      {/* Focusable so the board can be reached and scrolled from the keyboard. */}
      <div
        role="region"
        aria-label="Roadmap board"
        tabIndex={0}
        className="snap-x overflow-x-auto px-5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {/* Columns SHARE the width instead of being pinned at 16rem: `1fr` above a
            15rem floor lets three states fill a wide reading column, and the same
            floor is what makes the track overflow — and scroll, one column at a
            time — once the states no longer fit. The old `min-w-max` did neither:
            it left a hole to the right of a two-column roadmap and scrolled a
            phone by half-columns. */}
        <div className="grid auto-cols-[minmax(15rem,1fr)] grid-flow-col items-start gap-3">
          {columns.map((column) => (
            <section
              key={column.status}
              className="flex snap-start flex-col gap-2 rounded-lg border border-border bg-surface-2/45 p-2"
            >
              <header className="flex flex-col gap-0.5 px-1.5 pt-1">
                <div className="flex items-baseline gap-2">
                  <h4 className="text-xs font-semibold tracking-tight">{column.label}</h4>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {column.items.length}
                  </span>
                </div>
                {column.theirWords.length > 0 && (
                  <p
                    className="truncate text-meta capitalize text-muted-foreground"
                    title={column.theirWords.join(", ")}
                  >
                    {column.theirWords.join(" · ")}
                  </p>
                )}
              </header>
              <ul className="flex flex-col gap-2">
                {column.items.map((item) => (
                  <RoadmapCard key={item.id} item={item} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>

      <p className="max-w-[74ch] px-5 py-3 text-xs text-muted-foreground">
        Every portal names its columns differently, so entries are grouped on a common
        set of states and each column also carries the words this one uses.
        {anyVotes && " Cards rank on the vote count the portal publishes."}
        {anyUndated && " A portal states a status, not a date, so dates are when we first saw the entry."}
      </p>
    </div>
  );
}

function RoadmapCard({ item }: { item: ContentItemRow }) {
  const at = itemDate(item);
  return (
    // A card on the column's tint rather than a row in a divided list: E1 depth is
    // the hairline border alone, and it is what makes the entries read as movable
    // things sitting IN a state rather than as a list that happens to be narrow.
    <li className="flex flex-col gap-1.5 rounded-md border border-border bg-surface px-3 py-2.5 transition-colors hover:border-border-strong hover:bg-surface-3/55">
      <ItemLink item={item} />
      {item.summary && (
        <p className="line-clamp-3 text-dense text-muted-foreground">{item.summary}</p>
      )}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
        {item.votes !== null && (
          <span className="inline-flex items-center gap-1 rounded-sm bg-surface-2 px-1.5 py-0.5">
            <ArrowUpIcon size={14} aria-hidden />
            <span className="font-semibold tabular-nums text-foreground">{item.votes}</span>
            {item.votes === 1 ? "vote" : "votes"}
          </span>
        )}
        <span className="tabular-nums">{DAY_LABEL.format(at)}</span>
      </div>
    </li>
  );
}

/**
 * A changelog read the way release notes are read: down the KIND column.
 *
 * Whether a release breaks something, deprecates something or fixes something is the
 * question, and in the mixed timeline that fact sat at the end of the title line
 * where it could not be scanned. Here it holds the left gutter, so a month of
 * releases answers "did they break anything" without reading a single title.
 */
function ReleaseNotes({ items }: { items: ContentItemRow[] }) {
  const groups = useMemo(() => groupByMonth(items), [items]);

  return (
    <div>
      {groups.map((group) => (
        <div key={group.key}>
          <GroupHead
            title={group.label}
            count={group.items.length}
            unit={["entry", "entries"]}
            note={group.undated ? "dates below are when we first saw them" : undefined}
          />
          {group.items.map((item) => (
            <div
              key={item.id}
              className="flex gap-3.5 border-t border-border px-5 py-3 transition-colors hover:bg-surface-3/55"
            >
              <span className="w-[6.5rem] shrink-0 pt-0.5">
                <KindBadge item={item} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <ItemLink item={item} />
                  <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                    {DAY_LABEL.format(itemDate(item))}
                  </span>
                </div>
                {item.summary && (
                  <p className="max-w-[68ch] text-dense text-muted-foreground">{item.summary}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Their docs, by the area of the product each new page or endpoint documents. */
function DocsAreas({ items }: { items: ContentItemRow[] }) {
  const areas = useMemo(() => docsSections(items), [items]);

  const anyUndated = items.some((i) => i.publishedAt === null);

  return (
    <div>
      {areas.map((section) => (
        <div key={section.area}>
          <GroupHead
            title={section.area}
            count={section.rows.length}
            unit={section.endpointsOnly ? ["endpoint", "endpoints"] : ["page", "pages"]}
          />
          {section.rows.map((item) => (
            <DocsRow key={item.id} item={item} />
          ))}
        </div>
      ))}
      {anyUndated && (
        <p className="max-w-[74ch] px-5 py-3 text-xs text-muted-foreground">
          A docs index carries no publication dates, so the date is the capture this
          page first appeared in — the first capture of a docs surface publishes
          nothing, precisely so an existing site is not reported as written today.
        </p>
      )}
    </div>
  );
}

function DocsRow({ item }: { item: ContentItemRow }) {
  const endpoint = item.itemType === "doc_endpoint";
  const [method, ...rest] = item.title.split(" ");
  const path = pathnameOf(item.url);

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border px-5 py-2.5 transition-colors hover:bg-surface-3/55">
      {endpoint ? (
        <>
          <span className="shrink-0 rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-meta uppercase text-muted-foreground">
            {method}
          </span>
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 truncate rounded-sm font-mono text-dense text-foreground underline-offset-2 outline-none hover:text-link hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {rest.join(" ")}
            </a>
          ) : (
            <span className="min-w-0 truncate font-mono text-dense">{rest.join(" ")}</span>
          )}
        </>
      ) : (
        <>
          <ItemLink item={item} />
          {path && (
            <span className="min-w-0 truncate font-mono text-meta text-muted-foreground">
              {path}
            </span>
          )}
        </>
      )}
      <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
        {DAY_LABEL.format(itemDate(item))}
      </span>
    </div>
  );
}

/** Blog and the mixed view: what they published, when. */
function Timeline({ items, showSource }: { items: ContentItemRow[]; showSource: boolean }) {
  const groups = useMemo(() => groupByMonth(items), [items]);

  return (
    <div>
      {groups.map((group) => (
        <div key={group.key}>
          <GroupHead
            title={group.label}
            count={group.items.length}
            unit={["item", "items"]}
            note={group.undated ? "dates below are when we first saw them" : undefined}
          />
          {group.items.map((item) => (
            <TimelineRow key={item.id} item={item} showSource={showSource} />
          ))}
        </div>
      ))}
    </div>
  );
}

function TimelineRow({ item, showSource }: { item: ContentItemRow; showSource: boolean }) {
  const at = itemDate(item);

  return (
    <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3.5 gap-y-1 border-t border-border px-5 py-3 transition-colors hover:bg-surface-3/55 sm:grid-cols-[3.25rem_minmax(0,1fr)]">
      <span className="row-span-3 flex items-baseline gap-1.5 pt-px text-xs tabular-nums text-muted-foreground">
        <span
          aria-hidden
          title={item.sourceType}
          className="size-1.5 shrink-0 -translate-y-0.5 rounded-full"
          style={{ background: SOURCE_COLOR[item.sourceType] ?? "var(--muted-foreground)" }}
        />
        {item.publishedAt === null ? (
          <span
            className="underline decoration-dotted underline-offset-2"
            title="This source didn't date the item. This is when we first saw it."
          >
            {DAY_LABEL.format(at)}
          </span>
        ) : (
          DAY_LABEL.format(at)
        )}
      </span>

      <span className="flex min-w-0 flex-wrap items-baseline gap-2">
        <ItemLink item={item} />

        {/* Named only in the mixed view. On a single source the pill above already
            says it, and repeating it on every row is a column of one word. */}
        {showSource && <span className="text-meta text-muted-foreground">{item.sourceType}</span>}

        {/* Roadmap entries carry a status, not a type: "planned → shipped" IS the
            reason to watch a portal, so it takes the badge slot. */}
        {item.sourceType === "roadmap" && item.status ? (
          <Badge
            variant="outline"
            className={cn(
              "text-meta capitalize",
              /ship|deliver|complete|done|launch/i.test(item.status) &&
                "border-positive/30 bg-positive/12 text-positive",
            )}
          >
            {item.status}
          </Badge>
        ) : (
          <KindBadge item={item} />
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

/**
 * Nothing to read at all: not one of the four sources has produced an item.
 *
 * Each source is named with its own state rather than one blanket line, because
 * "we watch it and it has published nothing" and "they have no changelog" and "this
 * is switched off" are three different facts, and only the third is actionable.
 */
function NothingPublished({
  monitors,
  scrapingIds,
  onRunAll,
  onEnable,
  plan,
  onLockedSource,
  runnableKeys,
}: Omit<MonitorSourceProps, "onRun"> & {
  onRunAll: (only: readonly SourceType[]) => void;
  plan: Plan;
  onLockedSource?: (source: SourceType) => void;
  /** The sources this plan may re-scan — locked ones would only earn a 403. */
  runnableKeys: readonly SourceType[];
}) {
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
            // Same precedence as `QuietSources` and `sourceState`: above the plan
            // beats every other state, so the row is an offer rather than a gap.
            const locked = !planAllowsMonitorSource(plan, s.key);
            return (
              <li
                key={s.key}
                className="flex items-center gap-2.5 border-t border-border py-2.5 text-dense first:border-t-0"
              >
                {locked ? (
                  <LockIcon size={14} className="shrink-0 text-muted-foreground" />
                ) : (
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: s.color }}
                  />
                )}
                <span className={cn("font-medium", locked && "text-muted-foreground")}>
                  {s.label}
                </span>
                <span className="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground">
                  {locked ? (
                    <>
                      Included in {PLAN_LABELS[minPlanForSource(s.key)]}
                      {onLockedSource && (
                        <button
                          type="button"
                          onClick={() => onLockedSource(s.key)}
                          className="rounded-sm text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          Upgrade
                        </button>
                      )}
                    </>
                  ) : !monitor ? (
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
                        className="rounded-sm text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                      >
                        {enabling === s.key ? "Turning on…" : `Turn on ${s.label.toLowerCase()} monitoring`}
                      </button>
                    ) : (
                      "not monitored"
                    )
                  ) : (
                    // The same phrase this source gets when the tab HAS content
                    // (`QuietSources`): one state, told one way, on both surfaces.
                    quietState(monitor, scrapingIds)
                  )}
                </span>
              </li>
            );
          })}
        </ul>

        {monitors.some((m) => runnableKeys.includes(m.sourceType)) && (
          <div className="mt-2">
            <Button size="sm" onClick={() => onRunAll(runnableKeys)}>
              Re-scan now
            </Button>
          </div>
        )}
      </div>
    </TabCard>
  );
}

/**
 * How a GROUP of sources reads: scanning while any is being read, queued while any
 * is waiting, idle only when none of them is in flight. A per-source state would
 * leave the link clickable while three of the four were already running.
 */
function groupActivity(monitors: Monitor[], scrapingIds: Set<string>): ScrapeActivity {
  const states = monitors.map((m) => scrapeActivity(m, scrapingIds.has(m.id)));
  if (states.includes("scraping")) return "scraping";
  if (states.includes("queued")) return "queued";
  return null;
}

/** Three states, because "Scanning…" over a job still waiting for a scanner lies. */
function RescanLink({ activity, onRun }: { activity: ScrapeActivity; onRun: () => void }) {
  return (
    <button
      type="button"
      onClick={onRun}
      disabled={activity !== null}
      className="ml-auto rounded-sm text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
    >
      {activity === "scraping" ? "Scanning…" : activity === "queued" ? "Queued" : "Re-scan now"}
    </button>
  );
}
