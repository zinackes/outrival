"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { lineColor } from "./charts";

const TOOLTIP_STYLE = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
} as const;

/**
 * Shared multi-series line chart for the pricing / reviews / hiring tabs (all
 * plot one or more series over a "date" X axis). Isolated in its own module so
 * the tabs can lazy-load it with `next/dynamic` and keep recharts (~heavy,
 * client-only) off each route's first-load bundle (F7).
 */
export function MultiLineChart({
  data,
  seriesKeys,
  height,
  yDomain,
  yAllowDecimals = true,
  dot = false,
}: {
  data: Array<Record<string, number | string>>;
  seriesKeys: string[];
  height: number;
  yDomain?: [number, number];
  yAllowDecimals?: boolean;
  dot?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="date" stroke="var(--muted)" fontSize={11} />
        <YAxis
          stroke="var(--muted)"
          fontSize={11}
          allowDecimals={yAllowDecimals}
          {...(yDomain ? { domain: yDomain } : {})}
        />
        <ChartTooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {seriesKeys.map((k, i) => (
          <Line
            key={k}
            type="monotone"
            dataKey={k}
            stroke={lineColor(i)}
            strokeWidth={2}
            dot={dot}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export default MultiLineChart;
