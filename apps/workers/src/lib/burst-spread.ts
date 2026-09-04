// Spread a batch of enqueues over a window instead of landing them in one second
// (R1 of docs/plans/ai-pool-reliability-audit.md).
//
// `schedule-scraping` fired every due monitor at :00 with no `startAfter`, so 2,051
// jobs became one batch: 67% of all AI calls fell in `:00-:04` at a 48% failure rate,
// and the peak minute reached 123k tokens against a day mean of 640 tokens/minute —
// roughly 190x. Groq's free ceiling is 8,000 TPM, so that minute could not be served
// by the pool at any priority order. Nothing downstream of the burst can fix it: the
// per-provider breakers, the TPM windows and the deferral ladder all exist to survive
// a burst this shape, and all of them lose to it.
//
// The offsets are even rather than random: an even walk fills the window exactly once,
// while random offsets clump (the expected maximum gap of n uniform draws is much
// wider than the mean). The SHUFFLE is what removes the systematic unfairness — the
// due set comes back from Postgres in a stable order, so without it the same orgs
// would ride the front of every hour and the same orgs the back, every hour forever.
export interface SpreadItem<T> {
  item: T;
  /** Seconds from now at which this item should become visible to a worker. */
  startAfterSec: number;
}

/** Fisher-Yates, on a copy — the caller's array is not the shuffle's to mutate. */
function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Shuffle `items` and walk them evenly across `[0, spreadSec)`.
 *
 * `spreadSec <= 0` disables the spread (every offset 0), which is what restores the
 * old behaviour from env without a deploy.
 */
export function spreadOverWindow<T>(
  items: readonly T[],
  spreadSec: number,
  rand: () => number = Math.random,
): SpreadItem<T>[] {
  const order = shuffled(items, rand);
  if (spreadSec <= 0 || order.length <= 1) {
    return order.map((item) => ({ item, startAfterSec: 0 }));
  }
  return order.map((item, i) => ({
    item,
    // i / length (not length - 1): the last item lands just inside the window rather
    // than exactly on its edge, so the batch never touches the next cron's minute.
    startAfterSec: Math.floor((i / order.length) * spreadSec),
  }));
}
