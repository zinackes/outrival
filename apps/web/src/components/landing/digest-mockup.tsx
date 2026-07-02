"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Signal = {
  sev: "critical" | "high" | "medium" | "low";
  cat: string;
  text: ReactNode;
  time: string;
};

const SEV_DOT: Record<Signal["sev"], string> = {
  critical: "bg-critical",
  high: "bg-high",
  medium: "bg-medium",
  low: "bg-low",
};

// Fabricated example data → fictional competitors (never real brands), so no false
// fact is attributed to a real company.
const SIGNALS: Signal[] = [
  {
    sev: "critical",
    cat: "pricing",
    text: (
      <span>
        <b>Vantage</b> drops Business from <b>$16 → $14/seat</b>. Old plan
        removed from the pricing page.
      </span>
    ),
    time: "2h ago",
  },
  {
    sev: "high",
    cat: "hiring",
    text: (
      <span>
        <b>Lumen</b> opens 3 &quot;AI Research&quot; roles in Paris. First R&amp;D
        presence in the EU.
      </span>
    ),
    time: "6h ago",
  },
  {
    sev: "high",
    cat: "product",
    text: (
      <span>
        <b>Vantage</b> ships &quot;Cycles 2.0&quot; — planning overhaul plus
        native GitHub integration.
      </span>
    ),
    time: "9h ago",
  },
  {
    sev: "medium",
    cat: "reviews",
    text: (
      <span>
        <b>Cobalt</b> drops 4.4 → 4.2 on G2 (38 new reviews, sentiment ≤ 0).
      </span>
    ),
    time: "yesterday",
  },
  {
    sev: "medium",
    cat: "content",
    text: (
      <span>
        <b>Lumen</b> publishes &quot;The end of all-in-one&quot; — vertical
        repositioning.
      </span>
    ),
    time: "yesterday",
  },
  {
    sev: "low",
    cat: "funding",
    text: (
      <span>
        <b>Beacon</b> announces Series E $200M, valuation $1.6B.
      </span>
    ),
    time: "2d",
  },
];

export function DigestMockup({ animate = true }: { animate?: boolean }) {
  const [visible, setVisible] = useState(SIGNALS.length);

  useEffect(() => {
    if (!animate) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion) return;
    setVisible(0);
  }, [animate]);

  useEffect(() => {
    if (!animate || visible >= SIGNALS.length) return;
    const t = setTimeout(
      () => setVisible((n) => n + 1),
      visible === 0 ? 300 : 240,
    );
    return () => clearTimeout(t);
  }, [visible, animate]);

  return (
    <div
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/10 dark:shadow-black/40"
      role="img"
      aria-label="Outrival weekly digest — illustrative sample"
    >
      <div className="flex items-center justify-between border-b border-border bg-background-2 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-content font-semibold">
            Out<span className="text-primary">rival</span>
          </span>
          <span className="font-mono text-meta text-text-subtle">
            / weekly digest
          </span>
        </div>
        <div className="flex gap-1 font-mono text-meta">
          <span className="rounded bg-surface-3 px-2 py-1 text-foreground">
            This week
          </span>
          <span className="rounded px-2 py-1 text-text-subtle">Previous</span>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <div className="text-sm font-semibold">Week 21 — 12 signals</div>
          <div className="text-xs text-text-subtle">
            May 19 → 25, 2026 · 4 competitors
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href="#">See all</a>
        </Button>
      </div>

      {/* Digest "temperature" + one-line AI summary — mirrors the real weekly email. */}
      <div className="flex items-start gap-2.5 border-y border-border bg-background-2 px-4 py-2.5">
        <span className="mt-1 size-2 shrink-0 rounded-full bg-high" />
        <p className="text-xs leading-relaxed text-text-muted">
          <span className="font-medium text-foreground">Warm week.</span> One
          pricing move worth acting on and an early hiring signal in the EU.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
        {[
          { label: "Signals", value: "12", delta: "+4" },
          { label: "Critical", value: "2" },
          { label: "Changes", value: "847" },
          { label: "Sources", value: "36" },
        ].map((s) => (
          <div key={s.label} className="bg-surface px-3 py-2.5">
            <div className="text-meta font-medium text-text-subtle">
              {s.label}
            </div>
            <div className="mt-0.5 flex items-baseline gap-1 text-lg font-semibold tabular-nums">
              {s.value}
              {s.delta && (
                <span className="text-xs text-positive">{s.delta}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="max-h-[290px] divide-y divide-border overflow-y-auto">
        {SIGNALS.slice(0, visible).map((s, i) => (
          <div key={i} className="flex items-center gap-2.5 px-4 py-2.5 text-xs">
            <span className={`size-2 shrink-0 rounded-full ${SEV_DOT[s.sev]}`} />
            <span className="w-16 shrink-0">
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-meta font-medium uppercase tracking-wide text-text-subtle">
                {s.cat}
              </span>
            </span>
            <span className="flex-1 text-text-muted [&_b]:text-foreground">
              {s.text}
            </span>
            <span className="ml-auto shrink-0 font-mono text-meta text-text-subtle">
              {s.time}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
