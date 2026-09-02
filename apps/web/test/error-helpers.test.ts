import { describe, expect, test } from "bun:test";
import { ApiError } from "@/lib/api";
import { errorConfig, errorMessage, shouldRetryQuery } from "@/lib/error-helpers";

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
