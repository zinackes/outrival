import { describe, expect, test } from "bun:test";
import { ApiError } from "@/lib/api";
import {
  errorConfig,
  errorMessage,
  rescanLimitToast,
  shouldRetryQuery,
} from "@/lib/error-helpers";

// The error-toast contract: title / description / action, never a raw error. These
// cover the three additions from the audit — a 404 recognised by status rather than
// by code (`ux:10`), a zod refusal that carries its detail in `issues` and not in
// `message` (`ux:04`), and the retry predicate that stops the query client from
// firing a doomed request four times (`ux:10`).

const apiError = (status: number, body: unknown) =>
  new ApiError(status, body, "Request failed");

describe("errorConfig", () => {
  test("an unrecognised 404 reads as not-found, with no retry", () => {
    const cfg = errorConfig(apiError(404, { error: "Competitor not found" }));
    expect(cfg.title).toBe("Not found");
    expect(cfg.action).toBeUndefined();
  });

  test("a 500 still falls back to the generic config", () => {
    expect(errorConfig(apiError(500, {})).title).toBe("Something went wrong");
  });

  test("a known code wins over the status", () => {
    expect(errorConfig(apiError(404, { error: "rate_limited" })).title).toBe(
      "Too many requests",
    );
  });

  test("the API's own message becomes the description", () => {
    expect(
      errorMessage(apiError(429, { error: "rate_limited", message: "Retry in 12 min." })),
    ).toBe("Retry in 12 min.");
  });

  test("a zod refusal names the field and the reason", () => {
    const msg = errorMessage(
      apiError(400, {
        error: "Invalid body",
        issues: [{ path: ["name"], message: "Too big: expected <=100 characters" }],
      }),
    );
    expect(msg).toBe("Name: Too big: expected <=100 characters");
  });

  test("a nested path is humanised, and the list is capped at three", () => {
    const msg = errorMessage(
      apiError(400, {
        error: "Invalid body",
        issues: [
          { path: ["selfProfile", "category"], message: "Required" },
          { path: [], message: "Second" },
          { path: ["contactEmail"], message: "Third" },
          { path: ["c"], message: "Fourth" },
        ],
      }),
    );
    expect(msg).toBe("Self profile category: Required · Second · Contact email: Third");
  });

  test("an issues array with nothing usable keeps the mapped description", () => {
    expect(errorMessage(apiError(400, { error: "Invalid body", issues: [1, null] }))).toBe(
      "Check the highlighted fields and try again.",
    );
  });

  test("a non-ApiError never leaks its own message", () => {
    expect(errorMessage(new Error("connect ECONNREFUSED 127.0.0.1:5432"))).toBe(
      "The action didn't go through. Try again in a moment.",
    );
  });
});

describe("shouldRetryQuery", () => {
  test("a 4xx is the server's final answer", () => {
    expect(shouldRetryQuery(0, apiError(404, {}))).toBe(false);
    expect(shouldRetryQuery(0, apiError(403, {}))).toBe(false);
  });

  test("a 5xx and a network failure keep their three tries", () => {
    expect(shouldRetryQuery(0, apiError(500, {}))).toBe(true);
    expect(shouldRetryQuery(2, new Error("network"))).toBe(true);
    expect(shouldRetryQuery(3, new Error("network"))).toBe(false);
  });
});

// The re-scan cap (patch-27) is the one 429 the API answers with a NESTED error
// object, so `ApiError.code` — set only for a string `error` — is empty and every
// generic path reads it as "Something went wrong". Three entry points depend on this
// discriminating correctly (force-rescan, per-source Run, My Product re-scan), and
// the branch that decides was never exercised.
describe("rescanLimitToast", () => {
  const nested = (error: unknown) => apiError(429, { error });

  test("the API's own sentence is the toast, upgrade action included", () => {
    expect(
      rescanLimitToast(
        nested({
          code: "rescan_limit_reached",
          message: "Daily re-scan limit reached (5/5). Resets at midnight UTC.",
          upgradeHint: true,
        }),
      ),
    ).toEqual({
      message: "Daily re-scan limit reached (5/5). Resets at midnight UTC.",
      upgradeHint: true,
    });
  });

  test("no message from the API still says what happened", () => {
    expect(rescanLimitToast(nested({ code: "rescan_limit_reached" }))).toEqual({
      message: "Daily re-scan limit reached. It resets tomorrow.",
      upgradeHint: false,
    });
  });

  // upgradeHint gates a link to /dashboard/settings/billing. A business account
  // already on the top tier gets no hint, and a truthy-ish value is not a hint:
  // showing "View plans" to someone with nothing to upgrade to is the failure.
  test("only a literal true shows the upgrade action", () => {
    for (const v of [false, undefined, 0, "", "true", 1, null]) {
      const hit = rescanLimitToast(nested({ code: "rescan_limit_reached", upgradeHint: v }));
      expect(hit?.upgradeHint).toBe(false);
    }
    expect(
      rescanLimitToast(nested({ code: "rescan_limit_reached", upgradeHint: true }))?.upgradeHint,
    ).toBe(true);
  });

  test("another 429 is not the re-scan cap and must fall through", () => {
    // The hourly AI cap is also a 429; it has its own copy in ERROR_CONFIGS and
    // must NOT be swallowed here, or it surfaces as the wrong limit.
    expect(rescanLimitToast(apiError(429, { error: "ai_rate_limit_exceeded" }))).toBeNull();
    expect(rescanLimitToast(nested({ code: "something_else" }))).toBeNull();
    expect(rescanLimitToast(apiError(429, {}))).toBeNull();
    expect(rescanLimitToast(apiError(429, { error: null }))).toBeNull();
  });

  test("the same body on another status is not the re-scan cap", () => {
    expect(rescanLimitToast(apiError(403, { error: { code: "rescan_limit_reached" } }))).toBeNull();
  });

  test("a non-ApiError never reaches the parse", () => {
    expect(rescanLimitToast(new Error("boom"))).toBeNull();
    expect(rescanLimitToast(null)).toBeNull();
    expect(rescanLimitToast({ status: 429, data: { error: { code: "rescan_limit_reached" } } })).toBeNull();
  });

  // The generic handler must not ALSO fire on this error: callers write
  // `if (!toastRescanLimit(e)) toastApiError(e, …)`, so a nested-object 429 that
  // fell through would stack a second, wrong toast on top of the right one.
  test("errorConfig has nothing useful for it, which is why this branch exists", () => {
    const err = nested({ code: "rescan_limit_reached", message: "Daily re-scan limit reached." });
    expect(errorConfig(err).title).toBe("Something went wrong");
  });
});
