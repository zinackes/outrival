import { ArrowDown, ArrowUp, Minus, type LucideIcon } from "lucide-react";
import { Sparkline } from "./sparkline";

type DeltaKind = "pos" | "neg" | "neutral";

interface KpiProps {
  label: string;
  value: string | number;
  valueClassName?: string;
  suffix?: string;
  delta?: string;
  deltaKind?: DeltaKind;
  meta?: string;
  spark?: number[];
  sparkColor?: string;
  sparkLabels?: string[];
  sparkValueLabel?: string;
}

const DELTA_COLOR: Record<DeltaKind, string> = {
  pos: "text-positive",
  neg: "text-critical",
  neutral: "text-muted-foreground",
};

const DELTA_ICON: Record<DeltaKind, LucideIcon> = {
  pos: ArrowUp,
  neg: ArrowDown,
  neutral: Minus,
};

export function Kpi({
  label,
  value,
  valueClassName,
  suffix,
  delta,
  deltaKind = "pos",
  meta,
  spark,
  sparkColor,
  sparkLabels,
  sparkValueLabel,
}: KpiProps) {
  const DeltaIcon = DELTA_ICON[deltaKind];
  return (
    <div className="px-5 py-4 flex flex-col gap-2 relative min-w-0">
      <div className="font-mono text-dense text-muted-foreground flex items-center justify-between gap-2">
        <span>{label}</span>
        {delta && (
          <span
            className={`font-mono text-meta inline-flex items-center gap-1 ${DELTA_COLOR[deltaKind]}`}
          >
            <DeltaIcon size={11} strokeWidth={2.25} aria-hidden />
            {delta}
          </span>
        )}
      </div>
      <div className="font-semibold text-stat tracking-tighter leading-none flex items-baseline gap-2">
        <span className={`tabular-nums font-mono ${valueClassName ?? ""}`}>
          {value}
        </span>
        {suffix && (
          <span className="text-dense font-sans font-medium text-muted-foreground tracking-normal">
            {suffix}
          </span>
        )}
      </div>
      {meta && (
        <div className="text-muted-foreground text-xs">{meta}</div>
      )}
      {spark && (
        <div className="mt-1 h-7">
          <Sparkline
            data={spark}
            labels={sparkLabels}
            valueLabel={sparkValueLabel}
            w={220}
            h={28}
            color={sparkColor ?? "var(--muted)"}
            fill
            interactive
          />
        </div>
      )}
    </div>
  );
}
