import { toast as sonner } from "sonner";

// One place that decides how long each KIND of toast stays on screen, so the
// answer isn't spread over ~200 call sites (which is how a plain confirmation
// and an error carrying a decision ended up with the same 5s).
//
// Reading cost is what sets these, not importance: a confirmation is re-read
// from the UI it just changed, an error has to be read before it's gone, and a
// warning usually carries a next step. Callers keep the last word — passing an
// explicit `duration` (toastApiError does, for its Retry variant) wins.
const DURATIONS = {
  /** Neutral acknowledgement ("Link copied") — the shortest useful glance. */
  default: 3500,
  /** The action worked and its result is visible elsewhere on screen. */
  success: 4000,
  /** Context the user didn't ask for; never blocks anything. */
  info: 5000,
  /** Something needs a decision (a cap hit, a source still pending). */
  warning: 7000,
  /** Failure: read it or lose it, and it often carries a Retry. */
  error: 8000,
} as const;

type Message = Parameters<typeof sonner>[0];
type Options = Parameters<typeof sonner>[1];

function withDuration(kind: keyof typeof DURATIONS, options?: Options): Options {
  if (options?.duration !== undefined) return options;
  return { ...options, duration: DURATIONS[kind] };
}

/**
 * Drop-in replacement for sonner's `toast`, used everywhere in the app instead of
 * importing from "sonner" directly. Same API — the only difference is the default
 * duration per kind above. `loading` is left alone: it lives until the caller
 * replaces it by id.
 */
export const toast = Object.assign(
  (message: Message, options?: Options) => sonner(message, withDuration("default", options)),
  {
    success: (message: Message, options?: Options) =>
      sonner.success(message, withDuration("success", options)),
    info: (message: Message, options?: Options) =>
      sonner.info(message, withDuration("info", options)),
    warning: (message: Message, options?: Options) =>
      sonner.warning(message, withDuration("warning", options)),
    error: (message: Message, options?: Options) =>
      sonner.error(message, withDuration("error", options)),
    loading: (message: Message, options?: Options) => sonner.loading(message, options),
    dismiss: sonner.dismiss,
  },
);
