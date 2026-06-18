import { toast } from "sonner";
import { ApiError } from "./api";

// Turns an API error code into a user-facing config, always in three parts:
//   title       — what happened (past)
//   description — what we're doing / what you can do (present)
//   action      — the one thing the user can do now (optional)
// No stack trace, no technical detail ever reaches the user (patch-14).

export type UserActionType = "retry" | "wait" | "contact";

export interface ErrorConfig {
  title: string;
  description: string;
  action?: { label: string; type: UserActionType };
}

const ERROR_CONFIGS: Record<string, ErrorConfig> = {
  network_error: {
    title: "Couldn't reach the server",
    description: "Check your connection — nothing was lost. Try again in a moment.",
    action: { label: "Retry", type: "retry" },
  },
  timeout: {
    title: "The server took too long",
    description: "It's still working in the background. Give it a few seconds, then retry.",
    action: { label: "Retry", type: "retry" },
  },
  rate_limited: {
    title: "Too many requests",
    description: "You've hit the rate limit. Wait a minute before trying again.",
    action: { label: "Wait a minute", type: "wait" },
  },
  monitor_unreachable: {
    title: "Couldn't reach the site",
    description: "We retry automatically within the hour — no action needed.",
    action: { label: "Retry now", type: "retry" },
  },
  ai_failed: {
    title: "The analysis didn't complete",
    description: "Our team has been notified. You can retry in a moment.",
    action: { label: "Retry", type: "retry" },
  },
  review_url_required: {
    title: "A review-page URL is required",
    description: "Paste the competitor's review page URL to enable this source.",
  },
  invalid_monitor_url: {
    title: "That URL doesn't look right",
    description: "Double-check the address for this source, then try again.",
  },
  not_found: {
    title: "Not found",
    description: "That item doesn't exist anymore, or you don't have access to it.",
  },
};

const DEFAULT_CONFIG: ErrorConfig = {
  title: "Something went wrong",
  description: "The action didn't go through. Try again in a moment.",
  action: { label: "Retry", type: "retry" },
};

export function errorConfig(err: unknown): ErrorConfig {
  // Prefer the human message the API sent (patch-14 envelope), but only as the
  // description — the title/action still come from the known code so the copy
  // stays consistent. Plan/paywall codes are handled by the paywall flow, not here.
  const code = err instanceof ApiError ? err.code : undefined;
  return (code && ERROR_CONFIGS[code]) || DEFAULT_CONFIG;
}

// Surfaces a transient error as a sonner toast in three parts, never leaking the
// raw error. Callers may override the title to keep their context (e.g. "Couldn't
// enable that source") while the clean description + retry action come from the
// known error code.
// patch-27 — the forced-rescan daily cap returns a 429 whose body is a NESTED error
// object ({ error: { code, message, upgradeHint } }), so ApiError.code (set only for
// string codes) is empty. Every re-scan entry point (force-rescan, per-source Run,
// My Product re-scan) surfaces it the same way: a warning toast + an upgrade nudge.
// Returns true when it handled the error so callers can skip the generic toast.
export function toastRescanLimit(err: unknown, toastId?: string | number): boolean {
  if (!(err instanceof ApiError) || err.status !== 429) return false;
  const detail = (err.data.error ?? {}) as {
    code?: string;
    message?: string;
    upgradeHint?: boolean;
  };
  if (detail.code !== "rescan_limit_reached") return false;
  toast.warning(detail.message ?? "Daily re-scan limit reached. It resets tomorrow.", {
    id: toastId,
    action: detail.upgradeHint
      ? {
          label: "View plans",
          onClick: () => {
            window.location.href = "/dashboard/settings/billing";
          },
        }
      : undefined,
  });
  return true;
}

export function toastApiError(
  err: unknown,
  opts?: { title?: string; onRetry?: () => void },
): void {
  const cfg = errorConfig(err);
  const showRetry = cfg.action?.type === "retry" && Boolean(opts?.onRetry);
  toast.error(opts?.title ?? cfg.title, {
    description: cfg.description,
    // An error carrying a Retry action must outlive the default 5s — the user
    // reads the description, then decides. Plain errors keep the default.
    duration: showRetry ? 12000 : undefined,
    action:
      showRetry && opts?.onRetry
        ? { label: cfg.action!.label, onClick: opts.onRetry }
        : undefined,
  });
}
