"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
//
// PACE: the writing is part of the generation, not a flourish after it. The page
// reveals the card the moment its TEXT lands, while the worker is still rendering the
// PDF, so the steady pass is sized to cover that tail (~15s: Chromium launch, the
// print, the R2 upload, plus up to one 3s poll gap) instead of burning through the
// card in a second and leaving the reader waiting again. It is a target, never a
// promise: `finishNow` (the PDF landed — the work really is done) rebases the cursor
// onto a quick run-out, so the animation can never outlive the thing it describes.
const TARGET_DURATION_MS = 15_000;
const MIN_CHARS_PER_SECOND = 60; // floor, so a short card doesn't crawl for 15s
const FINISH_MS = 1200; // run-out once the PDF has landed
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
export function useWriteIn(
  texts: string[],
  enabled: boolean,
  /** The rest of the generation finished (the PDF landed) — run the remaining text
   *  out quickly instead of holding the reader to a pace set for work that is over. */
  finishNow = false,
): (index: number) => string | null {
  const reducedMotion = usePrefersReducedMotion();
  const active = enabled && !reducedMotion;

  // Prefix sums: where each line starts on the shared cursor.
  const plan = useMemo(() => planWriteIn(texts), [texts]);
  const total = plan.total;

  // null = not animating (done, or never was) → everything renders in full.
  const [cursor, setCursor] = useState<number | null>(active && total > 0 ? 0 : null);
  // Where the steady pass got to, so the run-out continues from there rather than
  // restarting the card. Only read when rebasing — never during render.
  const writtenRef = useRef(0);

  useEffect(() => {
    if (!active || total === 0) {
      setCursor(null);
      return;
    }
    // The steady pass always starts the card; only the run-out resumes mid-card.
    const from = finishNow ? writtenRef.current : 0;
    const remaining = total - from;
    if (remaining <= 0) {
      setCursor(null);
      return;
    }
    writtenRef.current = from;
    setCursor(from);
    const rate = finishNow
      ? remaining / (FINISH_MS / 1000)
      : writeInRate(total, MIN_CHARS_PER_SECOND, TARGET_DURATION_MS);
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const written = from + Math.floor(((Date.now() - startedAt) / 1000) * rate);
      writtenRef.current = written;
      if (written >= total) {
        clearInterval(timer);
        setCursor(null); // done — drop back to plain text, no more slicing
        return;
      }
      setCursor(written);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [active, total, finishNow]);

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
