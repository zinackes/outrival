"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CircleNotchIcon, MinusIcon } from "@phosphor-icons/react/ssr";
import type { BattleCardEvidence } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { TabCard } from "@/components/outrival/tab-shell";
import { cn } from "@/lib/utils";
import { EVIDENCE_LABELS } from "./evidence";
import { SECTION_META } from "./sections";

// The job's real shape: gather the context, write the card, re-read it against that
// same context (revision + the faithfulness gate), then render the PDF. The AI writes
// all six sections in one call, so the frames below fill together when the card lands,
// not one at a time — nothing here claims a section is finished before it is.
const STAGES = ["Gathering evidence", "Writing the card", "Checking it against the evidence", "Rendering the PDF"] as const;

// Paced off elapsed time, like the step list this replaces: the worker writes the row
// only at the end, so there is no progress to read. A first card is far slower (it
// builds the AI summary first, on a cold machine).
const FIRST_RUN = [10, 28, 50] as const;
const RERUN = [4, 10, 20] as const;

// How fast the evidence rows appear. Presentational only — the list arrives in one
// response; staggering it makes the gather stage legible instead of instantaneous.
const ROW_STEP_MS = 320;

export function BattleCardBuild({
  startedAt,
  firstTime,
  evidence,
  competitorName,
}: {
  startedAt: number;
  firstTime: boolean;
  evidence: BattleCardEvidence | null;
  competitorName: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));

  const bounds = firstTime ? FIRST_RUN : RERUN;
  const stage = bounds.findIndex((b) => elapsed < b);
  const active = stage === -1 ? STAGES.length - 1 : stage;
  const slow = elapsed > (firstTime ? 60 : 30);

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
          <CircleNotchIcon size={15} className="shrink-0 animate-spin text-primary" />
          <span className="text-content font-medium">{STAGES[active]}</span>
          <span className="ml-auto font-mono text-meta tabular-nums text-muted-foreground">
            {elapsed}s
          </span>
        </div>
        <div className="flex gap-1" aria-hidden>
          {STAGES.map((s, i) => (
            <span
              key={s}
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
                    <CheckIcon size={13} className="text-positive" />
                  ) : (
                    <MinusIcon size={13} className="text-muted-foreground" />
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

      <p className="px-5 py-3.5 text-sm text-muted-foreground">
        {slow
          ? "Still working. This one is taking longer than usual. You can leave this page and we will drop a notification in the bell when it is ready."
          : firstTime
            ? "The first card for a competitor takes longer, because it builds the AI summary first. You can leave this page and we will notify you."
            : "You can leave this page. The bell will tell you when it is ready, and the PDF finishes a few seconds after the text lands."}
      </p>
    </TabCard>
  );
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
        <Icon size={15} className={cn("shrink-0", !meta.color && "text-muted-foreground")} />
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
