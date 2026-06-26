import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowRight, Info, Minus, type LucideIcon } from "lucide-react";
import { Sparkline } from "./sparkline";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type DeltaKind = "pos" | "neg" | "neutral";

interface KpiProps {
  label: string;
  value: string | number;
  valueClassName?: string;
  suffix?: string;
  delta?: string;
  deltaKind?: DeltaKind;
  meta?: string;
  /** Optional explainer shown via an info icon next to the label. Needs a
   *  TooltipProvider ancestor. */
  hint?: string;
  /** Makes the whole cell a link (e.g. "Critical pending" → filtered Signals). */
  href?: string;
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
  hint,
  href,
  spark,
  sparkColor,
  sparkLabels,
  sparkValueLabel,
}: KpiProps) {
  const DeltaIcon = DELTA_ICON[deltaKind];
  const className = `group/kpi px-5 py-4 flex flex-col gap-2 relative min-w-0${
    href
      ? " outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/40"
      : ""
  }`;
  const body = (
    <>
      <div className="font-mono text-dense text-muted-foreground flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1">
          {label}
          {href && (
            <ArrowRight
              size={11}
              className="opacity-0 transition-opacity group-hover/kpi:opacity-100"
              aria-hidden
            />
          )}
          {hint && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`About ${label}`}
                  className="inline-flex cursor-help text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Info size={12} aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-[240px] font-sans text-xs font-normal normal-case tracking-normal">
                {hint}
              </TooltipContent>
            </Tooltip>
          )}
        </span>
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
    </>
  );
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
