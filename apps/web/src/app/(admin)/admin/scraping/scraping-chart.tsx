"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

/**
 * Per-source failure/proxy bar chart, split out so the admin scraping view can
 * lazy-load recharts via `next/dynamic` instead of bundling it on first load (F7).
 */
export function FailureBarChart({
  data,
}: {
  data: Array<{ name: string; failure: number; proxy: number }>;
}) {
  return (
    <div className="h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="name" stroke="var(--muted)" fontSize={10} />
          <YAxis stroke="var(--muted)" fontSize={11} unit="%" />
          <Tooltip contentStyle={{ background: "var(--bg)", border: "1px solid var(--border)" }} />
          <Bar dataKey="failure" fill="var(--critical)" name="failure %" />
          <Bar dataKey="proxy" fill="var(--accent)" name="proxy %" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default FailureBarChart;
