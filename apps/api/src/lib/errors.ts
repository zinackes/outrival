// Coherent, user-safe API error envelope (patch-14). Kept FLAT and
// backward-compatible: `error` stays the machine code string that the web client
// (ApiError.code) and paywallFromError already parse, and we only ADD optional
// human fields. Never leak a stack trace, SQL error, or file path — the message
// is always written for a human, in English, and structured in three parts
// across the API + UI: what happened (title) / what we're doing or what you can
// do (description) / the action (userAction).

export type UserAction = "retry" | "wait" | "contact";

export interface ApiErrorBody {
  error: string;
  message: string;
  userAction?: UserAction;
  retryAfterSeconds?: number;
}

export function errorBody(
  code: string,
  message: string,
  opts?: { userAction?: UserAction; retryAfterSeconds?: number },
): ApiErrorBody {
  return {
    error: code,
    message,
    ...(opts?.userAction ? { userAction: opts.userAction } : {}),
    ...(opts?.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: opts.retryAfterSeconds }
      : {}),
  };
}

// Common envelopes reused across routes so the same situation always reads the
// same way to the user.
export const notFound = (entity = "resource"): ApiErrorBody =>
  errorBody("not_found", `That ${entity} doesn't exist or you don't have access to it.`);
