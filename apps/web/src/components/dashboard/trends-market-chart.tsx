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
import { formatDate } from "@/lib/format-date";
import { seriesStroke } from "@/lib/series-color";

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

/** Raw captured value, carried alongside the plotted one so the tooltip can state both. */
const rawKey = (competitorId: string) => `raw:${competitorId}`;

type ChartRow = Record<string, string | number>;

function TooltipCard({
  active,
  payload,
  label,
  series,
  mode,
  formatValue,
}: {
  active?: boolean;
  payload?: Array<{
    dataKey?: string | number;
    value?: number;
    color?: string;
    payload?: ChartRow;
  }>;
  label?: string;
  series: TrendsMarketSeries[];
  mode: "index" | "absolute";
  formatValue: MarketChartProps["formatValue"];
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
      return {
        item,
        plotted: entry.value,
        raw: typeof raw === "number" ? raw : null,
        color: entry.color,
      };
    })
    .filter((entry) => entry !== null)
    .sort((a, b) => b.plotted - a.plotted);
  if (entries.length === 0) return null;

  return (
    <div className="pointer-events-none min-w-[11rem] rounded-md border border-border bg-popover px-2.5 py-2 shadow-sm">
      <div className="mb-1.5 text-meta text-muted-foreground">{label}</div>
      <div className="flex flex-col gap-1">
        {entries.map((entry) => (
          <div
            key={entry.item.competitorId}
            className="flex items-baseline justify-between gap-4 text-xs"
          >
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: entry.color }}
              />
              <span className="truncate">{entry.item.competitorName}</span>
            </span>
            <span className="shrink-0 font-mono tabular-nums">
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

  // Switching a series off while pointing at its key entry would otherwise leave
  // the highlight on a line that is no longer plotted, fading every remaining one
  // with nothing to look at.
  const active = visible.some((s) => s.competitorId === highlighted) ? highlighted : null;

  // One row per captured day, holding whichever competitors reported that day.
  // `connectNulls` bridges the gaps so a weekly source doesn't render as dots. The
  // axis label carries the year once the window spans one, otherwise two "Jan 5"
  // ticks a year apart would collapse onto the same category.
  const data = useMemo<ChartRow[]>(() => {
    const stamps = visible.flatMap((s) => s.points.map((p) => new Date(p.t).getTime()));
    const spansYears =
      stamps.length > 0 && Math.max(...stamps) - Math.min(...stamps) > 300 * 86_400_000;
    const labelFor = (iso: string) =>
      formatDate(iso, spansYears ? { month: "short", year: "2-digit" } : { month: "short", day: "numeric" });

    const rows = new Map<string, ChartRow>();
    for (const item of visible) {
      const base = item.points[0]?.value;
      for (const point of item.points) {
        let row = rows.get(point.t);
        if (!row) {
          row = { t: labelFor(point.t), __sort: new Date(point.t).getTime() };
          rows.set(point.t, row);
        }
        row[item.competitorId] =
          mode === "index"
            ? base
              ? Math.round(((point.value - base) / base) * 1000) / 10
              : 0
            : point.value;
        row[rawKey(item.competitorId)] = point.value;
      }
    }
    return [...rows.values()].sort((a, b) => Number(a.__sort) - Number(b.__sort));
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
            stroke="var(--border)"
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickLine={false}
            minTickGap={28}
            interval="preserveStartEnd"
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
            isAnimationActive={false}
            cursor={{
              stroke: "var(--muted-foreground)",
              strokeWidth: 1,
              strokeDasharray: "2 3",
              strokeOpacity: 0.5,
            }}
            content={<TooltipCard series={visible} mode={mode} formatValue={formatValue} />}
          />
          {visible.map((item, i) => {
            const dimmed = active != null && active !== item.competitorId;
            return (
              <Line
                key={item.competitorId}
                type="monotone"
                dataKey={item.competitorId}
                name={item.competitorName}
                stroke={seriesStroke(item.color, i)}
                // Your own product is the reference every other line is read against,
                // so it carries the only heavier stroke on the chart.
                strokeWidth={item.isSelf ? 2.5 : 1.5}
                // Faded, not hidden: the muted lines still carry the shape of the
                // field, they just stop competing for the eye.
                strokeOpacity={dimmed ? 0.16 : 1}
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
