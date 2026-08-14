import { test, expect, describe } from "bun:test";
import { hasDiscoveryInputs } from "./product-profile";

describe("hasDiscoveryInputs", () => {
  test("accepts a category alone", () => {
    expect(hasDiscoveryInputs({ category: "CRM", valueProp: "" })).toBe(true);
  });

  test("accepts a value proposition alone", () => {
    expect(hasDiscoveryInputs({ category: "", valueProp: "Close deals faster" })).toBe(true);
  });

  test("rejects an empty profile", () => {
    expect(hasDiscoveryInputs({ category: "", valueProp: "" })).toBe(false);
    expect(hasDiscoveryInputs(null)).toBe(false);
    expect(hasDiscoveryInputs(undefined)).toBe(false);
  });

  // The wizard gate trims before comparing; the API reads values back out of a
  // JSONB self-profile that stores them untrimmed. Both go through this predicate,
  // so whitespace has to decide the same way on either side.
  test("treats whitespace as empty", () => {
    expect(hasDiscoveryInputs({ category: "   ", valueProp: "\n\t" })).toBe(false);
    expect(hasDiscoveryInputs({ category: "  CRM  ", valueProp: "" })).toBe(true);
  });

  // A profile can reach the API with these fields absent (they are optional on the
  // stored shape), which must not read as "good enough to search on".
  test("handles missing and null fields", () => {
    expect(hasDiscoveryInputs({})).toBe(false);
    expect(hasDiscoveryInputs({ category: null, valueProp: null })).toBe(false);
    expect(hasDiscoveryInputs({ category: null, valueProp: "Ship faster" })).toBe(true);
  });
});
