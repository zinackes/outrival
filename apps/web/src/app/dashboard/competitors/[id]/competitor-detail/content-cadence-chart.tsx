"use client";

import { useId } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartCursorBand,
  chartTooltipCardMotion,
  chartTooltipMotion,
} from "@/components/dashboard/chart-motion";
import { cn } from "@/lib/utils";
import type { ContentSummary } from "@/lib/api";

/**
 * Items per month, stacked by source (Content Intelligence v2 P4).
 *
 * It was twelve CSS columns carrying a `title` attribute, so reading a month meant
 * waiting a second for the browser's own tooltip and getting one line of text with
 * no breakdown. recharts like every other plot in the product: one snapping cursor
 * band, one card that names each source's share, and the same hover motion the
 * pricing and hiring charts use.
 *
 * The month still running is drawn HATCHED, not dropped: the cadence detector never
 * evaluates a partial month (comparing three days against three full ones reports a
 * freeze at every competitor on the 3rd), and a chart that silently omitted it would
 * leave the reader wondering where this month went.
 */

export interface CadenceSource {
  key: string;
  label: string;
  color: string;
}

const MONTH_SHORT = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const MONTH_LONG = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

interface Datum {
  month: string;
  short: string;
  label: string;
  partial: boolean;
  total: number;
  [source: string]: string | number | boolean;
}

function CadenceTooltip({
  active,
  payload,
  sources,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Datum }>;
  sources: CadenceSource[];
}) {
  const datum = active ? payload?.[0]?.payload : undefined;
  if (!datum) return null;

  return (
    <div
      className={cn(
        "pointer-events-none min-w-[9.5rem] rounded-md border border-border bg-popover px-2.5 py-2 shadow-sm",
        chartTooltipCardMotion,
      )}
    >
      <div className="text-meta text-muted-foreground">{datum.label}</div>
      {datum.total === 0 ? (
        <div className="mt-1 text-meta font-semibold">Nothing published</div>
      ) : (
        <>
          <div className="mt-1 flex flex-col gap-0.5">
            {sources.map((s) => {
              const n = Number(datum[s.key] ?? 0);
              if (n === 0) return null;
              return (
                <div key={s.key} className="flex items-center gap-2 text-meta">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-[2px]"
                    style={{ background: s.color }}
                  />
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className="ml-auto font-semibold tabular-nums">{n}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex items-center gap-2 border-t border-border pt-1 text-meta">
            <span className="text-muted-foreground">Total</span>
            <span className="ml-auto font-semibold tabular-nums">{datum.total}</span>
          </div>
        </>
      )}
      {datum.partial && (
        <div className="mt-1 text-meta text-muted-foreground">Month still running</div>
      )}
    </div>
  );
}

export function CadenceChart({
  cadence,
  sources,
  height = 200,
}: {
  cadence: ContentSummary["cadence"];
  /** Only the sources that ever published, in stacking order. */
  sources: CadenceSource[];
  height?: number;
}) {
  // React's ids carry colons, which a FuncIRI reference cannot be trusted with.
  const uid = useId().replace(/:/g, "");

  const data: Datum[] = cadence.map((m) => {
    const at = new Date(`${m.month}-01T00:00:00Z`);
    const row: Datum = {
      month: m.month,
      short: MONTH_SHORT.format(at),
      label: MONTH_LONG.format(at),
      partial: m.partial,
      total: m.total,
    };
    for (const s of sources) row[s.key] = m.bySource[s.key] ?? 0;
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          {sources.map((s) => (
            // Same series colour, opened up: the running month has to read as the
            // same measurement as its neighbours, only unfinished.
            <pattern
              key={s.key}
              id={`${uid}-${s.key}`}
              width={4}
              height={4}
              patternTransform="rotate(45)"
              patternUnits="userSpaceOnUse"
            >
              <rect width={4} height={4} fill={`color-mix(in oklab, ${s.color} 26%, transparent)`} />
              <line x1={0} y1={0} x2={0} y2={4} stroke={s.color} strokeWidth={1.25} />
            </pattern>
          ))}
        </defs>
        {/* Horizontal only: a vertical rule per month fences the plot without
            helping anyone read a count off it. */}
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="short"
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
          allowDecimals={false}
          width={28}
        />
        <Tooltip
          {...chartTooltipMotion}
          cursor={<ChartCursorBand />}
          content={<CadenceTooltip sources={sources} />}
        />
        {sources.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            stackId="month"
            // Only the topmost band is rounded, so the stack reads as one column.
            radius={i === sources.length - 1 ? [3, 3, 0, 0] : undefined}
            animationDuration={400}
          >
            {data.map((d) => (
              <Cell
                key={d.month}
                fill={d.partial ? `url(#${uid}-${s.key})` : s.color}
                stroke={d.partial ? s.color : undefined}
                strokeWidth={d.partial ? 1 : 0}
              />
            ))}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export default CadenceChart;
