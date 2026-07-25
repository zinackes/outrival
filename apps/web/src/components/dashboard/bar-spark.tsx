"use client";

import dynamic from "next/dynamic";
import type { BarSparkProps } from "./bar-spark-chart";

// Keep recharts (heavy, client-only) out of the dashboard route's first-load bundle,
// same lazy-load pattern as the area sparkline (F7). The fixed-height wrapper reserves
// the space so there's no layout shift while it loads.
const BarSparkChart = dynamic(
  () => import("./bar-spark-chart").then((m) => m.BarSparkChart),
  { ssr: false },
);

export type { BarSparkProps };

export function BarSpark(props: BarSparkProps) {
  if (!props.data || props.data.length === 0) return null;
  return (
    <div style={{ height: props.h ?? 26 }} className="w-full">
      <BarSparkChart {...props} />
    </div>
  );
}
