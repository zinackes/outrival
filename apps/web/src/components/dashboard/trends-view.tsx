"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { LineChart as LineChartIcon } from "lucide-react";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import { EmptyState } from "./empty-state";
import {
  type TrendsMarketSeries,
  type PricingMove,
  type HiringMove,
  type ReviewMove,
  type TechMove,
} from "@/lib/api";
import { trendsSummaryQuery, trendsMarketQuery } from "@/lib/queries";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { competitorNameColor } from "@/lib/competitor-color";
import { seriesStroke } from "@/lib/series-color";
import { Skeleton } from "@/components/ui/skeleton";
import { CompAvatar } from "./comp-avatar";
import { Sparkline } from "./sparkline";
import { PageHead } from "./page-head";
import {
  DateRangePicker,
  DEFAULT_PRESETS,
  ALL_TIME_PRESET,
  lastNDays,
  type DateRange,
} from "@/components/ui/date-range-picker";

// Trends reads straight from the time-series tables, so it can offer "All time"
// on top of the rolling windows (unlike the overview's "last N days" labels).
const TRENDS_PRESETS = [...DEFAULT_PRESETS, ALL_TIME_PRESET];

// recharts is heavy + client-only: lazy-load the market chart so it stays off the
// Trends route's first-load bundle (F7).
const MarketChart = dynamic(() => import("./trends-market-chart"), {
  ssr: false,
  loading: () => <Skeleton className="h-[200px] w-full" />,
});

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

function shortDate(iso: string): string {
  return formatDate(iso, { month: "short", day: "numeric" });
}

