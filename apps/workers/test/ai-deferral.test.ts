import { describe, expect, it } from "bun:test";
import { AIUnavailableError } from "@outrival/ai";
import { resolveAiDeferral } from "../src/queue/ai-deferral";

const BASE = 75;
const MAX = Math.round(BASE * 1.4);

describe("resolveAiDeferral", () => {
  it("defers when the whole pool refused the request", () => {
    const sec = resolveAiDeferral(new AIUnavailableError("all_providers_failed: 429"));
    expect(sec).not.toBeNull();
    expect(sec!).toBeGreaterThanOrEqual(BASE);
    expect(sec!).toBeLessThanOrEqual(MAX);
  });

  it("defers past what a free-tier 429 asks for", () => {
    // Groq asks for up to ~18s, Cerebras up to ~60s. Coming back inside that window
    // is the whole failure this replaces.
    expect(resolveAiDeferral(new AIUnavailableError("no_providers_available"))!).toBeGreaterThan(60);
  });

  // An env mistake is still an env mistake in 75 seconds. Rescheduling it would hide
  // it from the dead-letter queue, which is the only place anyone would see it.
  it("does not defer a misconfigured pool", () => {
    expect(
      resolveAiDeferral(new AIUnavailableError("ai_provider_misconfigured: check base url")),
    ).toBeNull();
  });

  it("does not defer a request no provider would accept", () => {
    expect(resolveAiDeferral(new AIUnavailableError("ai_request_too_large: 413"))).toBeNull();
  });

  // A fault we have not identified must keep the normal retry policy, so it is
  // retried promptly and dead-lettered if it persists.
  it("leaves every non-pool error to the retry policy", () => {
    expect(resolveAiDeferral(new Error("Unterminated string in JSON"))).toBeNull();
    expect(resolveAiDeferral(new TypeError("undefined is not a function"))).toBeNull();
    expect(resolveAiDeferral("not even an error")).toBeNull();
    expect(resolveAiDeferral(null)).toBeNull();
  });

  // The spread exists so an outage's deferred jobs do not all come back at once and
  // rebuild the burst. It is one-sided: never earlier than the base.
  it("spreads returns across a window without ever coming back early", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const sec = resolveAiDeferral(new AIUnavailableError("all_providers_failed"))!;
      expect(sec).toBeGreaterThanOrEqual(BASE);
      expect(sec).toBeLessThanOrEqual(MAX);
      seen.add(sec);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
