import { describe, expect, test } from "bun:test";
import { serializeAskResults, type AskToolResult } from "./ask";

// The synthesis prompt's tool results must never be cut mid-JSON: an oversized
// result is replaced by an explicit OMITTED note, and later results still fit.

describe("serializeAskResults", () => {
  test("results within budget serialize verbatim and parse back", () => {
    const results: AskToolResult[] = [
      { tool: "getSignals", result: { signals: [{ id: "s1", insight: "x" }] } },
      { tool: "getPricingHistory", result: { plans: [{ planName: "Pro", price: 79 }] } },
    ];
    const parsed = JSON.parse(serializeAskResults(results));
    expect(parsed).toHaveLength(2);
    expect(parsed[1].result.plans[0].price).toBe(79);
  });

  test("an oversized result becomes an explicit note — never a mid-JSON cut", () => {
    const big = { tool: "compareCompetitors", result: { blob: "x".repeat(50_000) } };
    const small: AskToolResult = { tool: "getSignals", result: { signals: [] } };
    const out = serializeAskResults([big, small], 1_000);
    const parsed = JSON.parse(out); // would throw on a mid-JSON truncation
    expect(parsed[0].result).toContain("OMITTED");
    // The later small result still made it in — the big one didn't starve it.
    expect(parsed[1].tool).toBe("getSignals");
    expect(out.length).toBeLessThan(2_000);
  });
});
