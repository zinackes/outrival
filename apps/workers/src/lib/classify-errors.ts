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
