"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  CartesianGrid,
  Legend,
  ReferenceLine,
} from "recharts";
import { lineColor } from "./charts";

const TOOLTIP_STYLE = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
} as const;

/**
 * Shared multi-series chart for the pricing / reviews / hiring tabs (all plot one
 * or more series over a "date" X axis). Isolated in its own module so the tabs can
 * lazy-load it with `next/dynamic` and keep recharts (heavy, client-only) off each
 * route's first-load bundle (F7).
 *
 * It was a bare LineChart: a full dotted grid boxing the plot in both directions,
 * a flat stroke with nothing under it, and no way to tell the latest capture from
 * the rest of the series. Three changes, no new dependency:
 *
 *   - a faint gradient under each series, so the shape reads as a quantity rather
 *     than as a wire, and a single series stops looking like a stray line;
 *   - horizontal rules only, since vertical ones fence the data without helping
 *     anyone read a value off it;
 *   - an emphasised endpoint, because on a monitoring chart the newest capture is
 *     the one the reader came for.
 */
export function MultiLineChart({
  data,
  seriesKeys,
  height,
  yDomain,
  yAllowDecimals = true,
  dot = false,
  stacked = false,
  markers = [],
}: {
  data: Array<Record<string, number | string>>;
  seriesKeys: string[];
  height: number;
  yDomain?: [number, number];
  yAllowDecimals?: boolean;
  dot?: boolean;
  // Stack the bands so the top edge reads as the total. Right for parts of one
  // whole (open roles per department); wrong for independent series that share an
  // axis (plan prices), where stacking would invent a sum nobody is paying.
  stacked?: boolean;
  // Vertical annotations on the X axis, e.g. where a shift detector fired. `x`
  // must match a value of the series' `date` key.
  markers?: Array<{ x: string; label: string; tone?: "high" | "critical" }>;
}) {
  const lastIndex = data.length - 1;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          {seriesKeys.map((k, i) => (
            <linearGradient key={k} id={`fill-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor(i)} stopOpacity={0.18} />
              <stop offset="100%" stopColor={lineColor(i)} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {/* Horizontal only: a vertical rule per capture fences the plot without
            helping anyone read a value off it. */}
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
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
          allowDecimals={yAllowDecimals}
          width={44}
          {...(yDomain ? { domain: yDomain } : {})}
        />
        <ChartTooltip contentStyle={TOOLTIP_STYLE} />
        {seriesKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {/* Where a detector fired. Rendered before the areas so a band never
            paints over the rule. */}
        {markers.map((mk) => (
          <ReferenceLine
            key={`${mk.x}-${mk.label}`}
            x={mk.x}
            stroke={mk.tone === "critical" ? "var(--critical)" : "var(--high)"}
            strokeDasharray="3 3"
            strokeOpacity={0.7}
            label={{
              value: mk.label,
              position: "insideTopRight",
              fill: mk.tone === "critical" ? "var(--critical)" : "var(--high)",
              fontSize: 11,
              fontWeight: 600,
            }}
          />
        ))}
        {seriesKeys.map((k, i) => (
          <Area
            key={k}
            type="monotone"
            dataKey={k}
            stroke={lineColor(i)}
            strokeWidth={2}
            fill={`url(#fill-${i})`}
            {...(stacked ? { stackId: "total" } : {})}
            // Every point when the caller asked for dots (reviews plots sparse
            // captures); otherwise only the newest one, which is what a monitoring
            // reader is looking for.
            dot={
              dot
                ? { r: 2.5, fill: lineColor(i), strokeWidth: 0 }
                : (props) =>
                    props.index === lastIndex ? (
                      <circle
                        key={`${k}-end`}
                        cx={props.cx}
                        cy={props.cy}
                        r={3.5}
                        fill={lineColor(i)}
                      />
                    ) : (
                      <g key={`${k}-${props.index}`} />
                    )
            }
            activeDot={{ r: 4, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export default MultiLineChart;
