"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SAMPLE_DIGEST } from "@/lib/sample-digest";

// The landing preview reads the SAME real digest fixture the /sample page renders
// — an excerpt of it, not a fabricated cast. Its dot marks the section's urgency.
const URGENCY_DOT: Record<string, string> = {
  action_required: "bg-critical",
  watch: "bg-high",
  fyi: "bg-low",
};

const TEMP_WORD: Record<string, string> = {
  low: "Calm",
  moderate: "Warm",
  high: "Hot",
};

const { weekLabel, competitorCount, content } = SAMPLE_DIGEST;
// A compact teaser — the top handful of the week's signals.
const ROWS = content.sections.slice(0, 6);
const CRIT_COUNT = content.sections.filter(
  (s) => s.urgency === "action_required",
).length;

export function DigestMockup({ animate = true }: { animate?: boolean }) {
  const [visible, setVisible] = useState(ROWS.length);

  useEffect(() => {
    if (!animate) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion) return;
    setVisible(0);
  }, [animate]);

  useEffect(() => {
    if (!animate || visible >= ROWS.length) return;
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
      aria-label="Outrival weekly digest — excerpt of a real sample"
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
          <div className="text-sm font-semibold">
            {content.sections.length} signals
          </div>
          <div className="text-xs text-text-subtle">
            {weekLabel}
            {competitorCount > 0 && ` · ${competitorCount} competitors`}
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href="/sample">See all</a>
        </Button>
      </div>

      {/* Digest "temperature" + one-line AI summary — mirrors the real weekly email. */}
      <div className="flex items-start gap-2.5 border-y border-border bg-background-2 px-4 py-2.5">
        <span className="mt-1 size-2 shrink-0 rounded-full bg-high" />
        <p className="text-xs leading-relaxed text-text-muted">
          <span className="font-medium text-foreground">
            {TEMP_WORD[content.temperature] ?? "Warm"} week.
          </span>{" "}
          {content.tldr[0]}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-px border-b border-border bg-border">
        {[
          { label: "Signals", value: String(content.sections.length) },
          { label: "Critical", value: String(CRIT_COUNT) },
        ].map((s) => (
          <div key={s.label} className="bg-surface px-3 py-2.5">
            <div className="text-meta font-medium text-text-subtle">
              {s.label}
            </div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums">
              {s.value}
            </div>
          </div>
        ))}
      </div>

      <div className="max-h-[290px] divide-y divide-border overflow-y-auto">
        {ROWS.slice(0, visible).map((s, i) => (
          <div key={i} className="flex items-center gap-2.5 px-4 py-2.5 text-xs">
            <span
              className={`size-2 shrink-0 rounded-full ${URGENCY_DOT[s.urgency] ?? "bg-low"}`}
            />
            <span className="w-16 shrink-0">
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-meta font-medium uppercase tracking-wide text-text-subtle">
                {s.category}
              </span>
            </span>
            <span className="flex-1 truncate text-text-muted">
              <b className="text-foreground">{s.competitor}</b> — {s.insight}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
