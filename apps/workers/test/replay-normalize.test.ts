import { describe, expect, test } from "bun:test";
import { PricingSchema, JobsSchema } from "@outrival/ai";
import { normalizeReplayOutput } from "../src/lib/replay-normalize";

// SCR-20: replayExtractor returns a BARE ROWS ARRAY for list specs (pricing/jobs),
// but the target schemas expect an OBJECT ({ plans: [...] } / { jobs: [...] }) with
// fields the generated selector spec can't produce (non-null currency, an enum
// billing_period, a required department). Without this normalizer, a healed/cached
// spec's replay output never parses → cache/heal never persist (audit SCR-20).

describe("normalizeReplayOutput — pricing", () => {
  test("replayExtractor-shaped rows parse against PricingSchema after normalization", () => {
    const rows = [{ plan_name: "Pro", price: 29, currency: "€", billing_period: "/month" }];
    const result = normalizeReplayOutput("pricing", rows);
    const parsed = PricingSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.plans[0]?.currency).toBe("EUR");
      expect(parsed.data.plans[0]?.billing_period).toBe("monthly");
    }
  });

  test("quote-based tier (null price/currency/period) parses with USD + monthly defaults", () => {
    const rows = [{ plan_name: "Enterprise", price: null, currency: null, billing_period: null }];
    const result = normalizeReplayOutput("pricing", rows);
    const parsed = PricingSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.plans[0]?.currency).toBe("USD");
      expect(parsed.data.plans[0]?.billing_period).toBe("monthly");
    }
  });

  test("yearly label variants ('/yr', 'per year', 'par an') all map to yearly", () => {
    for (const label of ["/yr", "per year", "par an"]) {
      const rows = [{ plan_name: "Team", price: 290, currency: "USD", billing_period: label }];
      const result = normalizeReplayOutput("pricing", rows) as { plans: { billing_period: string }[] };
      expect(result.plans[0]?.billing_period).toBe("yearly");
    }
  });
});

describe("normalizeReplayOutput — jobs", () => {
  test("rows with no department parse against JobsSchema, defaulting to 'Other'", () => {
    const rows = [{ title: "SRE", location: "Remote" }];
    const result = normalizeReplayOutput("jobs", rows);
    const parsed = JobsSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.jobs[0]?.department).toBe("Other");
      expect(parsed.data.jobs[0]?.location).toBe("Remote");
    }
  });
});

describe("normalizeReplayOutput — passthrough", () => {
  test("non-array values pass through unchanged (single-object specs)", () => {
    const obj = { anything: 1 };
    expect(normalizeReplayOutput("pricing", obj)).toBe(obj);
  });

  test("null passes through unchanged", () => {
    expect(normalizeReplayOutput("pricing", null)).toBeNull();
  });
});

describe("SCR-20 regression — the module's reason for existing", () => {
  test("the RAW bare-rows array fails PricingSchema directly (no normalizer)", () => {
    const rows = [{ plan_name: "Pro", price: 29, currency: "€", billing_period: "/month" }];
    // If this ever starts passing, the schemas changed shape and this
    // normalizer's raison d'être (SCR-20) should be revisited.
    expect(PricingSchema.safeParse(rows).success).toBe(false);
  });
});
