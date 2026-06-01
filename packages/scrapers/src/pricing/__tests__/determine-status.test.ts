import { describe, expect, test } from "bun:test";
import { determineStatus } from "../determine-status";
import { emptySignals, type PricingSignals } from "../signals";

function signals(overrides: Partial<PricingSignals>): PricingSignals {
  return { ...emptySignals(), ...overrides };
}

describe("determineStatus — 6-status matrix", () => {
  test("prices only → public", () => {
    expect(determineStatus(signals({ hasPriceTokens: true })).status).toBe("public");
  });

  test("prices + gated → public_partial", () => {
    expect(
      determineStatus(signals({ hasPriceTokens: true, hasGatedKeywords: true })).status,
    ).toBe("public_partial");
  });

  test("gated only → gated_demo", () => {
    expect(determineStatus(signals({ hasGatedKeywords: true })).status).toBe("gated_demo");
  });

  test("signup wall + no prices → gated_signup", () => {
    expect(determineStatus(signals({ hasSignupWall: true })).status).toBe("gated_signup");
  });

  test("calculator → dynamic (even with a teaser price)", () => {
    expect(
      determineStatus(signals({ hasCalculator: true, hasPriceTokens: true })).status,
    ).toBe("dynamic");
  });

  test("nothing → unknown", () => {
    expect(determineStatus(emptySignals()).status).toBe("unknown");
  });
});

describe("determineStatus — precedence", () => {
  test("signup wall beats gated keywords when no prices", () => {
    expect(
      determineStatus(signals({ hasSignupWall: true, hasGatedKeywords: true })).status,
    ).toBe("gated_signup");
  });

  test("calculator beats gated keywords", () => {
    expect(
      determineStatus(signals({ hasCalculator: true, hasGatedKeywords: true })).status,
    ).toBe("dynamic");
  });
});
