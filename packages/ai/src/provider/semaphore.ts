/**
 * Process-wide admission control for the provider pool (R9 of the AI pool reliability
 * audit).
 *
 * Per-queue serialisation is not pool serialisation. Twenty-four AI-bearing job
 * handlers run side by side, six of them with a declared concurrency and the rest at
 * pg-boss's default of 1, which puts the lower bound on simultaneous in-flight LLM
 * calls from the workers alone at about 22 — plus whatever the API is doing in the
 * same fleet. Nothing in `packages/ai` counted them. The `concurrency: 1` comments in
 * the queue registry describe this as a "groq lane (global serialization)", which was
 * true when Groq was the only provider and stopped being true when the pool grew to
 * four.
 *
 * The counter belongs here rather than in the queue because this is the only place
 * that sees every caller: jobs, crons and the interactive API paths all funnel through
 * callLLM. Bounding demand at the door is also the only lever that acts BEFORE a 429 —
 * the breakers, the TPM windows and the deferral ladder are all reactions to one.
 *
 * Sized by AI_MAX_CONCURRENT_CALLS (default 4). 0 or a non-number disables it, which
 * is the escape hatch: too small a semaphore turns a token problem into a latency one
 * and pushes jobs into their `expireInSeconds`, so the value is meant to be tuned
 * against the job expiry rate rather than guessed once.
 */
let inFlight = 0;
let peakInFlight = 0;
const waiting: (() => void)[] = [];

const noop = (): void => {};

function limit(): number {
  // Read per acquire, not once at import: the workers are long-lived and this is the
  // knob most likely to be turned during an incident.
  const n = Number(process.env.AI_MAX_CONCURRENT_CALLS ?? 4);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Wait for a slot, then run `fn`. The slot is handed straight to the next waiter on
 * release (FIFO) rather than decremented and re-acquired, so a queued call cannot be
 * overtaken by one that arrives later — starving the head of the queue is exactly how
 * a bounded pool produces the expiries it was added to prevent.
 */
export async function withAiSlot<T>(fn: () => Promise<T>): Promise<T> {
  const release = await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

async function acquire(): Promise<() => void> {
  if (limit() <= 0) return noop;
  if (inFlight < limit()) inFlight += 1;
  // The releaser hands its slot over without touching the counter, so `inFlight` is
  // already accounted for when this resolves.
  else await new Promise<void>((resolve) => waiting.push(resolve));
  if (inFlight > peakInFlight) peakInFlight = inFlight;

  let released = false;
  return () => {
    if (released) return; // a double release would hand out a slot that does not exist
    released = true;
    const next = waiting.shift();
    if (next) next();
    else inFlight -= 1;
  };
}

/**
 * Current occupancy and the high-water mark since the last read (C3). The peak is what
 * answers "how many concurrent AI calls does the fleet actually reach at :00", which
 * the audit could only bound at about 22 from the code.
 */
export function aiSlotStats(): { inFlight: number; waiting: number; peak: number } {
  return { inFlight, waiting: waiting.length, peak: peakInFlight };
}

/** Read AND clear the high-water mark, so each sample covers its own interval. */
export function consumeAiSlotPeak(): number {
  const p = peakInFlight;
  peakInFlight = inFlight;
  return p;
}

/** Test seam — the counter is module state shared by every caller in the process. */
export function resetAiSlots(): void {
  inFlight = 0;
  peakInFlight = 0;
  waiting.length = 0;
}