function money(value: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${Math.round(value)} ${currency ?? ""}`.trim();
  }
}

function pctChange(price: number, prev: number | null): number | null {
  if (!prev) return null;
  return Math.round(((price - prev) / prev) * 100);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/* -------------------------------------------------------------------------- */
/* Readings                                                                    */
/*                                                                             */
/* Every sentence on this page is computed from the captured rows, never        */
/* generated: the same rule the competitor tabs follow. A trends page whose     */
/* headline came from a model would be the one surface where the user cannot    */
/* check the claim against the numbers printed directly beneath it.             */
/* -------------------------------------------------------------------------- */

function readPricing(moves: PricingMove[]) {
  const raised = moves.filter((m) => m.prevPrice !== null && m.price > m.prevPrice);
  const cut = moves.filter((m) => m.prevPrice !== null && m.price < m.prevPrice);
  const raisedCompetitors = new Set(raised.map((m) => m.competitorId)).size;
  const cutCompetitors = new Set(cut.map((m) => m.competitorId)).size;
  // Largest relative move, which is the one a headline should name.
  const ranked = [...moves]
    .map((m) => ({ move: m, pct: pctChange(m.price, m.prevPrice) ?? 0 }))
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  return { raised, cut, raisedCompetitors, cutCompetitors, top: ranked[0] ?? null, ranked };
}

function readHiring(moves: HiringMove[]) {
  const net = moves.reduce((acc, m) => acc + m.net, 0);
  const scaling = moves.filter((m) => m.net > 0);
  const slowing = moves.filter((m) => m.net < 0);
  const ranked = [...moves].sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  const driver = ranked.find((m) => m.net !== 0) ?? null;
  return { net, scaling, slowing, driver, ranked };
}

function readReviews(moves: ReviewMove[]) {
  const drifted = moves
    .map((m) => ({
      move: m,
      drift: m.firstScore != null ? Math.round((m.score - m.firstScore) * 100) / 100 : null,
    }))
    .sort((a, b) => Math.abs(b.drift ?? 0) - Math.abs(a.drift ?? 0));
  // A tenth of a point is capture noise between two sources; a fifth is a move.
  const moved = drifted.filter((d) => d.drift !== null && Math.abs(d.drift) >= 0.2);
  const falling = moved.filter((d) => (d.drift ?? 0) < 0);
  return { drifted, moved, falling, worst: falling[0] ?? null };
}

function readTech(moves: TechMove[]) {
  const added = moves.filter((m) => m.event === "appeared");
  const dropped = moves.filter((m) => m.event === "disappeared");
  // One row per tool rather than per competitor-tool pair: "Stripe, adopted by two"
  // is a market read, six near-identical rows are a log.
  const groups = new Map<string, { techId: string; event: string; names: string[]; at: string }>();
  for (const m of moves) {
    const key = `${m.techId}:${m.event}`;
    const group = groups.get(key);
    if (group) {
      if (!group.names.includes(m.competitorName)) group.names.push(m.competitorName);
      if (m.recordedAt > group.at) group.at = m.recordedAt;
    } else {
      groups.set(key, {
        techId: m.techId,
        event: m.event,
        names: [m.competitorName],
        at: m.recordedAt,
      });
    }
  }
  const ranked = [...groups.values()].sort(
    (a, b) => b.names.length - a.names.length || b.at.localeCompare(a.at),
  );
  return { added, dropped, ranked };
}

/**
 * The one sentence the window is worth. Ranked by what a competitive analyst acts
 * on first: a price move changes a deal today, a hiring swing changes a roadmap
 * next quarter, a review slide changes a talk track, tech adoption is context.
 */
function readMarket(
  pricing: ReturnType<typeof readPricing>,
  hiring: ReturnType<typeof readHiring>,
  reviews: ReturnType<typeof readReviews>,
  tech: ReturnType<typeof readTech>,
): { headline: string; detail: string } {
  const priceMovers = pricing.raisedCompetitors + pricing.cutCompetitors;
  const clauses: string[] = [];

  let headline: string;
  if (priceMovers > 0 && pricing.raisedCompetitors >= pricing.cutCompetitors) {
    headline =
      pricing.cutCompetitors > 0
        ? `${pricing.raisedCompetitors} ${plural(pricing.raisedCompetitors, "competitor")} raised prices, ${pricing.cutCompetitors} cut.`
        : `${pricing.raisedCompetitors} ${plural(pricing.raisedCompetitors, "competitor")} raised prices and none cut.`;
  } else if (priceMovers > 0) {
    headline = `${pricing.cutCompetitors} ${plural(pricing.cutCompetitors, "competitor")} cut prices, ${pricing.raisedCompetitors} raised.`;
  } else if (hiring.net !== 0) {
    headline =
      hiring.net > 0
        ? `Hiring is where the market moved: ${hiring.net} open ${plural(hiring.net, "role")} added.`
        : `The market pulled back hiring by ${Math.abs(hiring.net)} ${plural(Math.abs(hiring.net), "role")}.`;
  } else if (reviews.worst) {
    headline = `${reviews.worst.move.competitorName} lost ${Math.abs(reviews.worst.drift ?? 0).toFixed(1)} points on ${reviews.worst.move.source}.`;
  } else if (tech.added.length > 0) {
    headline = `No price or hiring movement. ${tech.added.length} ${plural(tech.added.length, "tool")} adopted.`;
  } else {
    headline = "Nothing moved in this window.";
  }

  // The supporting line carries whichever readings the headline did not take.
  if (priceMovers > 0 && pricing.top && pricing.top.pct !== 0) {
    clauses.push(
      `${pricing.top.move.competitorName} moved furthest, ${pricing.top.pct > 0 ? "up" : "down"} ${Math.abs(pricing.top.pct)}% on ${pricing.top.move.planName}`,
    );
  }
  if (hiring.net !== 0 && !headline.startsWith("Hiring")) {
    clauses.push(
      `hiring is ${hiring.net > 0 ? "up" : "down"} ${Math.abs(hiring.net)} open ${plural(Math.abs(hiring.net), "role")}`,
    );
  }
  if (reviews.moved.length > 0) {
    clauses.push(
      `${reviews.moved.length} review ${plural(reviews.moved.length, "score")} shifted`,
    );
  } else if (reviews.drifted.length > 0) {
    clauses.push("review scores held");
  }
  if (tech.added.length > 0 && !headline.includes("adopted")) {
    clauses.push(`${tech.added.length} ${plural(tech.added.length, "tool")} adopted`);
  }

  // The strongest supporting reading gets its own sentence; the rest follow in one
  // more. Chaining four clauses onto a single comma spliced sentence reads as filler
  // and buries whichever one the user actually needed.
  const sentence = (parts: string[]) => {
    const capped = `${parts[0]![0]!.toUpperCase()}${parts[0]!.slice(1)}`;
    if (parts.length === 1) return `${capped}.`;
    if (parts.length === 2) return `${capped}, and ${parts[1]}.`;
    return `${capped}, ${parts.slice(1, -1).join(", ")}, and ${parts[parts.length - 1]}.`;
  };
  const detail =
    clauses.length === 0
      ? "The sources reported, and nothing in them changed."
      : clauses.length === 1
        ? sentence(clauses)
        : `${sentence([clauses[0]!])} ${sentence(clauses.slice(1, 3))}`;
  return { headline, detail };
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One cell of the verdict card's rail. Each carries a value AND what it is a
 * value against, so no number on the rail is left uncompared.
 */
function RailStat({
  label,
  value,
  tone,
  children,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-1 border-border px-4 py-3",
        "border-b last:border-b-0 max-lg:border-b-0 max-lg:border-r max-lg:last:border-r-0",
        "max-sm:border-b max-sm:border-r-0 max-sm:last:border-b-0",
      )}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <span
        className={cn(
          "font-mono text-xl font-semibold leading-none tracking-tight tabular-nums",
          // A competitor raising a price or opening roles is pressure on you, so
          // "up" is warm here rather than green.
          tone === "up" && "text-high",
          tone === "down" && "text-positive",
        )}
      >
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{children}</span>
    </div>
  );
}

/**
 * One movement of the report. Boxless (DESIGN.md): a heading, the reading it
 * produced, then the evidence, separated by rhythm rather than card chrome.
 */
function Movement({
  title,
  verdict,
  meta,
  children,
}: {
  title: string;
  verdict: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-4 border-b border-border pb-2.5">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-tight tracking-tight">{title}</h2>
          <p className="mt-1 max-w-[70ch] text-sm text-muted-foreground">{verdict}</p>
        </div>
        {meta && <div className="shrink-0 text-xs text-muted-foreground">{meta}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * The chart's key, and its filter. Clicking a competitor drops its line, so eight
 * overlapping series can be read two at a time without leaving the page.
 */
function ChartKey({
  series,
  hidden,
  onToggle,
}: {
  series: TrendsMarketSeries[];
  hidden: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {series.map((item, i) => {
        const off = hidden.has(item.competitorId);
        return (
          <button
            key={item.competitorId}
            type="button"
            onClick={() => onToggle(item.competitorId)}
            aria-pressed={!off}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-xs transition-opacity",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              off ? "opacity-40" : "hover:opacity-70",
            )}
          >
            <span
              aria-hidden
              className="h-0.5 w-3.5 shrink-0 rounded-full"
              style={{ background: seriesStroke(item.color, i) }}
            />
            <span className={cn(item.isSelf && "font-medium")}>
              {item.competitorName}
              {item.isSelf && <span className="text-muted-foreground"> (you)</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A market chart plus its key, sharing one hidden-series state. */
function MarketPlot({
  series,
  mode,
  formatValue,
  height,
}: {
  series: TrendsMarketSeries[];
  mode: "index" | "absolute";
  formatValue: (value: number, item: TrendsMarketSeries) => string;
  height?: number;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  if (series.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <MarketChart series={series} mode={mode} formatValue={formatValue} hidden={hidden} height={height} />
      <ChartKey
        series={series}
        hidden={hidden}
        onToggle={(id) =>
          setHidden((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
      />
    </div>
  );
}

/**
 * One row of evidence. Fixed columns so the name, the context, the value and the
 * delta line up down the list instead of drifting with each competitor's name
 * length, and the whole row is a link: a trend you cannot open is a dead end.
 */
function MoveRow({
  competitor,
  tab,
  context,
  value,
  delta,
  shape,
  when,
}: {
  competitor: { id: string; name: string; url?: string | null; color?: string | null };
  tab: "pricing" | "hiring" | "reviews";
  context?: string;
  value: React.ReactNode;
  delta?: React.ReactNode;
  shape?: React.ReactNode;
  when?: string;
}) {
  return (
    <Link
      href={`/dashboard/competitors/${competitor.id}?tab=${tab}`}
      className={cn(
        "grid items-center gap-x-4 gap-y-0.5 border-b border-border px-1 py-2.5 last:border-b-0",
        "grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_9rem_5rem_6rem]",
        "transition-colors hover:bg-surface-2",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      )}
    >
      {/* The competitor's colour vars sit on the wrapper, so the avatar tile and
          the name tint from one declaration (see competitor-color.ts). */}
      <span
        className="col-start-1 row-start-1 flex min-w-0 items-center gap-2"
        style={competitorNameColor(competitor.color)}
      >
        <CompAvatar name={competitor.name} url={competitor.url} size={20} />
        <span className="min-w-0 truncate">
          <span className="text-sm font-medium">{competitor.name}</span>
          {context && (
            <span className="ml-1.5 text-xs text-muted-foreground">{context}</span>
          )}
        </span>
      </span>
      <span className="col-start-2 row-start-1 justify-self-end text-right font-mono text-dense tabular-nums">
        {value}
      </span>
      {shape && (
        <span className="hidden justify-self-end sm:col-start-3 sm:row-start-1 sm:block">
          {shape}
        </span>
      )}
      <span className="col-start-2 row-start-2 justify-self-end text-right sm:col-start-4 sm:row-start-1">
        {delta}
        {when && (
          <span className="ml-2 hidden font-mono text-meta text-muted-foreground sm:inline">
            {when}
          </span>
        )}
      </span>
    </Link>
  );
}

function Delta({ value, suffix = "", invert }: { value: number; suffix?: string; invert?: boolean }) {
  if (value === 0) {
    return <span className="font-mono text-dense text-muted-foreground tabular-nums">flat</span>;
  }
  // A competitor raising a price or opening roles is pressure on you, so "up" is
  // warm here, not green. Reviews invert: their score falling is your opening.
  const rising = value > 0;
  const tone = invert
    ? rising
      ? "text-positive"
      : "text-critical"
    : rising
      ? "text-high"
      : "text-positive";
  return (
    <span className={cn("font-mono text-dense tabular-nums", tone)}>
      {rising ? "+" : ""}
      {value}
      {suffix}
    </span>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-sm text-muted-foreground">{children}</p>;
}

/* -------------------------------------------------------------------------- */
/* View                                                                        */
/* -------------------------------------------------------------------------- */

export function TrendsView() {
  const [range, setRange] = useState<DateRange>(() => lastNDays(90));
  // patch-28 — active product scope (cookie-backed switcher, URL ?product= overrides).
  const productId = useProductScope() ?? undefined;
  // Server-seeded for the default 90d window (trends/page.tsx); the queryKey embeds
  // from/to (+ product), so changing the range or product refetches automatically.
  const summaryQ = useQuery(trendsSummaryQuery(range, productId));
  const marketQ = useQuery(trendsMarketQuery(range, productId));
  const summary = summaryQ.data ?? null;
  const market = marketQ.data ?? null;

  const reading = useMemo(() => {
    if (!summary) return null;
    const pricing = readPricing(summary.pricing);
    const hiring = readHiring(summary.hiring);
    const reviews = readReviews(summary.reviews);
    const tech = readTech(summary.tech);
    return { pricing, hiring, reviews, tech, market: readMarket(pricing, hiring, reviews, tech) };
  }, [summary]);

  // Competitor identity (favicon + assigned colour) only travels on the market
  // series, so the leaderboard rows borrow it from there rather than making the
  // summary route carry the same two columns twice.
  const identity = useMemo(() => {
    const map = new Map<string, { url: string | null; color: string | null }>();
    for (const list of [market?.pricing, market?.hiring, market?.reviews]) {
      for (const item of list ?? []) {
        if (!map.has(item.competitorId)) {
          map.set(item.competitorId, { url: item.competitorUrl, color: item.color });
        }
      }
    }
    return map;
  }, [market]);

  // Per-competitor hiring shape, so a row can carry the trajectory that produced
  // its net rather than only the endpoints.
  const hiringShapes = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const item of market?.hiring ?? []) {
      map.set(item.competitorId, item.points.map((p) => p.value));
    }
    return map;
  }, [market]);

  const competitorCount = useMemo(() => {
    if (!summary) return 0;
    const ids = new Set<string>();
    for (const m of summary.pricing) ids.add(m.competitorId);
    for (const m of summary.hiring) ids.add(m.competitorId);
    for (const m of summary.reviews) ids.add(m.competitorId);
    for (const m of summary.tech) ids.add(m.competitorId);
    return ids.size;
  }, [summary]);

  if (summaryQ.isError) {
    return <p className="text-muted-foreground text-sm">Couldn&apos;t load trends right now.</p>;
  }

  const allEmpty =
    summary !== null &&
    summary.pricing.length === 0 &&
    summary.hiring.length === 0 &&
    summary.reviews.length === 0 &&
    summary.tech.length === 0;

  const rangeLabel = `${shortDate(range.from.toISOString())} to ${shortDate(range.to.toISOString())}`;

  return (
    <div className="flex flex-col gap-7">
      <PageHead
        flush
        title="Trends"
        sub="What the market did while you were working."
        actions={<DateRangePicker value={range} onChange={setRange} presets={TRENDS_PRESETS} />}
      />

      {summary === null || reading === null ? (
        <TrendsSkeleton />
      ) : summary.degraded && allEmpty ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-14 text-center text-muted-foreground">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background">
            <LineChartIcon size={16} className="text-muted-foreground" aria-hidden />
          </div>
          <div className="mb-1.5 text-base font-semibold tracking-tight text-foreground">
            Trends temporarily unavailable
          </div>
          <div className="mx-auto max-w-[400px] text-sm">
            We couldn&apos;t read the trend data just now. This is usually brief. Refresh in a
            moment.
          </div>
        </div>
      ) : allEmpty ? (
        <EmptyState
          icon={LineChartIcon}
          title="No trends yet"
          description="Pricing, hiring, review and tech history build up over the next few scrapes."
        />
      ) : (
        <>
          {/* The reading, before the evidence. */}
          <div className="grid overflow-hidden rounded-lg border border-border-strong bg-card lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="flex min-w-0 flex-col gap-2 px-5 py-4">
              <div className="font-mono text-meta text-muted-foreground">
                {rangeLabel} · {competitorCount} {plural(competitorCount, "competitor")}
              </div>
              <h2 className="m-0 max-w-[42ch] text-lead font-medium leading-snug tracking-tight text-pretty lg:text-xl">
                {reading.market.headline}
              </h2>
              <p className="m-0 max-w-[64ch] text-sm text-muted-foreground">
                {reading.market.detail}
              </p>
            </div>
            <div className="flex flex-col border-border bg-background-2 max-lg:flex-row max-lg:border-t max-sm:flex-col lg:border-l">
              <RailStat
                label="Price moves"
                value={String(reading.pricing.raised.length + reading.pricing.cut.length)}
                tone={
                  reading.pricing.raised.length > reading.pricing.cut.length ? "up" : undefined
                }
              >
                {reading.pricing.raised.length} up, {reading.pricing.cut.length} down
              </RailStat>
              <RailStat
                label="Net open roles"
                value={`${reading.hiring.net > 0 ? "+" : ""}${reading.hiring.net}`}
                tone={reading.hiring.net > 0 ? "up" : reading.hiring.net < 0 ? "down" : undefined}
              >
                {reading.hiring.scaling.length} scaling, {reading.hiring.slowing.length} slowing
              </RailStat>
              <RailStat
                label="Review scores moved"
                value={String(reading.reviews.moved.length)}
                tone={reading.reviews.falling.length > 0 ? "down" : undefined}
              >
                {reading.reviews.falling.length > 0
                  ? `${reading.reviews.falling.length} falling`
                  : "none falling"}
              </RailStat>
            </div>
          </div>

          {/* Pricing ---------------------------------------------------------- */}
          <Movement
            title="Pricing"
            verdict={
              reading.pricing.raised.length + reading.pricing.cut.length === 0
                ? "No captured plan changed price in this window."
                : `${reading.pricing.raised.length} ${plural(reading.pricing.raised.length, "plan")} went up, ${reading.pricing.cut.length} came down.${
                    reading.pricing.top && reading.pricing.top.pct !== 0
                      ? ` ${reading.pricing.top.move.competitorName} moved furthest.`
                      : ""
                  }`
            }
            meta={
              (market?.pricing.length ?? 0) > 0
                ? `entry price, indexed to ${shortDate(range.from.toISOString())}`
                : undefined
            }
          >
            {market && market.pricing.length > 0 && (
              <MarketPlot
                series={market.pricing}
                mode="index"
                formatValue={(v, item) => money(v, item.unit)}
              />
            )}
            {reading.pricing.ranked.length === 0 ? (
              <Quiet>
                {market && market.pricing.length > 0
                  ? "Prices held steady everywhere we watch."
                  : "No pricing captured yet. It builds up over the next few scrapes."}
              </Quiet>
            ) : (
              <div>
                {reading.pricing.ranked.slice(0, 10).map(({ move, pct }, i) => (
                  <MoveRow
                    key={`${move.competitorId}-${move.planName}-${i}`}
                    competitor={{
                      id: move.competitorId,
                      name: move.competitorName,
                      ...identity.get(move.competitorId),
                    }}
                    tab="pricing"
                    context={move.planName}
                    value={
                      <>
                        {move.prevPrice !== null && (
                          <span className="text-muted-foreground">
                            {money(move.prevPrice, move.currency)} &rarr;{" "}
                          </span>
                        )}
                        {money(move.price, move.currency)}
                      </>
                    }
                    delta={<Delta value={pct} suffix="%" />}
                    when={shortDate(move.recordedAt)}
                  />
                ))}
              </div>
            )}
          </Movement>

          {/* Hiring ----------------------------------------------------------- */}
          <Movement
            title="Hiring"
            verdict={
              reading.hiring.net === 0
                ? reading.hiring.ranked.length === 0
                  ? "No job board captured in this window."
                  : "Boards held steady across the set."
                : `The set ${reading.hiring.net > 0 ? "opened" : "closed"} ${Math.abs(reading.hiring.net)} ${plural(Math.abs(reading.hiring.net), "role")}.${
                    reading.hiring.driver
                      ? ` ${reading.hiring.driver.competitorName} moved most.`
                      : ""
                  }`
            }
            meta={
              (market?.hiring.length ?? 0) > 0
                ? `open roles, indexed to ${shortDate(range.from.toISOString())}`
                : undefined
            }
          >
            {market && market.hiring.length > 0 && (
              <MarketPlot
                series={market.hiring}
                mode="index"
                formatValue={(v) => `${Math.round(v)} open`}
              />
            )}
            {reading.hiring.ranked.length === 0 ? (
              <Quiet>
                No hiring captured yet. Enable the jobs source on a competitor to start it.
              </Quiet>
            ) : (
              <div>
                {reading.hiring.ranked.slice(0, 10).map((move) => {
                  const shape = hiringShapes.get(move.competitorId) ?? [];
                  return (
                    <MoveRow
                      key={move.competitorId}
                      competitor={{
                        id: move.competitorId,
                        name: move.competitorName,
                        ...identity.get(move.competitorId),
                      }}
                      tab="hiring"
                      value={
                        <>
                          {move.latest}
                          <span className="text-muted-foreground"> open</span>
                        </>
                      }
                      shape={
                        shape.length >= 2 ? (
                          <Sparkline
                            data={shape}
                            w={72}
                            h={22}
                            color="var(--link)"
                            fill
                            valueLabel="roles"
                          />
                        ) : null
                      }
                      delta={<Delta value={move.net} />}
                    />
                  );
                })}
              </div>
            )}
          </Movement>

          {/* Reviews ---------------------------------------------------------- */}
          <Movement
            title="Reviews"
            verdict={
              reading.reviews.drifted.length === 0
                ? "No review score captured in this window."
                : reading.reviews.moved.length === 0
                  ? "Every score we track held within a tenth of a point."
                  : `${reading.reviews.moved.length} ${plural(reading.reviews.moved.length, "score")} shifted.${
                      reading.reviews.worst
                        ? ` ${reading.reviews.worst.move.competitorName} slipped furthest, an opening for you.`
                        : ""
                    }`
            }
            meta={(market?.reviews.length ?? 0) > 0 ? "mean score out of 5" : undefined}
          >
            {market && market.reviews.length > 0 && (
              <MarketPlot
                series={market.reviews}
                mode="absolute"
                formatValue={(v) => v.toFixed(2)}
                height={180}
              />
            )}
            {reading.reviews.drifted.length === 0 ? (
              <Quiet>
                No review scores yet. Add a review source on a competitor to track them.
              </Quiet>
            ) : (
              <div>
                {reading.reviews.drifted.slice(0, 10).map(({ move, drift }, i) => (
                  <MoveRow
                    key={`${move.competitorId}-${move.source}-${i}`}
                    competitor={{
                      id: move.competitorId,
                      name: move.competitorName,
                      ...identity.get(move.competitorId),
                    }}
                    tab="reviews"
                    context={move.source}
                    value={
                      <>
                        {move.score.toFixed(1)}
                        <span className="text-muted-foreground">
                          /5 · {move.reviewCount}
                        </span>
                      </>
                    }
                    delta={
                      drift === null ? (
                        <span className="font-mono text-dense text-muted-foreground">
                          first read
                        </span>
                      ) : (
                        <span
                          className={cn(
                            "font-mono text-dense tabular-nums",
                            drift === 0
                              ? "text-muted-foreground"
                              : drift > 0
                                ? "text-critical"
                                : "text-positive",
                          )}
                        >
                          {drift === 0
                            ? "flat"
                            : `${drift > 0 ? "+" : ""}${drift.toFixed(1)}`}
                        </span>
                      )
                    }
                  />
                ))}
              </div>
            )}
          </Movement>

          {/* Tech ------------------------------------------------------------- */}
          {reading.tech.ranked.length > 0 && (
            <Movement
              title="Tech"
              verdict={`${reading.tech.added.length} ${plural(reading.tech.added.length, "tool")} adopted, ${reading.tech.dropped.length} dropped.`}
              meta="detected on their pages"
            >
              <div>
                {reading.tech.ranked.slice(0, 12).map((group) => (
                  <div
                    key={`${group.techId}-${group.event}`}
                    className="flex items-baseline justify-between gap-4 border-b border-border py-2.5 last:border-b-0"
                  >
                    <span className="min-w-0">
                      <span className="text-sm font-medium capitalize">{group.techId}</span>
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {group.event === "appeared" ? "adopted by" : "dropped by"}{" "}
                        {group.names.slice(0, 3).join(", ")}
                        {group.names.length > 3 && ` and ${group.names.length - 3} more`}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-meta text-muted-foreground">
                      {shortDate(group.at)}
                    </span>
                  </div>
                ))}
              </div>
            </Movement>
          )}
        </>
      )}
    </div>
  );
}

function TrendsSkeleton() {
  return (
    <div className="flex flex-col gap-7" aria-busy="true">
      <Skeleton className="h-[148px] w-full rounded-lg" />
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <Skeleton className="h-12 w-72" />
          <Skeleton className="h-[200px] w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ))}
    </div>
  );
}
