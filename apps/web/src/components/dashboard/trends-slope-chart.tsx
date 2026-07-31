"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { TrendsMarketSeries } from "@/lib/api";
import { formatDate } from "@/lib/format-date";
import { seriesStroke } from "@/lib/series-color";
import { cn } from "@/lib/utils";
import { buildSlopeModel, type SlopeRow } from "@/components/dashboard/trends-chart-model";

/**
 * Where each competitor's entry price started the window, and where it ended.
 *
 * Pricing was plotted as twelve time series, which is the wrong form twice over.
 * The intermediate path does not exist: a page is scraped every few days and a
 * price is a step function between those reads, so every segment between two
 * captures was drawn rather than observed. And when nothing moved (the common
 * case) the result was eleven lines stacked on the zero rule, which is the worst
 * possible way to say "prices held". A slopegraph plots only what we actually
 * read, the two endpoints, and makes the answer the shape: a flat bundle with the
 * one or two lines that left it.
 *
 * The palette problem disappears with the form rather than being worked around.
 * Only the movers take a competitor colour; everything that held is one muted
 * grey, so a plot of twenty competitors still asks the reader to tell apart as
 * many hues as there were moves.
 *
 * The Y axis is linear on price, not log. Log would give a 15% move the same
 * slope at $6 as at $600, which reads well but is a lie on an axis labelled in
 * dollars: the reader is looking at a price ladder and the vertical distance
 * between two competitors has to be the money between them. The percentage each
 * line travelled is direct-labelled instead, so the number never depends on
 * judging an angle.
 */

/** X of the two capture columns, as a share of the plot width. */
const X_FROM = "3%";
const X_TO = "97%";

/**
 * Ladder · plot · labels. On a phone the ladder is dropped and the label column
 * narrows: three fixed columns would leave the plot about 40px wide, which is not
 * a chart. The ladder is the one part the labels already repeat, so it is what
 * goes.
 */
const COLUMNS =
  "grid-cols-[minmax(0,1fr)_9.5rem] sm:grid-cols-[3.25rem_minmax(0,1fr)_minmax(0,15rem)]";

export interface TrendsSlopeChartProps {
  series: TrendsMarketSeries[];
  /** Renders a captured value the way its metric is written (money, roles). */
  formatValue: (value: number, series: TrendsMarketSeries) => string;
}

export function TrendsSlopeChart({ series, formatValue }: TrendsSlopeChartProps) {
  const [active, setActive] = useState<string | null>(null);

  const model = useMemo(() => buildSlopeModel(series), [series]);

  if (!model) return null;

  const { height, y } = model;
  const shortDate = (iso: string) => formatDate(iso, { month: "short", day: "numeric" });
  const strokeFor = (row: SlopeRow) =>
    row.moved ? seriesStroke(row.item.color, row.slot) : "var(--muted-foreground)";

  return (
    <div className="w-full">
      <div className={cn("mb-1 grid gap-3 text-meta tabular-nums text-muted-foreground", COLUMNS)}>
        <span className="hidden sm:block" />
        <span className="flex justify-between">
          <span>{model.firstDate ? shortDate(model.firstDate) : null}</span>
          <span>{model.lastDate ? shortDate(model.lastDate) : null}</span>
        </span>
        <span />
      </div>

      <div className={cn("grid gap-3", COLUMNS)}>
        {/* The price ladder itself, so a level can be read without a label. */}
        <div className="relative hidden sm:block" style={{ height }}>
          {model.ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 -translate-y-1/2 text-meta tabular-nums text-muted-foreground"
              style={{ top: y(tick) }}
            >
              {formatValue(tick, model.axisItem)}
            </span>
          ))}
        </div>

        <div className="relative" style={{ height }}>
          <svg
            width="100%"
            height={height}
            className="overflow-visible"
            role="img"
            aria-label={`Start and end of the window for ${model.rows.length} competitors. Every value is listed beside the chart.`}
          >
            {model.ticks.map((tick) => (
              <line
                key={`grid-${tick}`}
                x1="0"
                x2="100%"
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--border)"
              />
            ))}
            {model.drawn.map((row) => {
              const dimmed = active != null && active !== row.item.competitorId;
              const stroke = strokeFor(row);
              const y1 = y(row.from);
              const y2 = y(row.to);
              return (
                <g
                  key={row.item.competitorId}
                  onPointerEnter={() => setActive(row.item.competitorId)}
                  onPointerLeave={() => setActive(null)}
                  style={{
                    opacity: dimmed ? 0.18 : 1,
                    transition: "opacity 150ms ease-out",
                  }}
                >
                  {/* Transparent fat stroke: the 1.5px line is not a hit target. */}
                  <line
                    x1={X_FROM}
                    x2={X_TO}
                    y1={y1}
                    y2={y2}
                    stroke="transparent"
                    strokeWidth={18}
                  />
                  <line
                    x1={X_FROM}
                    x2={X_TO}
                    y1={y1}
                    y2={y2}
                    stroke={stroke}
                    strokeWidth={row.moved ? 2 : 1.5}
                    strokeDasharray={row.single ? "3 3" : undefined}
                  />
                  <circle cx={X_FROM} cy={y1} r={3} fill={stroke} />
                  <circle cx={X_TO} cy={y2} r={3} fill={stroke} />
                </g>
              );
            })}
          </svg>
        </div>

        <div className="relative" style={{ height }}>
          {model.labels.map(({ row, top }) => {
            const dimmed = active != null && active !== row.item.competitorId;
            return (
              <Link
                key={row.item.competitorId}
                href={`/dashboard/competitors/${row.item.competitorId}?tab=pricing`}
                onPointerEnter={() => setActive(row.item.competitorId)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(row.item.competitorId)}
                onBlur={() => setActive(null)}
                className={cn(
                  "absolute inset-x-0 flex -translate-y-1/2 items-center gap-1.5 rounded-sm py-0.5 text-xs",
                  "transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  dimmed ? "opacity-30" : "hover:opacity-70",
                )}
                style={{ top }}
              >
                <span
                  aria-hidden
                  className="h-0.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: strokeFor(row) }}
                />
                <span className={cn("min-w-0 truncate", row.item.isSelf && "font-medium")}>
                  {row.item.competitorName}
                  {row.item.isSelf && <span className="text-muted-foreground"> (you)</span>}
                </span>
                <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                  {formatValue(row.to, row.item)}
                </span>
                {row.moved && (
                  <span className="shrink-0 tabular-nums text-foreground">
                    {row.pct > 0 ? "+" : ""}
                    {row.pct}%
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {model.movedCount} moved · {model.rows.length - model.movedCount} held steady
        {model.singleCount > 0 && ` · ${model.singleCount} captured once`}
      </p>
    </div>
  );
}

export default TrendsSlopeChart;
