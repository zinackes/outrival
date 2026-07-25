"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { ChartCursorLine, chartTooltipMotion } from "@/components/dashboard/chart-motion";

// Share-of-voice over time, one line per subject (self + top competitors). Split into
// its own module so the view can lazy-load it with next/dynamic and keep recharts
// (heavy, client-only) off the route's first-load bundle — same pattern as Trends.
//
// Colours are handed in by the view rather than picked here, so a brand carries ONE
// colour across the board rows, its line, and the names on each question. The chart
// used to run its own palette in its own order, which meant the swatch beside a brand
// and the line for that brand were unrelated hues.
//
// No legend: the board sits directly above with the same swatch beside every name, and
// a second list of the same six brands is the kind of duplication this page had too
// much of already.
export function AiVisibilityChart({
  keys,
  data,
  colors,
  selfName,
}: {
  keys: string[];
  data: Record<string, string | number>[];
  colors: Record<string, string>;
  selfName?: string | null;
}) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 4" vertical={false} />
          <XAxis
            dataKey="t"
            stroke="var(--border)"
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            tickLine={false}
            tickMargin={8}
          />
          <YAxis
            stroke="var(--border)"
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={48}
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            {...chartTooltipMotion}
            cursor={<ChartCursorLine />}
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--muted)", marginBottom: 4 }}
            itemSorter={(item) => -Number(item.value ?? 0)}
            formatter={(v) => (v == null ? "" : `${v}%`)}
          />
          {keys.map((k) => {
            const isSelf = k === selfName;
            return (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                stroke={colors[k] ?? "var(--muted)"}
                strokeWidth={isSelf ? 2.5 : 1.5}
                strokeOpacity={isSelf ? 1 : 0.75}
                // The value that matters is the latest one, so only that point carries
                // a dot; a dot on every reading turns six lines into a bead curtain.
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
                connectNulls
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default AiVisibilityChart;
