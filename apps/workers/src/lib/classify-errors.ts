import { DeadLetter } from "@outrival/queue";

// R2 (2026-07 audit) — a classify parse miss (a null classification) is a TRANSIENT
// free-provider failure: the grounding/JSON envelope malforms intermittently, and a
// re-run gets a fresh LLM call. It must stay RETRIABLE. Making it a non-retriable
// AbortTaskRunError once dropped the signal forever — the change stayed orphaned and
// no later scrape recreated it.
//
// This factory keeps the throw a plain Error (Trigger retries anything that isn't an
// AbortTaskRunError). It exists as a named seam so classify-retriable.test.ts can pin
// the invariant: a future "cleanup" can't quietly turn the parse-fail path back into
// a silent abort.
export function retriableClassifyError(changeId: string): Error {
  return new Error(`Classification returned null (parse failed) for change ${changeId}`);
}

/**
 * The OTHER half of the same decision (Véracité Intelligence v2 P3): a reply cut off
 * at its output ceiling is a parse miss too, and it is the one that must NOT be
 * retried. The prompt and the token budget are both unchanged on a re-run, so the
 * cut falls in the same place — three attempts buy one failure three times, on a
 * free-tier quota, while the repair (a bigger budget, a smaller prompt) is a code
 * change nobody is making inside the retry window.
 *
 * `DeadLetter` is the third outcome the queue grew for this: the payload is parked on
 * `outrival-dlq` intact and the job completes, so the failure is countable and the
 * work is replayable. It is deliberately NOT `NonRetriable` — that one completes
 * quietly, which is how a change would disappear without anyone learning it had.
 */
export function truncatedReplyError(what: string, changeId: string): DeadLetter {
  return new DeadLetter(
    `${what} reply truncated at maxTokens for change ${changeId}`,
    "truncated_reply",
  );
}
