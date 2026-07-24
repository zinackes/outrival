"use client";

import { ArrowRight, CornerDownRight } from "lucide-react";
import { parseDelta, formatDeltaPct } from "@/lib/signal-delta";

/**
 * What actually moved, at the top of a signal's detail.
 *
 * When both sides of the change carry the same kind of figure, it reads as a
 * typeset before → after (the one place Geist Mono is the right voice: these are
 * numbers to compare digit by digit). Otherwise it falls back to the two
 * sentences, labelled. Renders nothing when the signal carries no structured
 * change — lexical signals keep the rest of the document to themselves.
 */
export function ChangeLedger({
  before,
  after,
}: {
  before: string | null;
  after: string | null;
}) {
  if (!before && !after) return null;
  const delta = parseDelta(before, after);

  return (
    // Boxless: the detail pane's margin rail already frames this beat, and the
    // action block below is meant to be the one filled object in the document.
    // Capped to the pane's reading measure — the two sentences are prose.
    <div className="max-w-[36rem]">
      {delta ? (
        <>
          <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
            <Figure label="Before" value={delta.before.raw} muted />
            <ArrowRight
              className="mb-1.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <Figure label="After" value={delta.after.raw} />
            {delta.deltaPct !== null && (
              // Deliberately neutral: a competitor cutting a price is good for
              // them and bad for us, so colouring the direction would assert a
              // judgement the number doesn't carry.
              <span className="mb-1 rounded-sm bg-surface-3 px-2 py-0.5 font-mono text-dense tabular-nums text-muted-foreground">
                {formatDeltaPct(delta.deltaPct)}
              </span>
            )}
          </div>
          {after && (
            <p className="mt-4 border-t border-border pt-3 text-dense leading-relaxed text-muted-foreground">
              {after}
            </p>
          )}
        </>
      ) : (
        <div className="space-y-2 text-content leading-relaxed">
          {before && (
            <p className="text-muted-foreground">{before}</p>
          )}
          {after && (
            <p className="flex gap-2 text-foreground">
              <CornerDownRight
                className="mt-1 size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span>{after}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="text-meta font-medium text-muted-foreground">{label}</span>
      <span
        className={
          muted
            ? "font-mono text-xl tabular-nums slashed-zero leading-none text-muted-foreground"
            : "font-mono text-stat tabular-nums slashed-zero leading-none text-foreground"
        }
      >
        {value}
      </span>
    </span>
  );
}
