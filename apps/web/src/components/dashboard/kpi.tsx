import { Sparkline } from "./sparkline";

type DeltaKind = "pos" | "neg" | "neutral";

interface KpiProps {
  label: string;
  value: string | number;
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

export function Kpi({
  label,
  value,
  suffix,
  delta,
  deltaKind = "pos",
  meta,
  spark,
  sparkColor,
  sparkLabels,
  sparkValueLabel,
}: KpiProps) {
  const arrow = deltaKind === "pos" ? "▲" : deltaKind === "neg" ? "▼" : "·";
  return (
    <div className="px-5 py-4 flex flex-col gap-2 relative min-w-0">
      <div className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase flex items-center justify-between gap-2">
        <span>{label}</span>
        {delta && (
          <span
            className={`font-mono text-[11px] inline-flex items-center gap-0.5 ${DELTA_COLOR[deltaKind]}`}
          >
            {arrow} {delta}
          </span>
        )}
      </div>
      <div className="font-bold text-[30px] tracking-tighter leading-none flex items-baseline gap-2">
        <span className="tabular-nums font-mono">{value}</span>
        {suffix && (
          <span className="text-[13px] font-sans font-medium text-muted-foreground tracking-normal">
            {suffix}
          </span>
        )}
      </div>
      {meta && (
        <div className="text-muted-foreground/80 text-xs">{meta}</div>
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
