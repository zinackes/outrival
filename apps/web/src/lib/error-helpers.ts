import { toast } from "@/lib/toast";
import { ApiError } from "./api";
import { track } from "./posthog/events";

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

// Hoisted because it is also the fallback for any 404 whose code the map doesn't
// know — see `errorConfig`. No retry action on purpose: the request cannot become
// right by being sent again.
const NOT_FOUND_CONFIG: ErrorConfig = {
  title: "Not found",
  description: "That item doesn't exist anymore, or you don't have access to it.",
};

const ERROR_CONFIGS: Record<string, ErrorConfig> = {
  network_error: {
    title: "Couldn't reach the server",
    description: "Check your connection, nothing was lost. Try again in a moment.",
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
  // The per-user hourly cap on AI-intensive actions (manual scrapes, battle cards,
  // discovery). It was missing here, so every trip fell through to "Something went
  // wrong" and the API's own message — which names the cap AND when it resets — was
  // thrown away. That is what made a re-scan refusal read as a broken button.
  ai_rate_limit_exceeded: {
    title: "Hourly action limit reached",
    description:
      "You've used this hour's manual scrapes. They resume automatically; scheduled scans keep running.",
    action: { label: "Wait", type: "wait" },
  },
  monitor_unreachable: {
    title: "Couldn't reach the site",
    description: "We retry automatically within the hour, no action needed.",
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
  repo_url_required: {
    title: "A repository URL is required",
    description:
      "Nothing on their site points to their repo, so paste the github.com/owner/repo URL to enable it.",
  },
  // The Trustpilot surface reads their official API; with no key configured the
  // monitor could only ever fail, so the API refuses to create it.
  trustpilot_key_missing: {
    title: "Trustpilot isn't available right now",
    description: "This source needs a Trustpilot API key on our side. We've been notified.",
  },
  invalid_monitor_url: {
    title: "That URL doesn't look right",
    description: "Double-check the address for this source, then try again.",
  },
  not_found: NOT_FOUND_CONFIG,
  // Generic Zod validation failure — the API returns `{ error: "Invalid body" }` on
  // every route, so this keys on that exact string. Front-end field validation should
  // catch most cases first; this is the clean fallback when one slips through.
  "Invalid body": {
    title: "Some details need fixing",
    description: "Check the highlighted fields and try again.",
  },
  // Step-up re-auth (delete workspace / account): the 6-digit code was wrong/expired.
  reauth_failed: {
    title: "That code didn't match",
    description: "Check the 6-digit verification code we emailed you, then try again.",
  },
  // Type-to-confirm value didn't match the workspace name / account email.
  confirm_mismatch: {
    title: "Confirmation didn't match",
    description: "Type the exact value shown to confirm this action.",
  },
};

const DEFAULT_CONFIG: ErrorConfig = {
  title: "Something went wrong",
  description: "The action didn't go through. Try again in a moment.",
  action: { label: "Retry", type: "retry" },
};

/** "selfProfile.category" -> "Self profile category". */
function humanizeField(path: string): string {
  const words = path
    .replace(/[._]/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The description for a zod refusal, built from the issues the API sent.
 *
 * A failed `safeParse` answers `{ error: "Invalid body", issues: [...] }` with no
 * `message`, so the description fell through to "Check the highlighted fields and
 * try again." on forms that highlight nothing — a 400 saying the workspace name is
 * over 100 characters reached the user as a sentence naming neither the field nor
 * the limit, which is the systemic half of `ux:04`. Capped at three: past that the
 * toast is a wall of text and the form is wrong in a way one line can't fix.
 */
function describeIssues(err: unknown): string | null {
  if (!(err instanceof ApiError) || !Array.isArray(err.data.issues)) return null;
  const parts = (err.data.issues as unknown[])
    .map((raw) => {
      if (typeof raw !== "object" || raw === null) return null;
      const issue = raw as { message?: unknown; path?: unknown };
      if (typeof issue.message !== "string" || !issue.message.trim()) return null;
      const field = Array.isArray(issue.path)
        ? issue.path.filter((p) => typeof p === "string").join(".")
        : "";
      return field ? `${humanizeField(field)}: ${issue.message}` : issue.message;
    })
    .filter((part): part is string => part !== null)
    .slice(0, 3);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function errorConfig(err: unknown): ErrorConfig {
  // Prefer the human message the API sent (patch-14 envelope), but only as the
  // description — the title/action still come from the known code so the copy
  // stays consistent. Plan/paywall codes are handled by the paywall flow, not here.
  //
  // The preference above was documented but never implemented: the envelope's
  // `message` was parsed and dropped, so a 429 that says "try again in about 12
  // minutes" surfaced as "The action didn't go through. Try again in a moment."
  // The API writes these strings for users, so the specific one wins when present.
  const code = err instanceof ApiError ? err.code : undefined;
  // A 404 the map doesn't recognise is still a 404. The API writes most of them as
  // a sentence rather than a code ("Not found", "Competitor not found"), so a stale
  // bookmark or a deleted row surfaced as "Something went wrong" next to a Retry
  // button that could only fail again (`ux:10`).
  const notFoundByStatus = err instanceof ApiError && err.status === 404;
  const base =
    (code && ERROR_CONFIGS[code]) || (notFoundByStatus ? NOT_FOUND_CONFIG : DEFAULT_CONFIG);
  // A zod refusal carries its detail in `issues`, not in `message`.
  const issues = describeIssues(err);
  if (issues) return { ...base, description: issues };
  const sent = err instanceof ApiError ? err.data.message : undefined;
  return typeof sent === "string" && sent.trim() ? { ...base, description: sent } : base;
}

// One clean sentence for the inline error slots that render a bare string (a form's
// `<p className="text-destructive">`, a sheet's load failure). Callers used to put
// `String(e)` there, which printed the class name plus the raw response body.
export function errorMessage(err: unknown): string {
  return errorConfig(err).description;
}

/**
 * Whether TanStack Query should retry a failed read. Wired as the app-wide
 * `retry` default in `components/query-provider.tsx`.
 *
 * The library's default retries everything three times, so a mistyped or stale id
 * fired the same 404 four times before the screen said anything at all, and every
 * other client error paid three pointless round trips before its error state
 * appeared (`ux:10`). A 4xx is the server's final answer — the identical request
 * cannot become right on its own. Everything else (network, timeout, 5xx) keeps
 * the three tries it had.
 */
export function shouldRetryQuery(failureCount: number, err: unknown): boolean {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
  return failureCount < 3;
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
/**
 * The parse half of `toastRescanLimit`, split out so it can be tested without a
 * toast host or a PostHog client: everything that decides whether this error IS the
 * re-scan cap, and what the toast should say, with no side effect. Returns null for
 * every other error, which is the caller's "not handled, fall through" answer.
 */
export function rescanLimitToast(err: unknown): { message: string; upgradeHint: boolean } | null {
  if (!(err instanceof ApiError) || err.status !== 429) return null;
  const detail = (err.data.error ?? {}) as {
    code?: string;
    message?: string;
    upgradeHint?: boolean;
  };
  if (detail.code !== "rescan_limit_reached") return null;
  return {
    message: detail.message ?? "Daily re-scan limit reached. It resets tomorrow.",
    upgradeHint: detail.upgradeHint === true,
  };
}

export function toastRescanLimit(err: unknown, toastId?: string | number): boolean {
  const hit = rescanLimitToast(err);
  if (!hit) return false;
  // This 429 never opens PaywallDialog, so it was invisible to the paywall_shown
  // funnel (plan 022). Same event, same reason-code convention, no dialog.
  track("paywall_shown", { reason: "rescan_limit_reached" });
  toast.warning(hit.message, {
    id: toastId,
    action: hit.upgradeHint
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
  opts?: { title?: string; onRetry?: () => void; id?: string | number },
): void {
  const cfg = errorConfig(err);
  const showRetry = cfg.action?.type === "retry" && Boolean(opts?.onRetry);
  toast.error(opts?.title ?? cfg.title, {
    // `id` lets a caller replace an in-flight loading toast (e.g. a re-scan) instead
    // of stacking a second one.
    id: opts?.id,
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
