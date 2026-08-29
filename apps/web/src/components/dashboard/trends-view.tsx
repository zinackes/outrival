"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChartLineIcon, DownloadSimpleIcon } from "@/components/icons";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import { EmptyState } from "./empty-state";
import { ListError, PartialError } from "@/components/outrival/list-error";
import { Button } from "@/components/ui/button";
import {
  type TrendsMarketSeries,
  type PricingMove,
  type HiringMove,
  type ReviewMove,
  type TechMove,
} from "@/lib/api";
import { trendsSummaryQuery, trendsMarketQuery } from "@/lib/queries";
import { toCsv, downloadCsv } from "@/lib/csv";
import {
  toTrendsRows,
  trendsCsvFilename,
  TRENDS_CSV_COLUMNS,
} from "./trends-export";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { competitorNameColor } from "@/lib/competitor-color";
import { buildSeriesPalette, paintFor, type SeriesPaint } from "@/lib/series-color";
import { Skeleton } from "@/components/ui/skeleton";
import { CompAvatar } from "./comp-avatar";
import { FilterChip } from "./filter-chip";
import { SeriesSwatch } from "./series-swatch";
import {
  TrendsCompetitorFilter,
  type TrendsRosterEntry,
} from "./trends-competitor-filter";
import { Sparkline } from "./sparkline";
// Plain SVG, no recharts: imported directly so the page's first chart doesn't
// arrive behind a skeleton the way the lazy market chart has to.
import { TrendsSlopeChart } from "./trends-slope-chart";
// Arithmetic only, no recharts — safe to pull in statically beside the lazy chart.
import { endValue, orderByEnd } from "./trends-chart-model";
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

export interface MoverMark {
  value: string;
  tone: "neutral" | "pressure" | "opening";
}
export interface Mover {
  competitorId: string;
  competitorName: string;
  marks: MoverMark[];
  score: number;
}

/**
 * Who is behind the headline.
 *
 * "3 competitors raised prices" is the reading, but the next question is always
 * which three, and the answer was three sections down. This collapses every
 * movement in the window to one entry per competitor, ranked by how far they
 * moved, so the card states the names as well as the count.
 *
 * The weights put a 20% price move, a dozen roles and four tenths of a review
 * point in the same order of magnitude, which is roughly how an analyst reads them.
 */
