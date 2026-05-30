"use client";

import { useRef, useState } from "react";

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

  if (!data || data.length === 0) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = w / Math.max(1, data.length - 1);
  const pts = data.map(
    (v, i) =>
      [i * step, h - ((v - min) / range) * (h - 4) - 2] as [number, number],
  );
  const d = pts
    .map(
      (p, i) =>
        (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1),
    )
    .join(" ");

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
        <path
          d={d + ` L ${w} ${h} L 0 ${h} Z`}
          fill={color}
          opacity="0.15"
        />
      )}
      <path
        d={d}
        stroke={color}
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {interactive && hoveredPt && (
        <>
          <line
            x1={hoveredPt[0]}
            y1={0}
            x2={hoveredPt[0]}
            y2={h}
            stroke="var(--muted-foreground)"
            strokeWidth="0.5"
            strokeDasharray="2 2"
            opacity="0.55"
          />
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
          className="pointer-events-none absolute z-20 rounded border border-border bg-popover px-2 py-1 shadow-sm whitespace-nowrap"
          style={{
            left: tooltipLeft,
            bottom: h + 6,
            transform: tooltipFlip ? "translateX(-100%)" : "translateX(-50%)",
          }}
        >
          {labels?.[hover] && (
            <div className="font-mono text-[9px] text-muted-foreground uppercase tracking-widest">
              {labels[hover]}
            </div>
          )}
          <div className="font-mono text-[11px] font-semibold tabular-nums">
            {data[hover]}
            {valueLabel ? ` ${valueLabel}` : ""}
          </div>
        </div>
      )}
    </div>
  );
}
