import { test, expect } from "bun:test";
import { extractNumericClaims } from "../numeric-claims";

test("extracts a user-count claim with comma grouping", () => {
  const claims = extractNumericClaims("Trusted by 15,000 teams worldwide");
  const c = claims.find((x) => x.pattern === "user_count");
  expect(c).toBeDefined();
  expect(c?.value).toBe(15000);
  expect(c?.unit).toBe("teams");
});

test("expands k / M multipliers", () => {
  const k = extractNumericClaims("10k users").find((c) => c.pattern === "user_count");
  expect(k?.value).toBe(10000);
  const m = extractNumericClaims("Join 2M developers").find((c) => c.pattern === "user_count");
  expect(m?.value).toBe(2_000_000);
});

test("extracts uptime as a percentage", () => {
  const c = extractNumericClaims("99.9% uptime guaranteed").find((x) => x.pattern === "uptime");
  expect(c?.value).toBeCloseTo(99.9);
  expect(c?.unit).toBe("%");
  expect(c?.context).toBe("uptime");
});

test("extracts scale claims (million / billion)", () => {
  const claims = extractNumericClaims("Processing 2 billion requests and 500 million events");
  const reqs = claims.find((c) => c.context === "requests");
  const evts = claims.find((c) => c.context === "events");
  expect(reqs?.value).toBe(2_000_000_000);
  expect(evts?.value).toBe(500_000_000);
});

test("extracts savings", () => {
  const c = extractNumericClaims("Save up to 40% on your bill").find((x) => x.pattern === "savings");
  expect(c?.value).toBe(40);
  expect(c?.context).toBe("savings");
});

test("deduplicates repeated claims by (pattern, unit, context)", () => {
  const claims = extractNumericClaims("15,000 teams ... loved by 15,000 teams");
  expect(claims.filter((c) => c.context === "teams")).toHaveLength(1);
});

test("returns nothing on prose without numbers", () => {
  expect(extractNumericClaims("The best project management tool for modern teams.")).toEqual([
    // "teams" with no preceding number must NOT match a user_count.
  ]);
});
