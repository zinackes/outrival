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

/**
 * Signals/day line chart, split out so the admin AI view can lazy-load recharts
 * via `next/dynamic` instead of bundling it on first load (F7).
 */
export function SignalsLineChart({
  data,
}: {
  data: Array<{ day: string; count: number }>;
}) {
  return (
    <div className="h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="day" stroke="var(--muted)" fontSize={10} />
          <YAxis stroke="var(--muted)" fontSize={11} allowDecimals={false} />
          <Tooltip contentStyle={{ background: "var(--bg)", border: "1px solid var(--border)" }} />
          <Line type="monotone" dataKey="count" stroke="var(--accent)" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default SignalsLineChart;
