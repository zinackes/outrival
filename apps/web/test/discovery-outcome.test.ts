import { describe, expect, test } from "bun:test";
import { ApiError } from "../src/lib/api";
import { discoverOutcome } from "../src/lib/discovery-outcome";

// OUT-205 — the add-product wizard creates the product BEFORE running discovery, so
// every refusal below happens with the SKU already saved and monitored. These pin the
// two things the old copy got wrong: a client timeout rendered as a failure, and a
// 500 / a monthly quota / an hourly cap collapsing into one "Couldn't run discovery
// now" that never said the product existed.

function apiError(status: number, body: Record<string, unknown>, message = "Request failed.") {
  return new ApiError(status, body, message);
}

describe("discoverOutcome", () => {
  test("a client timeout is pending, not a failure, and offers no retry", () => {
    const out = discoverOutcome(apiError(0, { error: "timeout" }));
    expect(out.tone).toBe("pending");
    expect(out.canRetry).toBe(false);
    expect(out.title).toMatch(/still searching/i);
  });

  test("a network drop is a failure the user can retry", () => {
    const out = discoverOutcome(apiError(0, { error: "network_error" }));
    expect(out.tone).toBe("failed");
    expect(out.canRetry).toBe(true);
  });

  test("the monthly quota names the plan's allowance and offers no retry", () => {
    const out = discoverOutcome(
      apiError(429, { error: "discovery_limit_reached", limit: 5, used: 5, upgradeHint: true }),
    );
    expect(out.title).toMatch(/monthly/i);
    expect(out.description).toContain("5 discovery scans");
    expect(out.canRetry).toBe(false);
  });

  test("a quota refusal without a limit still reads as a monthly cap", () => {
    const out = discoverOutcome(apiError(429, { error: "discovery_limit_reached" }));
    expect(out.title).toMatch(/monthly/i);
    expect(out.description).not.toContain("null");
  });

  test("the anti-double-click cooldown gives the wait in minutes and keeps retry", () => {
    const out = discoverOutcome(apiError(429, { error: "cooldown", retryInSec: 90 }));
    expect(out.title).toContain("2 min");
    expect(out.canRetry).toBe(true);
  });

  test("a sub-minute cooldown never says 0 min", () => {
    const out = discoverOutcome(apiError(429, { error: "cooldown", retryInSec: 12 }));
    expect(out.title).toContain("1 min");
  });

  test("the hourly AI cap keeps the API's own sentence and offers no retry", () => {
    const out = discoverOutcome(
      apiError(429, {
        error: "ai_rate_limit_exceeded",
        message: "You've used this hour's 10 AI actions. Try again in about 12 minutes.",
        retryAfterSeconds: 700,
      }),
    );
    expect(out.description).toContain("about 12 minutes");
    expect(out.canRetry).toBe(false);
  });

  test("an unknown 429 falls back to the hourly-cap branch with a usable sentence", () => {
    const out = discoverOutcome(apiError(429, { error: "rate_limited" }));
    expect(out.tone).toBe("failed");
    expect(out.description.length).toBeGreaterThan(0);
  });

  test("a thin profile points at the profile, not at a retry", () => {
    const out = discoverOutcome(apiError(400, { error: "missing_profile" }));
    expect(out.title).toMatch(/profile/i);
    expect(out.canRetry).toBe(false);
  });

  test("a 500 is a retryable failure of discovery alone", () => {
    const out = discoverOutcome(apiError(500, { error: "detection_failed" }));
    expect(out.tone).toBe("failed");
    expect(out.canRetry).toBe(true);
    expect(out.description).toMatch(/only the competitor search failed/i);
  });

  test("a non-API throw still produces the generic failure", () => {
    const out = discoverOutcome(new TypeError("boom"));
    expect(out.tone).toBe("failed");
    expect(out.canRetry).toBe(true);
  });

  test("every failure says the product survived", () => {
    const errors = [
      apiError(0, { error: "network_error" }),
      apiError(429, { error: "discovery_limit_reached", limit: 5 }),
      apiError(429, { error: "cooldown", retryInSec: 90 }),
      apiError(429, { error: "ai_rate_limit_exceeded", message: "Capped." }),
      apiError(400, { error: "missing_profile" }),
      apiError(500, { error: "detection_failed" }),
      new TypeError("boom"),
    ];
    for (const e of errors) {
      const out = discoverOutcome(e);
      expect(out.tone).toBe("failed");
      expect(`${out.title} ${out.description}`).toMatch(/product is saved/i);
    }
  });

  test("no copy leaks a raw error code or status", () => {
    const errors = [
      apiError(0, { error: "timeout" }),
      apiError(500, { error: "detection_failed" }, "Request failed (500)."),
      apiError(400, { error: "missing_profile" }),
    ];
    for (const e of errors) {
      const copy = `${discoverOutcome(e).title} ${discoverOutcome(e).description}`;
      expect(copy).not.toMatch(/detection_failed|missing_profile|Request failed/);
    }
  });
});
