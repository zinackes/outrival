"use client";

import { motion } from "motion/react";
import type { CompareColumn } from "@/lib/api";
import { cn } from "@/lib/utils";
import { buildVerdict, type Fact, type LensId, type Tone } from "./derive";

/**
 * The reading the page opens on. Everything under it is evidence: this block answers
 * "where do we stand" in sentences, then names the four facts it read that from.
 *
 * Each fact is also navigation — it scrolls to the lens it came from, so the summary
 * doubles as the page's table of contents.
 */

const TONE_DOT: Record<Tone, string> = {
  good: "bg-positive",
  bad: "bg-critical",
  warn: "bg-high",
  flat: "bg-border-strong",
};

const TONE_VALUE: Record<Tone, string> = {
  good: "text-positive",
  bad: "text-critical",
  warn: "",
  flat: "text-muted-foreground",
};

function jump(lens: LensId) {
  const target = document.getElementById(lens);
  if (!target) return;
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}

function FactLine({ fact, index }: { fact: Fact; index: number }) {
  return (
    <motion.button
      type="button"
      onClick={() => jump(fact.lens)}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      // A short stagger so the four facts land as one reading rather than four blinks.
      transition={{ duration: 0.2, delay: 0.04 * index, ease: "easeOut" }}
      className="border-border hover:bg-surface-2 focus-visible:ring-ring/50 grid w-full grid-cols-[0.375rem_minmax(0,1fr)_auto] items-baseline gap-x-2.5 border-b py-1.5 text-left first:border-t focus-visible:ring-2 focus-visible:outline-none"
    >
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 translate-y-[-1px] rounded-full", TONE_DOT[fact.tone])}
      />
      <span className="text-sm">
        <span className="font-semibold">{fact.lead}</span> {fact.rest}
      </span>
      <span
        className={cn(
          "font-mono text-dense whitespace-nowrap tabular-nums",
          TONE_VALUE[fact.tone],
        )}
      >
        {fact.value}
      </span>
    </motion.button>
  );
}

export function CompareVerdict({
  you,
  comps,
}: {
  you: CompareColumn;
  comps: CompareColumn[];
}) {
  const { lead, facts } = buildVerdict(you, comps);

  if (lead.length === 0 && facts.length === 0) {
    return (
      <p className="text-muted-foreground m-0 max-w-[62ch] text-sm">
        Nothing measurable has come in for this set yet. The lenses below fill in as
        pricing, reviews and hiring are captured.
      </p>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-10">
      <div>
        <p className="m-0 max-w-[62ch] text-content leading-relaxed text-pretty">
          {lead.map((seg, i) =>
            seg.t === "num" ? (
              <span key={i} className="font-mono tabular-nums">
                {seg.v}
              </span>
            ) : (
              <span key={i}>{seg.v}</span>
            ),
          )}
        </p>
        <p className="text-muted-foreground m-0 mt-2 text-meta">
          Read from pricing, reviews, hiring and the latest signal per competitor.
        </p>
      </div>
      <div className="flex flex-col">
        {facts.map((f, i) => (
          <FactLine key={f.key} fact={f} index={i} />
        ))}
      </div>
    </div>
  );
}
