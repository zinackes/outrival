"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from "recharts";

export interface SparklineProps {
  data: number[];
  labels?: string[];
  w?: number;
  h?: number;
  color?: string;
  fill?: boolean;
  interactive?: boolean;
  valueLabel?: string;
}

interface TipProps {
  active?: boolean;
  payload?: Array<{ value?: number; payload?: { i: number } }>;
  labels?: string[];
  valueLabel?: string;
}

// Compact tooltip matching the dashboard popover look — recharts injects
// `active`/`payload`, we pass `labels`/`valueLabel`.
function SparkTooltip({ active, payload, labels, valueLabel }: TipProps) {
  const point = active ? payload?.[0] : undefined;
  if (!point) return null;
  const i = point.payload?.i ?? 0;
  return (
    <div className="pointer-events-none rounded-md border border-border bg-popover px-2 py-1 shadow-sm whitespace-nowrap">
      {labels?.[i] && (
        <div className="font-mono text-meta text-muted-foreground">
          {labels[i]}
        </div>
      )}
      <div className="font-mono text-meta font-semibold tabular-nums">
        {point.value}
        {valueLabel ? ` ${valueLabel}` : ""}
      </div>
    </div>
  );
}

/**
 * recharts area sparkline for the KPI strip, split into its own module so the
 * parent can lazy-load it with `next/dynamic` and keep recharts (heavy,
 * client-only) off the route's first-load bundle (F7).
 */
export function SparklineChart({
  data,
  labels,
  color = "var(--muted)",
  fill = false,
  interactive = false,
  valueLabel,
}: SparklineProps) {
  const gradId = useId();
  if (!data || data.length === 0) return null;
  const chartData = data.map((v, i) => ({ i, v }));
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={chartData} margin={{ top: 3, right: 1, bottom: 3, left: 1 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={fill ? 0.24 : 0} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={[min, max]} />
        {interactive && (
          <Tooltip
            isAnimationActive={false}
            // Pin the tooltip above the (very short) sparkline — only `y` is
            // fixed, so `x` keeps tracking the cursor. `allowEscapeViewBox.y`
            // lets it rise out of the 28px plot into the KPI cell instead of
            // dropping below and getting clipped by the grid's overflow.
            position={{ y: -44 }}
            allowEscapeViewBox={{ x: false, y: true }}
            wrapperStyle={{ zIndex: 20, outline: "none" }}
            cursor={{
              stroke: "var(--muted-foreground)",
              strokeWidth: 1,
              strokeDasharray: "2 3",
              strokeOpacity: 0.4,
            }}
            content={<SparkTooltip labels={labels} valueLabel={valueLabel} />}
          />
        )}
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          fill={`url(#${gradId})`}
          dot={false}
          activeDot={
            interactive
              ? {
                  r: 3,
                  fill: color,
                  stroke: "var(--background)",
                  strokeWidth: 1.5,
                }
              : false
          }
          animationDuration={500}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export default SparklineChart;
