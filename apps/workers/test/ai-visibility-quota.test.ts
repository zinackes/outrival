import { describe, expect, test } from "bun:test";
import { retryAfterMs } from "../src/lib/ai-visibility/engines";

// Which 429 is this? A per-minute rate limit is worth waiting out; a spent daily
// allowance (or a model with no free grounding at all) means every remaining prompt
// of the run would be refused too. Reading those two the same way is what turned a
// healthy key into eleven days of empty runs.
const GOOGLE_PER_MINUTE = JSON.stringify({
  error: {
    code: 429,
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [
          {
            quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
            quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
          },
        ],
      },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "20s" },
    ],
  },
});

const GOOGLE_PER_DAY = GOOGLE_PER_MINUTE.replace("PerMinute", "PerDay");

describe("retryAfterMs", () => {
  test("waits out a per-minute rate limit, honouring the hinted delay", () => {
    expect(retryAfterMs(GOOGLE_PER_MINUTE, new Headers())).toBe(20_000);
  });

  test("never retries a per-day allowance, even when a retryDelay is offered", () => {
    // The named quota has to win over the hint, or we burn a call to be refused again.
    expect(retryAfterMs(GOOGLE_PER_DAY, new Headers())).toBeNull();
  });

  test("treats an unlabelled 429 as an allowance, not a rate limit", () => {
    // No quota id and no Retry-After (a model with no free grounding answers like this)
    // → drop the engine rather than hammer a closed door.
    expect(retryAfterMs('{"error":{"code":429}}', new Headers())).toBeNull();
  });

  test("honours a bare Retry-After header (providers with no quota metadata)", () => {
    const wait = retryAfterMs("rate limited", new Headers({ "retry-after": "20" }));
    expect(wait).toBe(20_000);
  });

  test("floors the wait at the pacing gap, so a 0s hint still spaces the retry", () => {
    const wait = retryAfterMs(GOOGLE_PER_MINUTE.replace('"20s"', '"0s"'), new Headers());
    expect(wait).toBe(13_000);
  });

  test("gives up when the provider asks for longer than the run can wait", () => {
    expect(retryAfterMs(GOOGLE_PER_MINUTE.replace('"20s"', '"90s"'), new Headers())).toBeNull();
  });
});
