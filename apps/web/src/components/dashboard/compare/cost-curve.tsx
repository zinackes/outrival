"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip as ChartTooltip,
} from "recharts";
import { meterUnitLabel } from "@outrival/shared";
import { ChartCursorLine, chartTooltipMotion } from "@/components/dashboard/chart-motion";
import { costAxis, type CostCurveSeries } from "./derive";

/**
 * What every compared competitor charges for one meter, across the whole volume
 * range (Pricing Intelligence P5).
 *
 * The lens above reads each competitor at ONE volume, which ranks them at a point
 * and hides the only thing a buyer actually needs: where the ranking flips. A
 * competitor that is cheapest at 1,000 requests is routinely the dearest at a
 * million, and a `volume` ladder can even get cheaper in absolute terms as usage
 * grows. On a log X axis that is one glance.
 *
 * Two kinds of claim share the plot and are drawn apart. The LINES are our
 * arithmetic over the ladder each page publishes. The POINTS are costs we read
 * rather than derived: a probe on the competitor's own calculator (filled), or a
 * worked example the page prints (hollow). A reader deciding on price is entitled
 * to know which is which, so the shape says it before the tooltip does.
 */

const DECADE_TICKS = [1, 10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000];


const compactQty = (q: number): string =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(q);

const TOOLTIP_STYLE = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
} as const;

/** One row per sampled quantity, holding whichever series reached it. Curves do
 * not share a grid exactly — each competitor's own band boundaries are sampled
 * too — so a gap is normal and the lines connect across it. */
function mergeRows(series: CostCurveSeries[]): Array<Record<string, number>> {
  const byQty = new Map<number, Record<string, number>>();
  for (const s of series) {
    for (const p of s.points) {
      const row = byQty.get(p.qty) ?? { qty: p.qty };
      row[s.id] = p.cost;
      byQty.set(p.qty, row);
    }
  }
  return [...byQty.values()].sort((a, b) => a.qty! - b.qty!);
}

export function CostCurveChart({
  series,
  unit,
  currency,
  markers,
}: {
  series: CostCurveSeries[];
  unit: string;
  currency: string;
  /** The volumes this workspace compares at — drawn as vertical guides so the
   * single-volume reading above can be located on the curve. */
  markers: number[];
}) {
  const rows = mergeRows(series);
  if (rows.length === 0) return null;

  const cost = costAxis(rows);
  const money = (v: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: v < 10 ? 2 : 0,
    }).format(v);

  return (
    <>
      <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="qty"
          type="number"
          // Log, because the interesting range spans seven orders of magnitude and
          // a linear axis would compress everything under 100k into the origin.
          scale="log"
          domain={[1, 10_000_000]}
          ticks={DECADE_TICKS}
          tickFormatter={compactQty}
          stroke="var(--muted)"
          fontSize={11}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          stroke="var(--muted)"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={56}
          // Log when the costs span decades, which on a seven-decade X axis is the
          // normal case — otherwise every volume under 100k draws on the floor.
          scale={cost.log ? "log" : "auto"}
          domain={cost.domain}
          ticks={cost.ticks}
          tickFormatter={(v: number) => money(v)}
        />
        <ChartTooltip
          {...chartTooltipMotion}
          contentStyle={TOOLTIP_STYLE}
          cursor={<ChartCursorLine />}
          labelFormatter={(label) => {
            const q = Number(label);
            return Number.isFinite(q) ? `${compactQty(q)} ${meterUnitLabel(unit, q)}/mo` : label;
          }}
          // The series key is a competitor id, which is not a name anyone reads.
          formatter={(value, name) => [
            money(Number(value)),
            series.find((s) => s.id === String(name))?.name ?? String(name),
          ]}
        />
        {markers.map((q) => (
          <ReferenceLine
            key={`marker-${q}`}
            x={q}
            stroke="var(--muted)"
            strokeDasharray="2 4"
            strokeOpacity={0.7}
            label={{
              value: compactQty(q),
              position: "top",
              fill: "var(--muted)",
              fontSize: 10,
            }}
          />
        ))}
        {series.map((s) => (
          <Line
            key={s.id}
            type="monotone"
            dataKey={s.id}
            stroke={s.stroke}
            strokeWidth={2}
            dot={false}
            // A competitor's own band edges add sample points nobody else has, so
            // its neighbours have gaps at those quantities. Connecting across them
            // draws the model; leaving them broken would draw our sampling.
            connectNulls
            isAnimationActive={false}
          />
        ))}
        {series
          .filter((s) => s.marks.length > 0)
          .map((s) => (
            <Scatter
              key={`${s.id}-marks`}
              data={s.marks.map((m) => ({ qty: m.qty, [s.id]: m.cost, measured: m.measured }))}
              dataKey={s.id}
              fill={s.stroke}
              shape={(props: { cx?: number; cy?: number; payload?: { measured?: boolean } }) =>
                props.cx == null || props.cy == null ? (
                  <g />
                ) : props.payload?.measured ? (
                  <circle cx={props.cx} cy={props.cy} r={4} fill={s.stroke} />
                ) : (
                  <circle
                    cx={props.cx}
                    cy={props.cy}
                    r={4}
                    fill="var(--bg)"
                    stroke={s.stroke}
                    strokeWidth={1.5}
                  />
                )
              }
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
      {/* Neither axis is linear, and a reader judging a gap by eye has to be told:
          on two log axes a straight line is a constant rate per unit, and equal
          heights apart are equal MULTIPLES of cost, not equal dollars. */}
      <p className="text-muted-foreground text-meta">
        {cost.log
          ? "Both axes are log: equal steps are ×10, and a straight line is a flat rate per unit."
          : "Volume axis is log (equal steps are ×10); cost is linear."}
      </p>
    </>
  );
}

export default CostCurveChart;
