"use client";

import { Check, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useOnboardingStreaming } from "@/hooks/use-onboarding-streaming";

// Patch-25: progressive streaming after onboarding. Renders a per-competitor
// skeleton that fills in as the first analysis pass completes, instead of a
// single "it's ready" notification. Self-hides when there's no active analysis.
export function OnboardingAnalysisPanel({ onTick }: { onTick?: () => void }) {
  const { active, total, analyzed, competitors } = useOnboardingStreaming(onTick);
  if (!active || total === 0) return null;
  const done = analyzed >= total;

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {done ? (
            <Check size={15} className="text-positive" />
          ) : (
            <Loader2 size={15} className="animate-spin text-muted-foreground" />
          )}
          <span className="text-content font-semibold tracking-tight">
            {done ? "First analysis complete" : "Analyzing your competitors"}
          </span>
        </div>
        <span className="font-mono text-meta uppercase tracking-widest text-muted-foreground tabular-nums">
          {analyzed}/{total}
        </span>
      </div>

      <ul className="mt-3 grid gap-1.5">
        {competitors.map((c) => (
          <li
            key={c.id}
            className="flex items-center gap-2 text-sm animate-in fade-in duration-500"
          >
            {c.ready ? (
              <Check size={12} className="shrink-0 text-positive" />
            ) : (
              <Loader2 size={12} className="shrink-0 animate-spin text-muted-foreground" />
            )}
            <span className="truncate">{c.name}</span>
            <span className="ml-auto text-meta capitalize text-muted-foreground">
              {c.ready ? "ready" : "analyzing…"}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