function readMovers(
  pricing: ReturnType<typeof readPricing>,
  hiring: ReturnType<typeof readHiring>,
  reviews: ReturnType<typeof readReviews>,
): Mover[] {
  const movers = new Map<string, Mover>();
  const entry = (competitorId: string, competitorName: string) => {
    const existing = movers.get(competitorId);
    if (existing) return existing;
    const fresh: Mover = { competitorId, competitorName, marks: [], score: 0 };
    movers.set(competitorId, fresh);
    return fresh;
  };

  // A competitor's biggest relative price move, not each of its plans: a chip is a
  // summary, and four plan rows for one company is what the sections are for.
  const biggestPrice = new Map<string, { pct: number; name: string }>();
  for (const { move, pct } of pricing.ranked) {
    const current = biggestPrice.get(move.competitorId);
    if (!current || Math.abs(pct) > Math.abs(current.pct)) {
      biggestPrice.set(move.competitorId, { pct, name: move.competitorName });
    }
  }
  for (const [competitorId, { pct, name }] of biggestPrice) {
    if (pct === 0) continue;
    const mover = entry(competitorId, name);
    // Whether their price moving helps or hurts depends on how you are positioned,
    // so the page states the fact and declines to score it.
    mover.marks.push({ value: `${pct > 0 ? "+" : ""}${pct}% price`, tone: "neutral" });
    mover.score += Math.abs(pct);
  }

  for (const move of hiring.ranked) {
    if (move.net === 0) continue;
    const mover = entry(move.competitorId, move.competitorName);
    mover.marks.push({
      value: `${move.net > 0 ? "+" : ""}${move.net} ${plural(Math.abs(move.net), "role")}`,
      tone: move.net > 0 ? "pressure" : "opening",
    });
    mover.score += Math.abs(move.net) * 2;
  }

  for (const { move, drift } of reviews.moved) {
    if (drift === null) continue;
    const mover = entry(move.competitorId, move.competitorName);
    mover.marks.push({
      value: `${drift > 0 ? "+" : ""}${drift.toFixed(1)} rating`,
      tone: drift > 0 ? "pressure" : "opening",
    });
    mover.score += Math.abs(drift) * 50;
  }

  return [...movers.values()].sort((a, b) => b.score - a.score);
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
          "text-xl font-semibold leading-none tracking-tight tabular-nums",
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
 * One competitor that moved, and how far. Sits under the headline so the card
 * names the companies it is counting, and opens onto the one that matters.
 */
function MoverChip({
  mover,
  identity,
}: {
  mover: Mover;
  identity?: { url: string | null; color: string | null };
}) {
  return (
    <Link
      href={`/dashboard/competitors/${mover.competitorId}`}
      style={competitorNameColor(identity?.color)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border border-border bg-background-2 py-1 pl-1 pr-2",
        "transition-colors hover:bg-surface-2",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <CompAvatar name={mover.competitorName} url={identity?.url} size={18} />
      <span className="text-xs font-medium">{mover.competitorName}</span>
      {mover.marks.slice(0, 2).map((mark) => (
        <span
          key={mark.value}
          className={cn(
            "text-meta tabular-nums",
            mark.tone === "pressure" && "text-high",
            mark.tone === "opening" && "text-positive",
            mark.tone === "neutral" && "text-muted-foreground",
          )}
        >
          {mark.value}
        </span>
      ))}
    </Link>
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

/** Past this many entries the key scrolls rather than pushing the page down. */
const KEY_SCROLL_AFTER = 12;

/**
 * The chart's key, and its filter. Clicking a competitor drops its line, so eight
 * overlapping series can be read two at a time without leaving the page.
 *
 * A switched-off entry stays in place at reduced opacity rather than disappearing:
 * it is how you switch it back on, and a control that vanishes when used sends the
 * reader to the toolbar for something they were already holding.
 *
 * The order is the caller's, and is meant to be the plot's own: entries arrive
 * ranked by where their lines end, so the key reads top-to-bottom against the right
 * edge of the chart instead of asking the reader to resolve a hue. `note` carries
 * the value that ranking is by — without it the order looks arbitrary and buys
 * nothing.
 */
function ChartKey({
  series,
  hidden,
  paint,
  note,
  onToggle,
  onHighlight,
}: {
  series: TrendsMarketSeries[];
  hidden: Set<string>;
  paint: Map<string, SeriesPaint>;
  note?: Map<string, string>;
  onToggle: (id: string) => void;
  onHighlight: (id: string | null) => void;
}) {
  if (series.length < 2) return null;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5",
        // Nothing caps the roster, and thirty legend chips push the next section off
        // the screen entirely.
        series.length > KEY_SCROLL_AFTER && "max-h-[4.75rem] overflow-y-auto",
      )}
    >
      {series.map((item) => {
        const off = hidden.has(item.competitorId);
        const ranked = note?.get(item.competitorId);
        return (
          <button
            key={item.competitorId}
            type="button"
            onClick={() => onToggle(item.competitorId)}
            // Pointing at a key entry traces its line on the chart. Keyboard focus
            // does the same, so the highlight is not mouse-only.
            onMouseEnter={() => onHighlight(off ? null : item.competitorId)}
            onMouseLeave={() => onHighlight(null)}
            onFocus={() => onHighlight(off ? null : item.competitorId)}
            onBlur={() => onHighlight(null)}
            aria-pressed={!off}
            // aria-pressed alone announces "pressed" against a label that is only a
            // company name, which never says what is being pressed.
            aria-label={`${item.competitorName}, ${off ? "hidden" : "shown"}`}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-xs transition-opacity",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              off ? "opacity-40" : "hover:opacity-70",
            )}
          >
            <CompAvatar name={item.competitorName} url={item.competitorUrl} size={14} />
            <SeriesSwatch paint={paintFor(paint, item.competitorId)} />
            <span className={cn(item.isSelf && "font-medium")}>
              {item.competitorName}
              {item.isSelf && <span className="text-muted-foreground"> (you)</span>}
            </span>
            {ranked && (
              <span className="tabular-nums text-muted-foreground">{ranked}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A market chart plus its key. The hidden set is the page's, not the chart's: the
 * same competitor is off on every plot and out of every count.
 */
function MarketPlot({
  series,
  mode,
  formatValue,
  height,
  paint,
  hidden,
  onToggle,
}: {
  series: TrendsMarketSeries[];
  mode: "index" | "absolute";
  formatValue: (value: number, item: TrendsMarketSeries) => string;
  height?: number;
  paint: Map<string, SeriesPaint>;
  hidden: Set<string>;
  onToggle: (id: string) => void;
}) {
  // Transient, so it stays local: pointing at a line is not choosing one.
  const [highlighted, setHighlighted] = useState<string | null>(null);
  // The key is ranked by the chart's right edge, and says what by. In index mode
  // that is the percent the line travelled — the height it actually ends at — not
  // the raw reading, which is a different ordering and would rank the key against
  // a plot it does not describe.
  const { ordered, note } = useMemo(() => {
    const ranked = orderByEnd(series, mode, hidden);
    const labels = new Map<string, string>();
    for (const item of ranked) {
      const end = endValue(item, mode);
      if (end === null) continue;
      labels.set(
        item.competitorId,
        mode === "index"
          ? `${end > 0 ? "+" : ""}${Number.isInteger(end) ? end : end.toFixed(1)}%`
          : formatValue(end, item),
      );
    }
    return { ordered: ranked, note: labels };
  }, [series, mode, hidden, formatValue]);
  if (series.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <MarketChart
        series={series}
        mode={mode}
        formatValue={formatValue}
        paint={paint}
        hidden={hidden}
        highlighted={highlighted}
        height={height}
      />
      <ChartKey
        series={ordered}
        hidden={hidden}
        paint={paint}
        note={note}
        onHighlight={setHighlighted}
        onToggle={onToggle}
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
      <span className="col-start-2 row-start-1 justify-self-end text-right text-dense tabular-nums">
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
          <span className="ml-2 hidden text-meta tabular-nums text-muted-foreground sm:inline">
            {when}
          </span>
        )}
      </span>
    </Link>
  );
}

function Delta({
  value,
  suffix = "",
  // Whether a competitor's price moving helps or hurts depends on how you are
  // positioned, so pricing states the number and declines to score it. Hiring does
  // carry a reading: them opening roles is pressure, them closing roles is not.
  neutral,
}: {
  value: number;
  suffix?: string;
  neutral?: boolean;
}) {
  if (value === 0) {
    return <span className="text-dense text-muted-foreground tabular-nums">flat</span>;
  }
  const rising = value > 0;
  return (
    <span
      className={cn(
        "text-dense tabular-nums",
        neutral ? "text-foreground" : rising ? "text-high" : "text-positive",
      )}
    >
      {rising ? "+" : ""}
      {value}
      {suffix}
    </span>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-sm text-muted-foreground">{children}</p>;
}

function parseSet(s: string | null): Set<string> {
  if (!s) return new Set();
  return new Set(s.split(",").filter(Boolean));
}

/* -------------------------------------------------------------------------- */
/* View                                                                        */
/* -------------------------------------------------------------------------- */

export function TrendsView() {
  const [range, setRange] = useState<DateRange>(() => lastNDays(90));
  // patch-28 — active product scope (cookie-backed switcher, URL ?product= overrides).
  const productId = useProductScope() ?? undefined;
  const searchParams = useSearchParams();
  // Excluded, not included: a stale id from a shared link or a swapped product scope
  // then matches nobody and the page shows everything, where an include list would
  // resolve to nothing and blank the report. Seeded once — the URL is a mirror of
  // this state from here on, not its source.
  const [hidden, setHidden] = useState<Set<string>>(() => parseSet(searchParams.get("hide")));

  // Mirrored with the NATIVE history API, never router.replace: this route's Server
  // Component awaits searchParams, so a router.replace would re-run getTrendsData +
  // getTrendsMarketData and re-hydrate the cache on every checkbox tick, for a filter
  // that never leaves the client. Same reason as signals-view.tsx.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (hidden.size > 0) url.searchParams.set("hide", Array.from(hidden).join(","));
    else url.searchParams.delete("hide");
    window.history.replaceState(window.history.state, "", url.toString());
  }, [hidden]);

  const toggleHidden = useCallback((competitorId: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(competitorId)) next.delete(competitorId);
      else next.add(competitorId);
      return next;
    });
  }, []);
  const showAll = useCallback(() => setHidden(new Set()), []);

  // Server-seeded for the default 90d window (trends/page.tsx); the queryKey embeds
  // from/to (+ product), so changing the range or product refetches automatically.
  const summaryQ = useQuery(trendsSummaryQuery(range, productId));
  const marketQ = useQuery(trendsMarketQuery(range, productId));
  const summary = summaryQ.data ?? null;
  const market = marketQ.data ?? null;

  // The filter is applied HERE, at the source, so the headline, the rail stats, the
  // mover chips and every movement list follow the same set as the charts. A page
  // whose chart drops a competitor while its counters still add them up is two
  // different reports on one screen.
  const visibleSummary = useMemo(() => {
    if (!summary) return null;
    if (hidden.size === 0) return summary;
    const keep = <T extends { competitorId: string }>(rows: T[]) =>
      rows.filter((row) => !hidden.has(row.competitorId));
    return {
      ...summary,
      pricing: keep(summary.pricing),
      hiring: keep(summary.hiring),
      reviews: keep(summary.reviews),
      tech: keep(summary.tech),
    };
  }, [summary, hidden]);

  // The charts, by contrast, keep the FULL series and take `hidden` as a prop: their
  // keys have to keep drawing a switched-off entry, in place, because that entry is
  // how it gets switched back on.

  const reading = useMemo(() => {
    if (!visibleSummary) return null;
    const pricing = readPricing(visibleSummary.pricing);
    const hiring = readHiring(visibleSummary.hiring);
    const reviews = readReviews(visibleSummary.reviews);
    const tech = readTech(visibleSummary.tech);
    return {
      pricing,
      hiring,
      reviews,
      tech,
      movers: readMovers(pricing, hiring, reviews),
      market: readMarket(pricing, hiring, reviews, tech),
    };
  }, [visibleSummary]);

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

  /**
   * Everyone the page could plot, taken from BOTH routes.
   *
   * /market and /summary are different queries with different limits, and a
   * competitor can appear in one without the other — a tech adoption carries no
   * market series at all. A roster built from the charts alone would leave those
   * competitors unfilterable and their movement rows unswatched.
   */
  const roster = useMemo<TrendsRosterEntry[]>(() => {
    const map = new Map<string, TrendsRosterEntry>();
    for (const list of [market?.pricing, market?.hiring, market?.reviews]) {
      for (const item of list ?? []) {
        if (map.has(item.competitorId)) continue;
        map.set(item.competitorId, {
          competitorId: item.competitorId,
          competitorName: item.competitorName,
          competitorUrl: item.competitorUrl,
          color: item.color,
          isSelf: item.isSelf,
        });
      }
    }
    for (const list of [summary?.pricing, summary?.hiring, summary?.reviews, summary?.tech]) {
      for (const move of list ?? []) {
        if (map.has(move.competitorId)) continue;
        map.set(move.competitorId, {
          competitorId: move.competitorId,
          competitorName: move.competitorName,
          competitorUrl: null,
          color: null,
          isSelf: false,
        });
      }
    }
    return [...map.values()];
  }, [market, summary]);

  // Dealt once, off the full roster, and handed to all three charts: a competitor's
  // colour is its identity, so it cannot depend on which chart is drawing it or on
  // who is currently switched off.
  const paint = useMemo(() => buildSeriesPalette(roster), [roster]);

  const competitorCount = useMemo(() => {
    if (!visibleSummary) return 0;
    const ids = new Set<string>();
    for (const m of visibleSummary.pricing) ids.add(m.competitorId);
    for (const m of visibleSummary.hiring) ids.add(m.competitorId);
    for (const m of visibleSummary.reviews) ids.add(m.competitorId);
    for (const m of visibleSummary.tech) ids.add(m.competitorId);
    return ids.size;
  }, [visibleSummary]);

  // Built off `visibleSummary` for the same reason every other derived number on
  // this page is: a file that quietly re-adds a competitor the reader unticked is a
  // different report under the same filename.
  const exportRows = useMemo(
    () => (visibleSummary ? toTrendsRows(visibleSummary) : []),
    [visibleSummary],
  );

  function exportCsv() {
    if (exportRows.length === 0) return;
    downloadCsv(
      trendsCsvFilename(range.from, range.to),
      toCsv(exportRows, TRENDS_CSV_COLUMNS),
    );
  }

  // OUT-190 — this used to be a bare sentence: the page it replaced had a date
  // range and a competitor filter, and neither survives a re-navigation, so the
  // only way out was a full reload. Same panel and same copy as every other list.
  if (summaryQ.isError) {
    return <ListError error={summaryQ.error} onRetry={() => void summaryQ.refetch()} />;
  }

  const allEmpty =
    summary !== null &&
    summary.pricing.length === 0 &&
    summary.hiring.length === 0 &&
    summary.reviews.length === 0 &&
    summary.tech.length === 0;

  const rangeLabel = `${shortDate(range.from.toISOString())} to ${shortDate(range.to.toISOString())}`;
  // Reachable in one gesture (untick everyone), and every section would otherwise
  // report on an empty set in the present tense: "prices held steady everywhere we
  // watch" is a claim, not a blank.
  const allHidden = roster.length > 0 && roster.every((r) => hidden.has(r.competitorId));
  const excluded = roster.filter((r) => hidden.has(r.competitorId));

  return (
    <div className="flex flex-col gap-7">
      <PageHead
        flush
        title="Trends"
        sub="What the market did while you were working."
        actions={
          <>
            <TrendsCompetitorFilter
              roster={roster}
              hidden={hidden}
              paint={paint}
              onToggle={toggleHidden}
              onShowAll={showAll}
            />
            <DateRangePicker value={range} onChange={setRange} presets={TRENDS_PRESETS} />
            <Button
              variant="outline"
              size="sm"
              onClick={exportCsv}
              disabled={exportRows.length === 0}
            >
              <DownloadSimpleIcon size={16} /> Export
            </Button>
          </>
        }
      />

      {/* A menu the reader closed still governs the page, so what it excluded stays
          named on screen. */}
      {excluded.length > 0 && (
        <div className="-mt-4 flex flex-wrap items-center gap-1.5">
          {excluded.map((entry) => (
            <FilterChip
              key={entry.competitorId}
              onRemove={() => toggleHidden(entry.competitorId)}
            >
              <CompAvatar name={entry.competitorName} url={entry.competitorUrl} size={14} />
              <span className="text-muted-foreground line-through">
                {entry.competitorName}
              </span>
            </FilterChip>
          ))}
          <button
            onClick={showAll}
            className="px-1 text-dense text-muted-foreground transition-colors hover:text-foreground"
          >
            Show all
          </button>
        </div>
      )}

      {/* /market is a second query, and it carries the charts, the swatches and the
          hiring shapes. When only it fails the page still reads — in prose, with
          every chart silently gone. Say which half is missing, and offer it back. */}
      {marketQ.isError && summary !== null && (
        <PartialError
          title="The charts didn't load"
          error={marketQ.error}
          onRetry={() => void marketQ.refetch()}
        />
      )}

      {/* `degraded` means the summary route fell back: it answered, on less than the
          full history. The page only ever reacted to it when the window came back
          completely empty, so the partial case — some dimensions read, others
          dropped — rendered as a finished report of a quiet market. Every "held
          steady" below it was then a claim about data that was never read. */}
      {summary?.degraded && !allEmpty && (
        <PartialError
          title="This report is missing part of its data"
          description="Some of the trend history couldn't be read for this window, so a dimension may look quieter than it was. Reloading usually fills it in."
          onRetry={() => void summaryQ.refetch()}
        />
      )}

      {summary === null || reading === null ? (
        <TrendsSkeleton />
      ) : summary.degraded && allEmpty ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-14 text-center text-muted-foreground">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background">
            <ChartLineIcon size={16} className="text-muted-foreground" aria-hidden />
          </div>
          <div className="mb-1.5 text-base font-semibold tracking-tight text-foreground">
            Trends temporarily unavailable
          </div>
          <div className="mx-auto mb-4 max-w-[400px] text-sm">
            We couldn&apos;t read the trend data just now. This is usually brief.
          </div>
          {/* It told the reader to refresh, which throws away the range and the
              competitor filter. Refetching keeps both. */}
          <Button onClick={() => void summaryQ.refetch()} disabled={summaryQ.isFetching}>
            {summaryQ.isFetching ? "Trying…" : "Try again"}
          </Button>
        </div>
      ) : allEmpty ? (
        <EmptyState
          icon={ChartLineIcon}
          title="No trends yet"
          description="Pricing, hiring, review and tech history build up over the next few scrapes."
        />
      ) : allHidden ? (
        <EmptyState
          icon={ChartLineIcon}
          title="Every competitor is hidden"
          description="Bring one back from the Competitors menu to read the window again."
        />
      ) : (
        <>
          {/* The reading, before the evidence. */}
          <div className="grid overflow-hidden rounded-lg border border-border-strong bg-card lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="flex min-w-0 flex-col gap-2 px-5 py-4">
              {/* Announced: ticking one checkbox silently rewrites the headline,
                  three stats and every list under them. */}
              <div className="text-meta text-muted-foreground tabular-nums" aria-live="polite">
                {rangeLabel} ·{" "}
                {hidden.size > 0
                  ? `${competitorCount} of ${roster.length} competitors`
                  : `${competitorCount} ${plural(competitorCount, "competitor")}`}
              </div>
              <h2 className="m-0 max-w-[42ch] text-lead font-medium leading-snug tracking-tight text-pretty lg:text-xl">
                {reading.market.headline}
              </h2>
              <p className="m-0 max-w-[64ch] text-sm text-muted-foreground">
                {reading.market.detail}
              </p>

              {reading.movers.length > 0 && (
                <div className="mt-1 flex flex-col gap-2 border-t border-dashed border-border pt-3">
                  <span className="text-xs text-muted-foreground">Who moved</span>
                  <div className="flex flex-wrap gap-x-2 gap-y-1.5">
                    {reading.movers.slice(0, 6).map((mover) => (
                      <MoverChip
                        key={mover.competitorId}
                        mover={mover}
                        identity={identity.get(mover.competitorId)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex flex-col border-border bg-background-2 max-lg:flex-row max-lg:border-t max-sm:flex-col lg:border-l">
              <RailStat
                label="Price moves"
                value={String(reading.pricing.raised.length + reading.pricing.cut.length)}
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
                ? "entry price, first vs last capture"
                : undefined
            }
          >
            {market && market.pricing.length > 0 && (
              <TrendsSlopeChart
                series={market.pricing}
                formatValue={(v, item) => money(v, item.unit)}
                paint={paint}
                hidden={hidden}
                onToggle={toggleHidden}
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
                    delta={<Delta value={pct} suffix="%" neutral />}
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
            // Each line is indexed to its OWN first capture, not to the window
            // start: a competitor first scraped three weeks in has no reading on
            // day one, and claiming the window start as its baseline dated a
            // number we never took.
            meta={
              (market?.hiring.length ?? 0) > 0
                ? "open roles, % from each competitor's first capture"
                : undefined
            }
          >
            {market && market.hiring.length > 0 && (
              <MarketPlot
                series={market.hiring}
                mode="index"
                formatValue={(v) => `${Math.round(v)} open`}
                paint={paint}
                hidden={hidden}
                onToggle={toggleHidden}
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
                            // The row's own colour, so the shape beside a name
                            // matches the line that name owns on the chart above.
                            color={paintFor(paint, move.competitorId).stroke}
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
                paint={paint}
                hidden={hidden}
                onToggle={toggleHidden}
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
                        <span className="text-dense text-muted-foreground">
                          first read
                        </span>
                      ) : (
                        <span
                          className={cn(
                            "text-dense tabular-nums",
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
                    <span className="shrink-0 text-meta text-muted-foreground tabular-nums">
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
