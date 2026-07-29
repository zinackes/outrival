"use client";

import { useEffect, useState } from "react";
import { CheckIcon, ClockIcon, SpinnerIcon, MinusIcon } from "@/components/icons";
import type { BattleCardEvidence } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { TabCard } from "@/components/outrival/tab-shell";
import { cn } from "@/lib/utils";
import { EVIDENCE_LABELS } from "./evidence";
import { SECTION_META } from "./sections";

// The four states a run can be observed in, in order. Each one is READ, never timed:
// "queued" is the pg-boss job row still unclaimed, and the three working stages come
// from the ai_runs the worker writes as it finishes each pass. The previous version
// advanced these on an elapsed-time schedule, so it walked confidently through
// "Rendering the PDF" for runs that no worker had even picked up — which is exactly
// what happened on prod for six hours on 2026-07-29.
const STAGES = [
  { key: "queued", label: "Queued" },
  { key: "gathering", label: "Writing the card" },
  { key: "checking", label: "Checking it against the evidence" },
  { key: "rendering", label: "Rendering the PDF" },
] as const;

export type BuildStage = (typeof STAGES)[number]["key"];

// How fast the evidence rows appear. Presentational only — the list arrives in one
// response; staggering it makes the gather stage legible instead of instantaneous.
const ROW_STEP_MS = 320;

export function BattleCardBuild({
  startedAt,
  firstTime,
  evidence,
  competitorName,
  stage,
}: {
  startedAt: number;
  firstTime: boolean;
  evidence: BattleCardEvidence | null;
  competitorName: string;
  /** The observed stage. Null when the queue could not be read — we then say we are
   *  working and claim no stage at all, rather than inventing one. */
  stage: BuildStage | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));

  const active = stage ? STAGES.findIndex((s) => s.key === stage) : -1;
  const queued = stage === "queued";
  // "Longer than usual" means different things for a run nobody has started and one
  // that is working: a queue wait is the fleet being busy, not this card being hard.
  const slow = queued ? elapsed > 90 : elapsed > (firstTime ? 60 : 30);

  const sources = evidence?.sources ?? [];
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (sources.length === 0) return;
    setShown(0);
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= sources.length) clearInterval(t);
    }, ROW_STEP_MS);
    return () => clearInterval(t);
  }, [sources.length]);

  return (
    <TabCard>
      <div className="flex flex-col gap-3 px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {/* A clock, not a spinner, while the job is only waiting: a spinner on a
              job no worker has opened claims work that is not happening. */}
          {queued ? (
            <ClockIcon size={16} className="shrink-0 text-muted-foreground" />
          ) : (
            <SpinnerIcon size={16} className="shrink-0 animate-spin text-primary" />
          )}
          <span className="text-content font-medium">
            {active >= 0 ? STAGES[active]!.label : "Working on it"}
          </span>
          {queued && (
            <span className="text-sm text-muted-foreground">
              no worker has picked it up yet
            </span>
          )}
          <span className="ml-auto font-mono text-meta tabular-nums text-muted-foreground">
            {formatElapsed(elapsed)}
          </span>
        </div>
        <div className="flex gap-1" aria-hidden>
          {STAGES.map((s, i) => (
            <span
              key={s.key}
              className={cn(
                "h-0.5 flex-1 rounded-full transition-colors duration-300",
                i < active ? "bg-positive" : i === active ? "bg-primary" : "bg-border",
              )}
            />
          ))}
        </div>
      </div>

      <section className="flex flex-col gap-3 p-5">
        <div>
          <h3 className="text-content font-semibold tracking-tight leading-tight">Evidence</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Only what we have verified on {competitorName} goes into the card.
          </p>
        </div>
        {sources.length === 0 ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {sources.map((s, i) => (
              <li
                key={s.kind}
                className={cn(
                  "flex items-center gap-2.5 py-2 text-sm transition-all duration-200 first:pt-0 last:pb-0",
                  i < shown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
                  !s.present && "text-muted-foreground",
                )}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  {s.present ? (
                    <CheckIcon size={16} className="text-positive" />
                  ) : (
                    <MinusIcon size={16} className="text-muted-foreground" />
                  )}
                </span>
                <span>{EVIDENCE_LABELS[s.kind]}</span>
                <span className="ml-auto text-right font-mono text-meta text-muted-foreground">
                  {s.present ? (s.detail ?? "captured") : "not tracked, skipped"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* The card's own frame, present from the first second: the wait happens inside
          the artefact rather than in place of it. */}
      <section className="grid grid-cols-1 gap-x-8 gap-y-6 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {SECTION_META.slice(0, 3).map((s) => (
          <SectionFrame key={s.key} meta={s} lines={3} />
        ))}
      </section>

      <section className="flex flex-col gap-3 p-5">
        <SectionFrame meta={SECTION_META[3]!} lines={4} />
      </section>

      <section className="grid grid-cols-1 gap-x-8 gap-y-6 p-5 sm:grid-cols-2">
        {SECTION_META.slice(4).map((s) => (
          <SectionFrame key={s.key} meta={s} lines={2} />
        ))}
      </section>

      <p className="px-5 py-3.5 text-sm text-muted-foreground">{footer(queued, slow, firstTime)}</p>
    </TabCard>
  );
}

function footer(queued: boolean, slow: boolean, firstTime: boolean): string {
  if (queued) {
    return slow
      ? "Still waiting for a worker. The fleet is busy — this card has not started yet, and it will run as soon as a slot frees up. You can leave this page and the bell will tell you either way."
      : "Waiting for a worker to pick this up. You can leave this page and the bell will tell you when it is ready.";
  }
  if (slow) {
    return "Still working. This one is taking longer than usual. You can leave this page and we will drop a notification in the bell when it is ready.";
  }
  return firstTime
    ? "The first card for a competitor takes longer, because it builds the AI summary first. You can leave this page and we will notify you."
    : "You can leave this page. The bell will tell you when it is ready, and the PDF finishes a few seconds after the text lands.";
}

/** Seconds up to a minute, then m:ss — a queue wait can run for minutes, and "412s"
 *  is a number the reader has to convert before it means anything. */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function SectionFrame({
  meta,
  lines,
}: {
  meta: (typeof SECTION_META)[number];
  lines: number;
}) {
  const Icon = meta.icon;
  return (
    <div className="flex flex-col gap-2.5">
      <h3
        className={cn(
          "flex items-center gap-2 text-content font-semibold tracking-tight leading-tight",
          meta.color,
        )}
      >
        <Icon size={16} className={cn("shrink-0", !meta.color && "text-muted-foreground")} />
        {meta.title}
      </h3>
      <div className="flex flex-col gap-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-3" style={{ width: `${92 - i * 11}%` }} />
        ))}
      </div>
      <p className="font-mono text-meta text-muted-foreground">from {meta.from}</p>
    </div>
  );
}
