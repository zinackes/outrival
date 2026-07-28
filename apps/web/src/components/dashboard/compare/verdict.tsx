"use client";

import { motion } from "motion/react";
import type { CompareColumn } from "@/lib/api";
import { CompAvatar } from "@/components/dashboard/comp-avatar";
import { useFx } from "@/lib/fx";
import { cn } from "@/lib/utils";
import { buildVerdict, type Fact, type LensId, type Tone } from "./derive";

/**
 * The reading the page opens on. Everything under it is evidence: this block answers
 * "where do we stand" in sentences, then names the four facts it read that from.
 *
 * Each fact is also navigation — it scrolls to the lens it came from, so the summary
 * doubles as the page's table of contents.
 */

const TONE_VALUE: Record<Tone, string> = {
  good: "text-positive",
  bad: "text-critical",
  warn: "text-high",
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

/**
 * One fact, sized to its own content. It used to be a full-width ruled line, which put
 * a rule above and below a lone fact and flung its number to the far edge of the page —
 * a strip of dead space between the label and the number it labels. As a chip the two
 * sit together, and one fact reads as one object rather than an orphaned row.
 *
 * The favicon in front is the competitor the fact is ABOUT: your product for your own
 * standing, whoever is applying the pressure otherwise. Tone lives on the number.
 */
function FactChip({ fact, index }: { fact: Fact; index: number }) {
  return (
    <motion.button
      type="button"
      onClick={() => jump(fact.lens)}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      // A short stagger so the four facts land as one reading rather than four blinks.
      transition={{ duration: 0.2, delay: 0.04 * index, ease: "easeOut" }}
      className="bg-surface-2 hover:bg-surface-3 focus-visible:ring-ring/50 inline-flex max-w-full items-center gap-2 rounded-lg py-1.5 pr-3 pl-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <CompAvatar name={fact.subject.name} url={fact.subject.url} size={18} />
      <span className="min-w-0 truncate text-sm">
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
  // Same rates as the price lens, so "cheapest way in" is decided on the axis the
  // reader then scrolls to rather than on whatever unit each product publishes in.
  const fx = useFx();
  const { lead, facts } = buildVerdict(you, comps, Date.now(), fx?.rates ?? null);

  if (lead.length === 0 && facts.length === 0) {
    return (
      <p className="text-muted-foreground m-0 max-w-[62ch] text-sm">
        Nothing measurable has come in for this set yet. The lenses below fill in as
        pricing, reviews and hiring are captured.
      </p>
    );
  }

  const head = (
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
  );
  const chips = (
    <div className="flex flex-wrap items-start gap-2">
      {facts.map((f, i) => (
        <FactChip key={f.key} fact={f} index={i} />
      ))}
    </div>
  );

  // One or two facts can't hold a column of their own: the sentence takes the full
  // width and the chips sit under it. Three or more earn the side column back.
  if (facts.length <= 2) {
    return (
      <div className="flex flex-col gap-4">
        {head}
        {facts.length > 0 && chips}
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-10">
      {head}
      {chips}
    </div>
  );
}
