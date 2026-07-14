import { test, expect } from "bun:test";
import { verdictFor } from "./scrape-page";

// The collection doctrine, expressed as the per-attempt decision:
//   a site refusal (block / challenge / robots) STOPS the cascade — it is never
//   escalated to a different IP or fingerprint; only "needs a render" escalates.

test("a successful attempt is done", () => {
  expect(verdictFor({ ok: true })).toBe("done");
});

test("every explicit refusal stops the cascade (no escalation)", () => {
  for (const reason of [
    "blocked_403",
    "blocked_503",
    "cloudflare_challenge",
    "soft_block",
    "robots_disallowed",
  ]) {
    expect(verdictFor({ ok: false, failureReason: reason })).toBe("refused");
  }
});

test("needs_render is the ONLY reason that escalates (L0 → render)", () => {
  expect(verdictFor({ ok: false, failureReason: "needs_render" })).toBe("escalate");
});

test("transient / dead-target failures fail fast, never escalate", () => {
  for (const reason of ["http_error", "network_error", "timeout"]) {
    expect(verdictFor({ ok: false, failureReason: reason })).toBe("fail");
  }
});

test("an unknown/absent failure reason fails fast (never treated as a refusal)", () => {
  expect(verdictFor({ ok: false })).toBe("fail");
  expect(verdictFor({ ok: false, failureReason: "something_new" })).toBe("fail");
});
