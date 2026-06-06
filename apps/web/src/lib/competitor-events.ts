// Lightweight cross-component signal that the competitor set changed (add/delete).
// Lets the sidebar refetch immediately instead of waiting for its poll interval.
const EVENT = "outrival:competitors-changed";

export function emitCompetitorsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EVENT));
  }
}

export function onCompetitorsChanged(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
