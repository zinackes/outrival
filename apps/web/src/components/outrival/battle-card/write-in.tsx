"use client";

import { useEffect, useMemo, useState } from "react";
import { planWriteIn, visibleAt, writeInRate } from "@/lib/write-in-cursor";

// Writes a freshly generated card in rather than popping it on screen whole. The
// wait before this is 30-90s of a skeleton, so the arrival is the one moment the
// page has to show that something was actually written — and a card that appears
// line by line is also readable while it lands, which a full-page swap is not.
//
// One cursor for the whole card, advanced on a single timer: every line's slice is
// derived from it, so the lines write in document order at one steady rate instead
// of 28 independent animations racing each other. It runs once, on the transition
// from "generating" to "here it is" — reopening a stored card never replays it.
const CHARS_PER_SECOND = 1100;
const MAX_DURATION_MS = 4500;
const TICK_MS = 33; // ~30fps: fast enough to read as typing, a third of the renders

/**
 * Returns a reader for the visible prefix of each text, in the order given:
 * - `null` while a line has not started (the caller skips it entirely, so the card
 *   GROWS as it writes rather than reserving empty rows),
 * - a partial string while it is being written,
 * - the whole string once written, or immediately when the animation is off.
 *
 * `enabled` false — a stored card, or `prefers-reduced-motion` — yields full text
 * on the first render with no timer at all.
 */
export function useWriteIn(texts: string[], enabled: boolean): (index: number) => string | null {
  const reducedMotion = usePrefersReducedMotion();
  const active = enabled && !reducedMotion;

  // Prefix sums: where each line starts on the shared cursor.
  const plan = useMemo(() => planWriteIn(texts), [texts]);
  const total = plan.total;

  // null = not animating (done, or never was) → everything renders in full.
  const [cursor, setCursor] = useState<number | null>(active && total > 0 ? 0 : null);

  useEffect(() => {
    if (!active || total === 0) {
      setCursor(null);
      return;
    }
    setCursor(0);
    const rate = writeInRate(total, CHARS_PER_SECOND, MAX_DURATION_MS);
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const written = Math.floor(((Date.now() - startedAt) / 1000) * rate);
      if (written >= total) {
        clearInterval(timer);
        setCursor(null); // done — drop back to plain text, no more slicing
        return;
      }
      setCursor(written);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [active, total]);

  return (index: number) => visibleAt(texts, plan, cursor, index);
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
