import { test, expect, describe } from "bun:test";
import { leftProductScope, normalizeScope } from "../src/lib/product-scope";

// The rule behind `useCompetitorScopeGuard`: a competitor page leaves ONLY when the
// product scope moves to a product that doesn't track that competitor. Every other
// case stays put — a redirect the user didn't ask for costs more than a mismatch.

const A = "prod-a";
const B = "prod-b";
const ROSTER_B = [{ id: "c-2" }, { id: "c-3" }];

describe("leftProductScope", () => {
  test("leaves when the new scope's roster lacks the competitor", () => {
    expect(
      leftProductScope({
        scope: B,
        mountScope: A,
        roster: ROSTER_B,
        competitorId: "c-1",
      }),
    ).toBe(true);
  });

  test("stays when the competitor is tracked for both products", () => {
    expect(
      leftProductScope({
        scope: B,
        mountScope: A,
        roster: ROSTER_B,
        competitorId: "c-2",
      }),
    ).toBe(false);
  });

  test("stays on 'All products' — it contains every competitor", () => {
    expect(
      leftProductScope({
        scope: null,
        mountScope: A,
        roster: [],
        competitorId: "c-1",
      }),
    ).toBe(false);
  });

  test("stays when the scope never moved (deep link under a stale cookie scope)", () => {
    expect(
      leftProductScope({
        scope: B,
        mountScope: B,
        roster: ROSTER_B,
        competitorId: "c-1",
      }),
    ).toBe(false);
  });

  test("stays while the roster is unknown — loading or failed reads fail open", () => {
    expect(
      leftProductScope({
        scope: B,
        mountScope: A,
        roster: undefined,
        competitorId: "c-1",
      }),
    ).toBe(false);
  });

  test("leaves when the new product tracks nothing at all", () => {
    expect(
      leftProductScope({ scope: B, mountScope: A, roster: [], competitorId: "c-1" }),
    ).toBe(true);
  });

  test("the 'all' sentinel normalizes to no scope, so it never orphans a page", () => {
    expect(
      leftProductScope({
        scope: normalizeScope("all"),
        mountScope: A,
        roster: [],
        competitorId: "c-1",
      }),
    ).toBe(false);
  });
});
