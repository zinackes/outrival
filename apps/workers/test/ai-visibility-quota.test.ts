import { describe, expect, test } from "bun:test";
import { namesSpentAllowance, retryAfterMs } from "../src/lib/ai-visibility/engines";
import { pickModel } from "../src/lib/ai-visibility/budget";

// Which 429 is this? A per-minute rate limit costs one prompt at most; a spent daily
// allowance means every remaining prompt of the run would be refused too. Reading
// those two the same way is what turned a healthy key into eleven days of empty runs,
// and then into six concurrent runs answering one prompt each.
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
const GOOGLE_PER_MONTH = GOOGLE_PER_MINUTE.replace("PerMinute", "PerMonth");

describe("namesSpentAllowance", () => {
  test("only a per-day or per-month quota ends the engine for the run", () => {
    expect(namesSpentAllowance(GOOGLE_PER_DAY)).toBe(true);
    expect(namesSpentAllowance(GOOGLE_PER_MONTH)).toBe(true);
    expect(namesSpentAllowance(GOOGLE_PER_MINUTE)).toBe(false);
  });

  test("an unreadable 429 is a speed problem, not a spent allowance", () => {
    // This is the case that used to condemn the engine for the whole run, so one
    // blip cost every remaining prompt of every remaining product. It must cost one.
    expect(namesSpentAllowance('{"error":{"code":429}}')).toBe(false);
    expect(namesSpentAllowance("rate limited")).toBe(false);
  });
});

describe("retryAfterMs", () => {
  test("waits out a per-minute rate limit, honouring the hinted delay", () => {
    expect(retryAfterMs(GOOGLE_PER_MINUTE, new Headers())).toBe(20_000);
  });

  test("never retries a per-day allowance, even when a retryDelay is offered", () => {
    // The named quota has to win over the hint, or we burn a call to be refused again.
    expect(retryAfterMs(GOOGLE_PER_DAY, new Headers())).toBeNull();
  });

  test("honours a bare Retry-After header (providers with no quota metadata)", () => {
    expect(retryAfterMs("rate limited", new Headers({ "retry-after": "20" }))).toBe(20_000);
  });

  test("floors the wait at the pacing gap, so a 0s hint still spaces the retry", () => {
    expect(retryAfterMs(GOOGLE_PER_MINUTE.replace('"20s"', '"0s"'), new Headers())).toBe(13_000);
  });

  test("waits one gap on a 429 it cannot read at all", () => {
    // No quota id, no hint. Waiting one gap is the cheap, safe reading: the caller
    // gives the prompt up after two of these, and the drip re-offers it tomorrow.
    expect(retryAfterMs('{"error":{"code":429}}', new Headers())).toBe(13_000);
  });

  test("rides out a delay the old 30s ceiling would have called an allowance", () => {
    // Google's free tier routinely asks for 45s on a per-minute limit. Refusing to
    // wait meant reporting "quota exhausted" while 1,473 grounded requests were left.
    expect(retryAfterMs(GOOGLE_PER_MINUTE.replace('"20s"', '"45s"'), new Headers())).toBe(45_000);
  });

  test("gives up when the provider asks for longer than the prompt is worth", () => {
    expect(retryAfterMs(GOOGLE_PER_MINUTE.replace('"20s"', '"90s"'), new Headers())).toBeNull();
  });
});

describe("pickModel", () => {
  const MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];

  test("a prompt keeps the same model across runs", () => {
    // The invariant that makes multi-bucket capacity safe: two models disagree about
    // which brands they name, so a prompt that changed writer would read as a
    // share-of-voice move that never happened.
    const first = pickModel(MODELS, "prompt-id-42");
    for (let i = 0; i < 20; i++) expect(pickModel(MODELS, "prompt-id-42")).toBe(first);
  });

  test("spreads different prompts across the buckets", () => {
    const keys = Array.from({ length: 200 }, (_, i) => `prompt-${i}`);
    const used = new Set(keys.map((k) => pickModel(MODELS, k)));
    expect(used.size).toBe(2);
  });

  test("a single configured model is always the answer", () => {
    expect(pickModel(["gemini-2.5-flash"], "anything")).toBe("gemini-2.5-flash");
  });

  test("never invents a model outside the configured list", () => {
    const keys = Array.from({ length: 100 }, (_, i) => `k${i}`);
    for (const k of keys) expect(MODELS).toContain(pickModel(MODELS, k));
  });
});
