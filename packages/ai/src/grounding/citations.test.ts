import { describe, expect, it } from "bun:test";
import { validateCitations, computeSimilarity } from "./citations";

const SOURCE = `Linear is built for high-performance teams.
Pricing: the Standard plan is $8 per user per month, billed annually.
We serve thousands of software companies who want speed and focus.`;

describe("validateCitations", () => {
  it("passes an exact quote", () => {
    const r = validateCitations(
      [{ assertion: "Standard is $8/user/mo", sourceQuote: "the Standard plan is $8 per user per month" }],
      SOURCE,
    );
    expect(r.passed).toBe(true);
    expect(r.score).toBe(1);
    expect(r.validCitations[0]?.position).toBeDefined();
  });

  it("passes a slightly reworded quote via fuzzy match", () => {
    const r = validateCitations(
      [{ assertion: "built for fast teams", sourceQuote: "Linear is built for high performance teams" }],
      SOURCE,
    );
    expect(r.passed).toBe(true);
  });

  it("fails an invented quote", () => {
    const r = validateCitations(
      [{ assertion: "Enterprise tier", sourceQuote: "the Enterprise plan is $99 per user per month" }],
      SOURCE,
    );
    expect(r.passed).toBe(false);
    expect(r.failedCitations).toHaveLength(1);
    expect(r.score).toBe(0);
  });

  it("scores a partial set", () => {
    const r = validateCitations(
      [
        { assertion: "real", sourceQuote: "We serve thousands of software companies" },
        { assertion: "fake", sourceQuote: "free forever for open source projects" },
      ],
      SOURCE,
    );
    expect(r.passed).toBe(false);
    expect(r.score).toBe(0.5);
    expect(r.validCitations).toHaveLength(1);
    expect(r.failedCitations).toHaveLength(1);
  });

  it("treats no citations as vacuously passed", () => {
    const r = validateCitations([], SOURCE);
    expect(r.passed).toBe(true);
    expect(r.score).toBe(1);
  });
});

describe("computeSimilarity", () => {
  it("is 1 for identical strings", () => {
    expect(computeSimilarity("hello world", "hello world")).toBe(1);
  });
  it("is 0 against an empty string", () => {
    expect(computeSimilarity("hello", "")).toBe(0);
  });
  it("is high for a one-char edit", () => {
    expect(computeSimilarity("competitor", "competetor")).toBeGreaterThan(0.85);
  });
});
