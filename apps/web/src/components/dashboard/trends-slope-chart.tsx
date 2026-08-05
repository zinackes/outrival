"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { TrendsMarketSeries } from "@/lib/api";
import { EyeSlashIcon } from "@/components/icons";
import { formatDate } from "@/lib/format-date";
import { paintFor, type SeriesPaint } from "@/lib/series-color";
import { cn } from "@/lib/utils";
import { CompAvatar } from "./comp-avatar";
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
 * Three channels carry three different facts, and none borrows another's:
 *
 *   hue              which competitor        — always, mover or not
 *   weight + opacity moved, or held
 *   dash             captured once, so the flat line is unproven
 *
 * The hue used to be spent on "moved", which left everyone who held on the same
 * grey. That reads as a tidy chart right up to the moment the reader does the only
 * thing anyone does here — trace one line to one label. Twelve identical greys make
 * that impossible; a muted hue matching the label's own mark makes it free. The
 * bundle still recedes, thinner and at half opacity, it just recedes as itself.
 *
 * Where labels stack, `decollide` pushes them off their own line, so a leader elbow
 * runs from each end dot to its label. It is drawn inside the plot's own reserved
 * gutter (X_TO stops short of the edge): the label column is a sibling grid cell,
 * and a percentage x inside the SVG resolves against the plot's width, never the
 * page's, so a leader can never be made to reach it.
 *
 * The Y axis is linear on price, not log. Log would give a 15% move the same
 * slope at $6 as at $600, which reads well but is a lie on an axis labelled in
 * dollars: the reader is looking at a price ladder and the vertical distance
 * between two competitors has to be the money between them. The percentage each
 * line travelled is direct-labelled instead, so the number never depends on
 * judging an angle.
 */

/** X of the two capture columns, then the leader's elbow, as a share of plot width. */
const X_FROM = "3%";
const X_TO = "88%";
const X_ELBOW = "94%";
const X_LEADER_END = "100%";

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
  /** One paint per competitor, dealt once for the whole page. */
  paint: Map<string, SeriesPaint>;
  /** Competitors excluded page-wide. */
  hidden?: Set<string>;
  /** Excluding from a label writes the same page-wide filter the toolbar does. */
  onToggle?: (competitorId: string) => void;
}

export function TrendsSlopeChart({
  series,
  formatValue,
  paint,
  hidden,
  onToggle,
}: TrendsSlopeChartProps) {
  const [active, setActive] = useState<string | null>(null);

  // Filtered BEFORE the model, not after: the model derives the price range from the
  // rows it is handed, so dropping the one $499 competitor rescales the ladder and
  // gives ten $9-$49 lines back the height they were flattened out of. That rescale
  // is the reason to offer a filter on a price chart at all.
  const visible = useMemo(
    () => series.filter((s) => !hidden?.has(s.competitorId)),
    [series, hidden],
  );
  const model = useMemo(() => buildSlopeModel(visible), [visible]);

  if (!model) return null;

  const { height, y } = model;
  const shortDate = (iso: string) => formatDate(iso, { month: "short", day: "numeric" });
  const paintOf = (row: SlopeRow) => paintFor(paint, row.item.competitorId);

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
            {/* Under the series: a leader points at a line, it is never one. */}
            {model.leaders.map((leader) => (
              <polyline
                key={`leader-${leader.competitorId}`}
                points={`${X_TO},${leader.endY} ${X_ELBOW},${leader.labelY} ${X_LEADER_END},${leader.labelY}`}
                fill="none"
                stroke={paintFor(paint, leader.competitorId).stroke}
                strokeWidth={1}
                strokeOpacity={active != null && active !== leader.competitorId ? 0.08 : 0.35}
              />
            ))}
            {model.drawn.map((row) => {
              const dimmed = active != null && active !== row.item.competitorId;
              const { stroke } = paintOf(row);
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
                    // A held line keeps its colour and gives up weight instead, so the
                    // bundle recedes without going anonymous.
                    strokeWidth={row.moved ? 2.25 : 1.25}
                    strokeOpacity={row.moved ? 1 : 0.5}
                    strokeDasharray={row.single ? "3 3" : undefined}
                  />
                  <circle
                    cx={X_FROM}
                    cy={y1}
                    r={3}
                    fill={stroke}
                    fillOpacity={row.moved ? 1 : 0.5}
                  />
                  <circle
                    cx={X_TO}
                    cy={y2}
                    r={3}
                    fill={stroke}
                    fillOpacity={row.moved ? 1 : 0.5}
                  />
                </g>
              );
            })}
          </svg>
        </div>

        <div className="relative" style={{ height }}>
          {model.labels.map(({ row, top }) => {
            const dimmed = active != null && active !== row.item.competitorId;
            return (
              <div
                key={row.item.competitorId}
                className="group absolute inset-x-0 flex -translate-y-1/2 items-center"
                style={{ top }}
                onPointerEnter={() => setActive(row.item.competitorId)}
                onPointerLeave={() => setActive(null)}
              >
                <Link
                  href={`/dashboard/competitors/${row.item.competitorId}?tab=pricing`}
                  onFocus={() => setActive(row.item.competitorId)}
                  onBlur={() => setActive(null)}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-1.5 rounded-sm py-0.5 text-xs",
                    "transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    dimmed ? "opacity-30" : "hover:opacity-70",
                  )}
                >
                  {/* The leader already carries the hue into this row, so the label
                      spends its width on the identity a hue cannot give: the mark. */}
                  <CompAvatar
                    name={row.item.competitorName}
                    url={row.item.competitorUrl}
                    size={14}
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
                {onToggle && (
                  <button
                    type="button"
                    onClick={() => onToggle(row.item.competitorId)}
                    onFocus={() => setActive(row.item.competitorId)}
                    onBlur={() => setActive(null)}
                    aria-label={`Hide ${row.item.competitorName}`}
                    className={cn(
                      "ml-1 shrink-0 rounded-sm p-0.5 text-muted-foreground opacity-0 transition",
                      "hover:text-foreground group-hover:opacity-100",
                      "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    <EyeSlashIcon size={14} />
                  </button>
                )}
              </div>
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
