"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
} from "recharts";
import type { TrendsMarketSeries } from "@/lib/api";
import {
  ChartCursorLine,
  chartTooltipCardMotion,
  chartTooltipMotion,
} from "@/components/dashboard/chart-motion";
import { formatDate } from "@/lib/format-date";
import { seriesStroke } from "@/lib/series-color";
import {
  asOfKey,
  buildCarriedGrid,
  rawKey,
  type ChartRow,
} from "@/components/dashboard/trends-chart-model";

/**
 * Every competitor on one axis.
 *
 * The page used to hide its only chart behind a competitor picker and a metric
 * toggle, which meant a competitive-intelligence product could show exactly one
 * company's line at a time. Plotting them together needs a shared axis, and
 * absolute prices don't have one ($9 next to $499 flattens the cheap lines into
 * the floor), so `index` mode plots each competitor's percent change from its own
 * first capture in the window: the zero line is "unchanged", and the question the
 * page exists to answer ("who moved, and how far") is the one the chart shows.
 * Reviews stay `absolute` — 0 to 5 is already a shared scale, and a drop from 4.6
 * to 4.3 has to read as a drop, not as -6.5%.
 *
 * Three properties make the plot readable, and each fixes a way the earlier
 * version misreported the data:
 *
 * 1. **Every series carries a value at every x.** Competitors are scraped on
 *    staggered days, so a row only ever held the one or two that reported that
 *    day. `connectNulls` drew the bridge, but the tooltip filters on the payload,
 *    so hovering a plot of twelve lines named ONE of them. Each series is now
 *    carried forward from its last observation, which is what the bridged line
 *    already claimed on screen: a price holds until we see it change. The carried
 *    reading states the date it was actually taken, so "unchanged" is never
 *    confused with "re-measured".
 * 2. **The x axis is time, not a category list.** With string categories, 27 days
 *    between two captures rendered the same width as one, so the shape of the
 *    market was the shape of our scrape schedule.
 * 3. **The curve steps, it doesn't glide.** A price, an open-role count and a
 *    review score all hold flat and then jump. `monotone` over sparse captures
 *    drew a smooth ramp nobody's pricing page ever performed.
 */
export interface MarketChartProps {
  series: TrendsMarketSeries[];
  mode: "index" | "absolute";
  height?: number;
  /** Renders the raw captured value in the tooltip (money, roles, score). */
  formatValue: (value: number, series: TrendsMarketSeries) => string;
  /** Competitor ids the legend has switched off. */
  hidden?: Set<string>;
  /**
   * Competitor the key is currently pointing at. Every other line fades so one
   * series can be traced through the crossings without switching the rest off,
   * which loses the field it is being compared against.
   */
  highlighted?: string | null;
}

