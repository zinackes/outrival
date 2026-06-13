"use client";

import dynamic from "next/dynamic";
import type { SparklineProps } from "./sparkline-chart";

// Keep recharts (heavy, client-only) out of the dashboard route's first-load
// bundle — same lazy-load pattern as the other chart modules (F7). The fixed-
// size wrapper reserves the space so there's no layout shift while it loads.
const SparklineChart = dynamic(
  () => import("./sparkline-chart").then((m) => m.SparklineChart),
  { ssr: false },
);

export type { SparklineProps };

export function Sparkline(props: SparklineProps) {
  if (!props.data || props.data.length === 0) return null;
  return (
    <div style={{ width: props.w ?? 80, height: props.h ?? 24 }}>
      <SparklineChart {...props} />
    </div>
  );
}
