import { describe, expect, test } from "bun:test";
import { severityForImportance, signalEligibleTechs } from "../src/lib/tech-stack-signal";

// Audit 2026-07-09: 31 of 110 sampled prod signals (28% of the feed) were
// tech-stack "New technology detected" false-adoptions from the FIRST scan of
// a competitor (an empty baseline makes everything look "appeared"), some at
// severity high on plain marketing-script tells. These tests pin: (1) the
// baseline scan never signals, whatever the importance, and (2) severity for
// a tech-appearance signal never reaches "high".

describe("signalEligibleTechs — baseline scan noise", () => {
  test("baseline scan → no signals, even with high-importance techs present", () => {
    const appeared = [
      { importance: "high", name: "Stripe" },
      { importance: "medium", name: "Vercel" },
    ];
    expect(
      signalEligibleTechs(appeared, { isBaselineScan: true, minImportance: "high" }),
    ).toEqual([]);
  });

  test("non-baseline + minImportance high: drops medium, keeps high", () => {
    const appeared = [
      { importance: "medium", name: "Vercel" },
      { importance: "high", name: "Stripe" },
    ];
    const result = signalEligibleTechs(appeared, {
      isBaselineScan: false,
      minImportance: "high",
    });
    expect(result).toEqual([{ importance: "high", name: "Stripe" }]);
  });

  test("non-baseline + minImportance medium: keeps medium and high, drops low", () => {
    const appeared = [
      { importance: "low", name: "Google Fonts" },
      { importance: "medium", name: "Vercel" },
      { importance: "high", name: "Stripe" },
    ];
    const result = signalEligibleTechs(appeared, {
      isBaselineScan: false,
      minImportance: "medium",
    });
    expect(result).toEqual([
      { importance: "medium", name: "Vercel" },
      { importance: "high", name: "Stripe" },
    ]);
  });

  test("unknown minImportance (e.g. empty string from a mis-set env) does not throw and passes everything (rank 0)", () => {
    const appeared = [
      { importance: "low", name: "Google Fonts" },
      { importance: "medium", name: "Vercel" },
      { importance: "high", name: "Stripe" },
    ];
    const result = signalEligibleTechs(appeared, { isBaselineScan: false, minImportance: "" });
    expect(result).toEqual(appeared);
  });
});

describe("severityForImportance — never alert-tier for a tech tell", () => {
  test("high importance caps at medium", () => {
    expect(severityForImportance("high")).toBe("medium");
  });

  test("medium importance maps to low", () => {
    expect(severityForImportance("medium")).toBe("low");
  });

  test("never returns high for any input", () => {
    for (const importance of ["low", "medium", "high", "unknown"]) {
      expect(severityForImportance(importance)).not.toBe("high");
    }
  });
});
