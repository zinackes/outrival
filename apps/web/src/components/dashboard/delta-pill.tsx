import { ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type Delta = {
  delta: number;
  kind: "pos" | "neg" | "neutral";
  label: string;
};

// Signals in the current window vs the previous window of the same length.
export function computeDelta(curr: number, prev: number): Delta {
  if (prev === 0 && curr === 0) {
    return { delta: 0, kind: "neutral", label: "—" };
  }
  if (prev === 0) {
    return { delta: curr * 100, kind: "pos", label: "new" };
  }
  if (curr === 0) {
    return { delta: -100, kind: "neg", label: "−100%" };
  }
  const pct = ((curr - prev) / prev) * 100;
  const rounded = Math.round(pct);
  if (rounded === 0) return { delta: 0, kind: "neutral", label: "0%" };
  return {
    delta: rounded,
    kind: rounded > 0 ? "pos" : "neg",
    label: `${rounded > 0 ? "+" : ""}${rounded}%`,
  };
}

export function DeltaPill({ delta }: { delta: Delta }) {
  if (delta.kind === "neutral") {
    return (
      <span className="tabular-nums font-mono text-xs text-muted-foreground">
        {delta.label}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 tabular-nums font-mono text-xs",
        delta.kind === "pos" && "text-positive",
        delta.kind === "neg" && "text-critical",
      )}
    >
      {delta.kind === "pos" ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
      {delta.label}
    </span>
  );
}
