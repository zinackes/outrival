"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type Digest, type DigestSection } from "@/lib/api";
import { digestsQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ArrowRight, Check, Circle, type LucideIcon } from "lucide-react";

const URGENCY_META: Record<
  DigestSection["urgency"],
  { icon: LucideIcon; label: string; tone: "critical" | "high" | "positive" }
> = {
  action_required: { icon: Circle, label: "Action required", tone: "critical" },
  watch: { icon: Circle, label: "Watch", tone: "high" },
  fyi: { icon: Circle, label: "FYI", tone: "positive" },
};

const TONE_TEXT = {
  critical: "text-critical",
  high: "text-high",
  positive: "text-positive",
} as const;

export function DigestsList() {
  const digestsQ = useQuery(digestsQuery());
  const digests = digestsQ.data ?? null;
  const [active, setActive] = useState<Digest | null>(null);

  if (digestsQ.error)
    return (
      <p className="text-sm text-muted-foreground">Error: {String(digestsQ.error)}</p>
    );
  if (digests === null)
    return (
      <ul className="flex flex-col gap-3" aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i}>
            <div className="w-full rounded-md bg-card border border-border p-4 flex justify-between items-center gap-3">
              <div className="flex-1 flex flex-col gap-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-3 w-12" />
            </div>
          </li>
        ))}
      </ul>
    );
  if (digests.length === 0)
    return (
      <Card className="p-6 text-sm text-center text-muted-foreground border-dashed">
        No digest yet. The next one is generated every Monday morning.
      </Card>
    );

  if (active) {
    const content = active.content;
    return (
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setActive(null)}
          className="mb-4 -ml-2"
        >
          <ArrowLeft className="size-4" /> Back
        </Button>
        <h2 className="text-xl font-bold mb-1 font-[var(--font-syne)]">
          Week of {active.weekStart} to {active.weekEnd}
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          Temperature · {content.temperature}
        </p>

        <Card className="p-4 mb-6">
          <h3 className="text-sm font-semibold mb-2">TL;DR</h3>
          <ul className="text-sm list-disc pl-5">
            {content.tldr.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </Card>

        {(["action_required", "watch", "fyi"] as const).map((urgency) => {
          const items = content.sections.filter((s) => s.urgency === urgency);
          if (items.length === 0) return null;
          const meta = URGENCY_META[urgency];
          const UrgencyIcon = meta.icon;
          return (
            <div key={urgency} className="mb-6">
              <h3
                className={`flex items-center gap-2 text-base font-bold mb-2 font-[var(--font-syne)] ${TONE_TEXT[meta.tone]}`}
              >
                <UrgencyIcon className="size-3 fill-current" /> {meta.label}
              </h3>
              <ul className="flex flex-col gap-2">
                {items.map((s, i) => (
                  <li key={i}>
                    <Card className="p-3">
                      <div className="text-xs uppercase tracking-wide mb-1 text-muted-foreground">
                        {s.competitor} · {s.category}
                      </div>
                      <p className="text-sm mb-1">{s.insight}</p>
                      <p className="flex gap-1 text-sm text-primary">
                        <ArrowRight className="size-3.5 mt-0.5 shrink-0" />
                        {s.so_what}
                      </p>
                    </Card>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {digests.map((d) => (
        <li key={d.id}>
          <button
            type="button"
            onClick={() => setActive(d)}
            className="w-full text-left rounded-md bg-card border border-border p-4 hover:border-border-strong transition-colors"
          >
            <div className="flex justify-between items-center">
              <div>
                <div className="font-medium text-sm">Week of {d.weekStart}</div>
                <div className="text-xs mt-1 text-muted-foreground">
                  Temperature · {d.content.temperature} · {d.content.sections.length} signals
                </div>
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                {d.sentAt ? (
                  <>
                    <Check className="size-3" /> sent
                  </>
                ) : (
                  "not sent"
                )}
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
