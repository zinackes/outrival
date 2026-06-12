"use client";

import { useId, useRef, useState } from "react";

interface SparklineProps {
  data: number[];
  labels?: string[];
  w?: number;
  h?: number;
  color?: string;
  fill?: boolean;
  interactive?: boolean;
  valueLabel?: string;
}

// Catmull-Rom → cubic Bézier smoothing. Gentle tension (no overshoot) so a
// sparse signal trend reads as a curve, not a zig-zag.
function smoothPath(pts: [number, number][]): string {
  const first = pts[0];
  if (!first) return "";
  if (pts.length < 3)
    return pts
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
      .join(" ");
  const t = 0.18;
  const d = [`M ${first[0].toFixed(1)} ${first[1].toFixed(1)}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i];
    const p2 = pts[i + 1];
    if (!p1 || !p2) continue;
    const p0 = pts[i - 1] ?? p1;
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    const c1y = p1[1] + (p2[1] - p0[1]) * t;
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    const c2y = p2[1] - (p3[1] - p1[1]) * t;
    d.push(
      `C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`,
    );
  }
  return d.join(" ");
}

export function Sparkline({
  data,
  labels,
  w = 80,
  h = 24,
  color = "var(--muted)",
  fill = false,
  interactive = false,
  valueLabel,
}: SparklineProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const gradId = useId();

  if (!data || data.length === 0) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = w / Math.max(1, data.length - 1);
  const pts = data.map(
    (v, i) =>
      [i * step, h - ((v - min) / range) * (h - 4) - 2] as [number, number],
  );
  const d = smoothPath(pts);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!interactive || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = Math.round(x / step);
    const clamped = Math.max(0, Math.min(data.length - 1, idx));
    setHover(clamped);
  }

  const hoveredPt = hover !== null ? pts[hover] : null;
  const tooltipLeft = hoveredPt ? hoveredPt[0] : 0;
  const tooltipFlip = tooltipLeft > w * 0.65;

  const svg = (
    <svg
      width={w}
      height={h}
      style={{ display: "block", overflow: "visible" }}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      {fill && (
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.24" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
      )}
      {fill && (
        <path d={`${d} L ${w} ${h} L 0 ${h} Z`} fill={`url(#${gradId})`} />
      )}
      <path
        d={d}
        stroke={color}
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {interactive && hoveredPt && (
        <>
          <line
            x1={hoveredPt[0]}
            y1={2}
            x2={hoveredPt[0]}
            y2={h}
            stroke="var(--muted-foreground)"
            strokeWidth="1"
            strokeDasharray="2 3"
            opacity="0.4"
          />
          {/* soft halo + crisp point */}
          <circle cx={hoveredPt[0]} cy={hoveredPt[1]} r={5.5} fill={color} opacity="0.16" />
          <circle
            cx={hoveredPt[0]}
            cy={hoveredPt[1]}
            r={3}
            fill={color}
            stroke="var(--background)"
            strokeWidth="1.5"
          />
        </>
      )}
    </svg>
  );

  if (!interactive) return svg;

  return (
    <div
      ref={wrapRef}
      className="relative"
      style={{ width: w, height: h }}
    >
      {svg}
      {hover !== null && hoveredPt && (
        <div
          className="pointer-events-none absolute z-20 rounded-md border border-border bg-popover px-2 py-1 shadow-sm whitespace-nowrap"
          style={{
            left: tooltipLeft,
            bottom: h + 6,
            transform: tooltipFlip ? "translateX(-100%)" : "translateX(-50%)",
          }}
        >
          {labels?.[hover] && (
            <div className="font-mono text-meta text-muted-foreground">
              {labels[hover]}
            </div>
          )}
          <div className="font-mono text-meta font-semibold tabular-nums">
            {data[hover]}
            {valueLabel ? ` ${valueLabel}` : ""}
          </div>
        </div>
      )}
    </div>
  );
}
