// The arithmetic behind writing a battle card in line by line: one cursor counting
// characters across the whole card, and a rule turning that count into "how much of
// line N is visible". Kept out of the component because this is the part with real
// off-by-one risk — a line that starts one character early shows a stray caret on an
// empty row, and one that ends late never drops its caret at all.

export interface WriteInPlan {
  /** Cursor position at which each line starts. */
  starts: number[];
  /** Characters across every line — the cursor value at which the card is done. */
  total: number;
}

export function planWriteIn(texts: string[]): WriteInPlan {
  const starts: number[] = [];
  let acc = 0;
  for (const t of texts) {
    starts.push(acc);
    acc += t.length;
  }
  return { starts, total: acc };
}

/**
 * The visible prefix of `texts[index]` at this cursor:
 * - `null` before the line starts, so the caller renders no row at all and the card
 *   GROWS as it writes rather than reserving blank space,
 * - a partial string while it is being written,
 * - the whole string once complete.
 *
 * A `null` cursor means "not animating" — every line reads in full. That is the state
 * a stored card opens in, and the state the animation lands in when it finishes.
 */
export function visibleAt(
  texts: string[],
  plan: WriteInPlan,
  cursor: number | null,
  index: number,
): string | null {
  const text = texts[index];
  if (text === undefined) return null;
  if (cursor === null) return text;
  const shown = cursor - (plan.starts[index] ?? 0);
  if (shown <= 0) return null;
  return shown >= text.length ? text : text.slice(0, shown);
}

/**
 * Characters per second for a cursor that is `backlog` characters behind the text we
 * hold. Proportional, so the pace is set by how much is waiting rather than by when
 * the bytes happened to arrive: a whole card landing in one burst writes faster than a
 * trickle, and neither reads as a slab appearing.
 *
 * `min` keeps the tail from crawling once the backlog is nearly cleared; `max` keeps a
 * burst legible as writing rather than as a jump.
 */
export function drainRate(
  backlog: number,
  { seconds, min, max }: { seconds: number; min: number; max?: number },
): number {
  const rate = Math.max(min, backlog / seconds);
  return max === undefined ? rate : Math.min(max, rate);
}
