import { describe, expect, it } from "bun:test";
import { AIUnavailableError } from "./circuit-breaker";
import { aiErrorKind } from "./error-kind";

const kind = (msg: string) => aiErrorKind(new AIUnavailableError(msg));

describe("aiErrorKind", () => {
  it("reads the reason the pool put in the prefix", () => {
    expect(kind("ai_provider_misconfigured: every provider rejected the request")).toBe(
      "misconfigured",
    );
    expect(kind("ai_out_of_credit: every provider answered 402")).toBe("out_of_credit");
    expect(kind("ai_request_too_large: ~12400 tokens exceeds every ceiling")).toBe("too_large");
    expect(kind("ai_empty_completions: empty completion from cerebras")).toBe("empty_replies");
  });

  it("separates a saturated pool from a broken one", () => {
    expect(kind("no_providers_available")).toBe("no_providers");
  });

  it("labels a call the global breaker refused as a consequence, not a new failure", () => {
    expect(kind("too_many_failures")).toBe("breaker_open");
    expect(kind("too_many_failures:cerebras")).toBe("breaker_open");
    expect(kind("ai_unavailable")).toBe("breaker_open");
  });

  it("keeps the real cause when the breaker rethrows one", () => {
    expect(kind("ai_provider_misconfigured")).toBe("misconfigured");
    expect(kind("ai_out_of_credit")).toBe("out_of_credit");
  });

  it("recognises a rate limit in whatever words the vendor used", () => {
    expect(kind("all_providers_failed: 429 status code (no body)")).toBe("rate_limited");
    expect(
      kind("all_providers_failed: Rate limit reached for model gpt-oss-120b, try again in 5.91s"),
    ).toBe("rate_limited");
    expect(kind("all_providers_failed: Too Many Requests")).toBe("rate_limited");
    expect(kind("all_providers_failed: quota exceeded for this account")).toBe("rate_limited");
  });

  it("falls back to transient for a cross-provider failure with no rate limit in it", () => {
    expect(kind("all_providers_failed: 503 upstream connect error")).toBe("transient");
  });

  it("labels nothing when the throw did not come from the pool", () => {
    expect(aiErrorKind(new Error("Unterminated string in JSON at position 812"))).toBe("");
    expect(aiErrorKind(undefined)).toBe("");
    expect(aiErrorKind("429")).toBe("");
  });
});
