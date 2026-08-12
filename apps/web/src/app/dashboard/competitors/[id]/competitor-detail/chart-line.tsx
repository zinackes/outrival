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
import { ChartCursorLine, chartTooltipMotion } from "@/components/dashboard/chart-motion";
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
  archiveKey,
}: {
  data: Array<Record<string, number | string>>;
  seriesKeys: string[];
  height: number;
  yDomain?: [number, number];
  yAllowDecimals?: boolean;
  dot?: boolean;
  // P5 — the meta key marking a point rebuilt from the Internet Archive rather
  // than watched. Those points are drawn hollow and say so in the tooltip: both
  // prices are true, but only one of them is something we saw change.
  archiveKey?: { archived: string; captureDay: string };
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
        <ChartTooltip
          {...chartTooltipMotion}
          contentStyle={TOOLTIP_STYLE}
          // Recharts lays the tooltip and the legend out as absolute siblings in
          // the order their elements appear here, so on a multi-series plot the
          // legend below paints over a tooltip that reaches down to it. Neither
          // wrapper carries a z-index of its own; giving the tooltip one settles
          // it for good, whatever the element order.
          wrapperStyle={{ zIndex: 20, outline: "none" }}
          cursor={<ChartCursorLine />}
          // The axis label is a short "14 Apr"; on an archived point that is not
          // enough, because the whole question is WHEN the archive holds it and
          // whether we watched it. Name both, on that point only.
          labelFormatter={(label, payload) => {
            if (!archiveKey) return label;
            const point = payload?.[0]?.payload as Record<string, unknown> | undefined;
            if (!point || point[archiveKey.archived] !== 1) return label;
            const day = point[archiveKey.captureDay];
            return `${typeof day === "string" ? day : label} · via Internet Archive`;
          }}
        />
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
            dot={(props) => {
              // A series with no value at this date still gets asked for its dot,
              // with no y to put it at. Drawing it anyway pins the circle to the
              // top of the plot area — a stray colored dot in the corner, half
              // over the axis, marking nothing. Draw nothing.
              if (!Number.isFinite(props.cx) || !Number.isFinite(props.cy)) {
                return <g key={`${k}-${props.index}`} />;
              }
              const point = props.payload as Record<string, unknown> | undefined;
              // Hollow ring: the shape says "reconstructed" before any tooltip is
              // opened, and it is drawn whether or not the series shows dots —
              // hiding it would put an archived price on the line unannounced.
              if (archiveKey && point?.[archiveKey.archived] === 1) {
                return (
                  <circle
                    key={`${k}-archive-${props.index}`}
                    cx={props.cx}
                    cy={props.cy}
                    r={3.5}
                    fill="var(--bg)"
                    stroke={lineColor(i)}
                    strokeWidth={1.5}
                  />
                );
              }
              if (dot) {
                return (
                  <circle
                    key={`${k}-${props.index}`}
                    cx={props.cx}
                    cy={props.cy}
                    r={2.5}
                    fill={lineColor(i)}
                  />
                );
              }
              return props.index === lastIndex ? (
                <circle key={`${k}-end`} cx={props.cx} cy={props.cy} r={3.5} fill={lineColor(i)} />
              ) : (
                <g key={`${k}-${props.index}`} />
              );
            }}
            activeDot={{ r: 4, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export default MultiLineChart;
