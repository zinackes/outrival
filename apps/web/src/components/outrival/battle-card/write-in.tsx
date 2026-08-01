"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { drainRate, planWriteIn, visibleAt } from "@/lib/write-in-cursor";

// Writes a battle card in line by line — from the first sentence the model streams to
// the last one on the stored card. ONE cursor, counting characters across the whole
// card, advanced on a single timer: every line's visible slice is derived from it, so
// the lines write in document order at one steady rate instead of N animations racing
// each other.
//
// The cursor is deliberately BEHIND the text we already hold, and that is the point.
// The stream reaches the page in bursts — the worker flushes every ~200ms, the page
// polls every 750ms, and on a fast provider the entire card arrives in a single frame
// — so rendering what has arrived shows the card appearing in slabs. Draining a
// backlog turns any arrival pattern into writing.
//
// Because it is one cursor over "the text we hold right now", the handoff from the
// streamed draft to the stored card is not an event: the target grows, the cursor
// carries on from where it was. That is what removes the cut this used to have, where
// the finished card wiped the screen and typed itself a second time from empty.
//
// RATE: proportional to the backlog, so the pace is set by how much is waiting rather
// than by when the bytes happened to land. Floored so a short card does not crawl,
// capped so a whole-card burst still reads as writing.
const DRAIN_SECONDS = 5;
const MIN_CHARS_PER_SECOND = 55;
const MAX_CHARS_PER_SECOND = 240;

// The run is over (its PDF landed, or we stopped waiting for it). Whatever is left was
// paced against work that is no longer running, so it runs out — accelerated, never
// dumped on screen at once, because snapping to the full card is the cut being removed.
const FINISH_SECONDS = 1.2;
const FINISH_MIN_CHARS_PER_SECOND = 320;

const TICK_MS = 33; // ~30fps: fast enough to read as typing, a third of the renders

/** The visible prefix of line `index`, or null for a line that has not started. */
export type WriteReader = (index: number) => string | null;

/**
 * Returns a reader for the visible prefix of each text, in the order given:
 * - `null` while a line has not started (the caller skips it entirely, so the card
 *   GROWS as it writes rather than reserving empty rows),
 * - a partial string while it is being written,
 * - the whole string once written, or immediately when the animation is off.
 *
 * `enabled` false — a stored card, or `prefers-reduced-motion` — yields full text on
 * the first render with no timer at all.
 */
export function useWriteIn(
  texts: string[],
  enabled: boolean,
  /** The rest of the generation finished — run the remaining text out quickly instead
   *  of holding the reader to a pace set for work that is over. */
  finishNow = false,
  /** Changes when a NEW generation starts, rewinding the cursor. Without it a second
   *  card would open already written, the cursor still sitting past the first one. */
  runToken: string | number | null = null,
): WriteReader {
  const reducedMotion = usePrefersReducedMotion();
  const active = enabled && !reducedMotion;

  // Prefix sums: where each line starts on the shared cursor.
  const plan = useMemo(() => planWriteIn(texts), [texts]);
  const total = plan.total;

  const [cursor, setCursor] = useState(0);
  // The timer reads the moving parts through refs so it never has to be torn down and
  // rebuilt as the text grows — a restart would drop the cursor back to zero, which is
  // exactly the reset this hook exists to avoid.
  const cursorRef = useRef(0);
  const totalRef = useRef(total);
  const finishRef = useRef(finishNow);
  const tokenRef = useRef(runToken);

  useEffect(() => {
    totalRef.current = total;
  }, [total]);
  useEffect(() => {
    finishRef.current = finishNow;
  }, [finishNow]);
  // Declared before the timer so a new run has already rewound when it restarts.
  useEffect(() => {
    if (tokenRef.current === runToken) return;
    tokenRef.current = runToken;
    cursorRef.current = 0;
    setCursor(0);
  }, [runToken]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      const backlog = totalRef.current - cursorRef.current;
      if (backlog <= 0) {
        // Nothing owed. While the run is live the timer idles, waiting for the next
        // burst; once it is over there is no next burst, so stop ticking.
        if (finishRef.current) clearInterval(timer);
        return;
      }
      const rate = finishRef.current
        ? drainRate(backlog, { seconds: FINISH_SECONDS, min: FINISH_MIN_CHARS_PER_SECOND })
        : drainRate(backlog, {
            seconds: DRAIN_SECONDS,
            min: MIN_CHARS_PER_SECOND,
            max: MAX_CHARS_PER_SECOND,
          });
      const next = Math.min(totalRef.current, cursorRef.current + (rate * TICK_MS) / 1000);
      cursorRef.current = next;
      setCursor(next);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [active, runToken]);

  return (index: number) =>
    visibleAt(texts, plan, active ? Math.floor(cursor) : null, index);
}

/** The caret that sits at the end of the line currently being written. */
export function WriteCaret() {
  return (
    <span
      aria-hidden
      className="ml-px inline-block h-[1em] w-[2px] translate-y-[0.15em] animate-pulse bg-primary"
    />
  );
}

function usePrefersReducedMotion(): boolean {
  // Starts false and corrects on mount: the server has no media query, and
  // rendering the card in full on the first paint is the safe direction to be
  // wrong in — worst case the animation is skipped, never text that never arrives.
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