function TooltipCard({
  active,
  payload,
  label,
  series,
  mode,
  formatValue,
  labelFor,
}: {
  active?: boolean;
  payload?: Array<{
    dataKey?: string | number;
    value?: number;
    color?: string;
    payload?: ChartRow;
  }>;
  label?: number;
  series: TrendsMarketSeries[];
  mode: "index" | "absolute";
  formatValue: MarketChartProps["formatValue"];
  labelFor: (stamp: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const byId = new Map(series.map((s) => [s.competitorId, s]));
  const row = payload[0]?.payload;
  const entries = payload
    .map((entry) => {
      const id = String(entry.dataKey ?? "");
      const item = byId.get(id);
      if (!item || entry.value == null) return null;
      const raw = row?.[rawKey(id)];
      const asOf = row?.[asOfKey(id)];
      return {
        item,
        plotted: entry.value,
        raw: typeof raw === "number" ? raw : null,
        // Only worth saying when the reading predates the hovered date: on the day
        // of a capture it would put "as of today" on every row.
        staleSince:
          typeof asOf === "number" && label != null && asOf < label ? asOf : null,
        color: entry.color,
      };
    })
    .filter((entry) => entry !== null)
    .sort((a, b) => b.plotted - a.plotted);
  if (entries.length === 0) return null;

  return (
    <div
      className={`pointer-events-none min-w-[13rem] rounded-md border border-border bg-popover px-2.5 py-2 shadow-sm ${chartTooltipCardMotion}`}
    >
      <div className="mb-1.5 text-meta text-muted-foreground">
        {label != null ? labelFor(label) : null}
      </div>
      <div className="flex flex-col gap-1">
        {entries.map((entry) => (
          <div
            key={entry.item.competitorId}
            className="flex items-baseline justify-between gap-4 text-xs"
          >
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden
                className="h-0.5 w-2.5 shrink-0 rounded-full"
                style={{ background: entry.color }}
              />
              <span className="truncate">{entry.item.competitorName}</span>
            </span>
            <span className="shrink-0 tabular-nums">
              {entry.staleSince !== null && (
                <span className="mr-1.5 text-muted-foreground">
                  {labelFor(entry.staleSince)}
                </span>
              )}
              {entry.raw != null && formatValue(entry.raw, entry.item)}
              {mode === "index" && (
                <span className="ml-1.5 text-muted-foreground">
                  {entry.plotted > 0 ? "+" : ""}
                  {Number.isInteger(entry.plotted) ? entry.plotted : entry.plotted.toFixed(1)}%
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TrendsMarketChart({
  series,
  mode,
  height = 200,
  formatValue,
  hidden,
  highlighted,
}: MarketChartProps) {
  const visible = useMemo(
    () => series.filter((s) => !hidden?.has(s.competitorId)),
    [series, hidden],
  );

  // A competitor's colour is its identity, so it has to survive the legend being
  // used as a filter. Indexing into the fallback palette by position in `visible`
  // repainted every unassigned line below a switched-off one, and left the key's
  // swatch pointing at a colour no longer on the plot.
  const paletteSlot = useMemo(
    () => new Map(series.map((s, i) => [s.competitorId, i])),
    [series],
  );

  // Switching a series off while pointing at its key entry would otherwise leave
  // the highlight on a line that is no longer plotted, fading every remaining one
  // with nothing to look at.
  const active = visible.some((s) => s.competitorId === highlighted) ? highlighted : null;

  const { data, ticks, domain, labelFor } = useMemo(() => {
    const grid = buildCarriedGrid(visible, mode);
    // The original timestamp string is kept for formatting: round-tripping a
    // stamp through `toISOString()` would shift the printed day by the reader's
    // UTC offset. The axis label carries the year once the window spans one,
    // otherwise two "Jan 5" ticks a year apart would read as the same date.
    const format = (stamp: number) =>
      formatDate(
        grid.isoByStamp.get(stamp) ?? new Date(stamp).toISOString(),
        grid.spansYears
          ? { month: "short", year: "2-digit" }
          : { month: "short", day: "numeric" },
      );
    return {
      data: grid.rows,
      ticks: grid.ticks,
      domain: grid.domain,
      labelFor: format,
    };
  }, [visible, mode]);

  if (visible.length === 0 || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-muted-foreground"
        style={{ height }}
      >
        Nothing to plot in this window.
      </div>
    );
  }

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={domain ?? ["dataMin", "dataMax"]}
            ticks={ticks}
            tickFormatter={labelFor}
            stroke="var(--border)"
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis
            stroke="var(--border)"
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={46}
            domain={mode === "index" ? ["auto", "auto"] : ["dataMin - 0.3", "dataMax + 0.3"]}
            tickFormatter={(v: number) =>
              mode === "index" ? `${v > 0 ? "+" : ""}${v}%` : v.toFixed(1)
            }
          />
          {mode === "index" && (
            <ReferenceLine y={0} stroke="var(--border-strong)" strokeDasharray="3 3" />
          )}
          <Tooltip
            {...chartTooltipMotion}
            cursor={<ChartCursorLine />}
            content={
              <TooltipCard
                series={visible}
                mode={mode}
                formatValue={formatValue}
                labelFor={labelFor}
              />
            }
          />
          {visible.map((item) => {
            const dimmed = active != null && active !== item.competitorId;
            return (
              <Line
                key={item.competitorId}
                // A price, a headcount and a score hold until the next capture
                // moves them, so the line holds too and jumps on the day we read
                // the new value.
                type="stepAfter"
                dataKey={item.competitorId}
                name={item.competitorName}
                stroke={seriesStroke(item.color, paletteSlot.get(item.competitorId) ?? 0)}
                // Your own product is the reference every other line is read against,
                // so it carries the only heavier stroke on the chart.
                strokeWidth={item.isSelf ? 2.5 : 1.5}
                // Faded, not hidden: the muted lines still carry the shape of the
                // field, they just stop competing for the eye. Faded over the same
                // beat as the rest of the hover, so running down the key dims the
                // field rather than flicking it on and off.
                strokeOpacity={dimmed ? 0.16 : 1}
                style={{ transition: "stroke-opacity 150ms ease-out" }}
                dot={false}
                activeDot={{ r: 3, strokeWidth: 1.5, stroke: "var(--background)" }}
                connectNulls
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default TrendsMarketChart;
