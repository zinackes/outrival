"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, YAxis } from "recharts";

export interface BarSparkProps {
  /** One value per bucket, oldest first. */
  data: number[];
  /** Human label per bucket ("Jul 18", or "Jul 18 to Jul 19" for wider buckets). */
  labels?: string[];
  /** Singular unit; the tooltip pluralises with a trailing "s". */
  unit?: string;
  h?: number;
}

interface TipProps {
  active?: boolean;
  payload?: Array<{ value?: number; payload?: { i: number } }>;
  labels?: string[];
  unit?: string;
}

// Same popover look as the area sparkline's tooltip, with the bucket's own label.
function BarTooltip({ active, payload, labels, unit }: TipProps) {
  const point = active ? payload?.[0] : undefined;
  if (!point) return null;
  const i = point.payload?.i ?? 0;
  const v = point.value ?? 0;
  return (
    <div className="pointer-events-none rounded-md border border-border bg-popover px-2 py-1 whitespace-nowrap shadow-sm">
      {labels?.[i] && <div className="text-meta text-muted-foreground">{labels[i]}</div>}
      <div className="font-mono text-meta font-semibold tabular-nums">
        {v}
        {unit ? ` ${v === 1 ? unit : `${unit}s`}` : ""}
      </div>
    </div>
  );
}

/**
 * Bars, not an area: these are small integer counts per bucket, and a bar reads a
 * zero day honestly where an area chart interpolates straight through it. The last
 * bucket carries the accent so "now" is findable.
 *
 * recharts (heavy, client-only) so the hover is a snapping shared cursor rather than
 * fourteen 4px hit targets. Split into its own module so the parent can lazy-load it
 * and keep recharts off the route's first-load bundle (F7).
 */
export function BarSparkChart({ data, labels, unit, h = 26 }: BarSparkProps) {
  if (!data || data.length === 0) return null;
  const chartData = data.map((v, i) => ({ i, v }));
  const max = Math.max(...data, 1);
  const last = data.length - 1;

  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        {/* Domain from 0 so bar heights are proportional to the count, not to the
            spread between the smallest and largest bucket. */}
        <YAxis hide domain={[0, max]} />
        <Tooltip
          isAnimationActive={false}
          // Pinned above the 26px plot (only `y` is fixed, `x` keeps tracking the
          // cursor) and allowed to escape it, otherwise the rail's overflow clips it.
          position={{ y: -46 }}
          allowEscapeViewBox={{ x: false, y: true }}
          wrapperStyle={{ zIndex: 20, outline: "none" }}
          cursor={{ fill: "var(--foreground)", fillOpacity: 0.06 }}
          content={<BarTooltip labels={labels} unit={unit} />}
        />
        <Bar dataKey="v" radius={[1, 1, 0, 0]} minPointSize={2} animationDuration={400}>
          {chartData.map((d) => (
            <Cell
              key={d.i}
              // A zero bucket keeps a 2px stub in the border colour: it has to read
              // as an observed zero, not as a gap in the chart.
              fill={
                d.v === 0
                  ? "var(--border-strong)"
                  : d.i === last
                    ? "var(--accent)"
                    : "color-mix(in oklab, var(--accent) 70%, transparent)"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default BarSparkChart;
