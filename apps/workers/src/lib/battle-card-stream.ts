import { parsePartialCard } from "@outrival/ai";
import { uploadToR2, deleteManyFromR2, battleCardStreamKey } from "@outrival/shared";
import { logger } from "./job-logger";

// Parks a battle card's text in R2 while the model is still writing it, so the page
// can show the card being written rather than a skeleton followed by a finished
// document. The pass that streams is the verification one — the last to touch the
// content — so what a reader watches arrive is what will be published.
//
// Entirely best-effort: this is a view of work in progress, and losing it costs a
// nicer wait, never a card. Every write is fire-and-forget and every failure is
// swallowed, so R2 being slow can neither delay nor fail a generation.

/** The shape the API serves and the page renders. */
export interface BattleCardStreamBuffer {
  startedAt: string;
  content: unknown;
  typing: string | null;
  typingKey: string | null;
}

/**
 * How often the buffer is pushed. Measured on the free pool, a card's text lands in
 * one short burst at the end of a ~1.3s call (the model reads and reasons first, then
 * emits fast), so the flush has to be well under that burst to catch it in more than
 * one state. A push already in flight is skipped rather than queued, which is the real
 * guard against writing faster than R2 answers.
 */
const FLUSH_EVERY_MS = 200;

export function createBattleCardStream(competitorId: string, productId?: string | null) {
  const key = battleCardStreamKey(competitorId, productId);
  const startedAt = new Date().toISOString();
  let lastFlush = 0;
  let inFlight = false;
  let latest: string | null = null;

  const push = (raw: string) => {
    const read = parsePartialCard(raw);
    const body: BattleCardStreamBuffer = {
      startedAt,
      content: read.content,
      typing: read.typing,
      typingKey: read.typingKey,
    };
    inFlight = true;
    void uploadToR2(key, JSON.stringify(body), "application/json")
      .catch((err) => logger.warn("Battle card stream push failed", { err: String(err) }))
      .finally(() => {
        inFlight = false;
      });
  };

  return {
    /** Pass to the AI call. Throttled, and never awaited by the generation. */
    onPartial(textSoFar: string) {
      latest = textSoFar;
      const now = Date.now();
      // One write at a time: a slow PUT must not queue up behind itself and land
      // out of order, which would rewind the card in front of the reader.
      if (inFlight || now - lastFlush < FLUSH_EVERY_MS) return;
      lastFlush = now;
      push(textSoFar);
    },
    /** The last state, so the final sentence is not left mid-word on screen. */
    flush() {
      if (latest) push(latest);
    },
    /** The card row is the source of truth now — the buffer would only go stale. */
    async close() {
      try {
        await deleteManyFromR2([key]);
      } catch (err) {
        logger.warn("Battle card stream cleanup failed", { err: String(err) });
      }
    },
  };
}
