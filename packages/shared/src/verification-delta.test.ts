import { describe, expect, it } from "bun:test";
import {
  buildDeltaProof,
  checkDeltaAgainst,
  formatExcerpts,
  hasDeltaEvidence,
  inverseFingerprintOf,
  isInverse,
  normalizeExcerpt,
  EXCERPT_MAX_CHARS,
  MAX_EXCERPTS,
} from "./verification-delta";

// The exact shape computeTextDiff persists: marker, space, line.
const lexical = (removed: string[], added: string[]) =>
  [...removed.map((l) => `- ${l}`), ...added.map((l) => `+ ${l}`)].join("\n");

describe("normalizeExcerpt", () => {
  it("collapses whitespace and lowercases", () => {
    expect(normalizeExcerpt("  Starter   plan\n\t$79/mo  ")).toBe("starter plan $79/mo");
  });
});

describe("buildDeltaProof — lexical change", () => {
  it("splits the diff into added and removed excerpts", () => {
    const proof = buildDeltaProof({
      diffText: lexical(["Starter plan is $79 per month"], ["Starter plan is $99 per month"]),
    });
    expect(proof.removedExcerpts).toEqual(["starter plan is $79 per month"]);
    expect(proof.addedExcerpts).toEqual(["starter plan is $99 per month"]);
    expect(hasDeltaEvidence(proof)).toBe(true);
  });

  it("keeps at most MAX_EXCERPTS per side, longest first", () => {
    const proof = buildDeltaProof({
      diffText: lexical(
        [],
        ["short one", "a considerably longer added line here", "medium length line", "another line entirely"],
      ),
    });
    expect(proof.addedExcerpts).toHaveLength(MAX_EXCERPTS);
    expect(proof.addedExcerpts[0]).toBe("a considerably longer added line here");
  });

  it("truncates an excerpt to EXCERPT_MAX_CHARS", () => {
    const long = "x".repeat(400);
    const proof = buildDeltaProof({ diffText: lexical([], [long]) });
    expect(proof.addedExcerpts[0]).toHaveLength(EXCERPT_MAX_CHARS);
  });

  it("drops excerpts too short to be distinctive", () => {
    const proof = buildDeltaProof({ diffText: lexical(["$79"], ["12"]) });
    expect(proof.addedExcerpts).toEqual([]);
    expect(proof.removedExcerpts).toEqual([]);
    expect(hasDeltaEvidence(proof)).toBe(false);
  });

  it("dedupes excerpts that normalise to the same text", () => {
    const proof = buildDeltaProof({
      diffText: lexical([], ["Starter  plan  moved", "starter plan moved"]),
    });
    expect(proof.addedExcerpts).toEqual(["starter plan moved"]);
  });
});

describe("buildDeltaProof — deterministic emitter", () => {
  it("falls back to the typed human_change pair when the diff has no markers", () => {
    const proof = buildDeltaProof({
      diffText: "Acme has moved its engineering pay upward in EUR: median 70000 to 80000.",
      humanChangeBefore: "Engineering (EUR) — p50 70,000",
      humanChangeAfter: "Engineering (EUR) — p50 80,000 (n=12)",
    });
    expect(proof.removedExcerpts).toEqual(["engineering (eur) — p50 70,000"]);
    expect(proof.addedExcerpts).toEqual(["engineering (eur) — p50 80,000 (n=12)"]);
  });

  it("prefers the diff sides when they exist, ignoring human_change", () => {
    const proof = buildDeltaProof({
      diffText: lexical(["the old pricing line"], ["the new pricing line"]),
      humanChangeBefore: "ignored before value",
      humanChangeAfter: "ignored after value",
    });
    expect(proof.addedExcerpts).toEqual(["the new pricing line"]);
  });

  it("has no evidence when neither source carries anything", () => {
    expect(hasDeltaEvidence(buildDeltaProof({ diffText: "" }))).toBe(false);
    expect(hasDeltaEvidence(buildDeltaProof({}))).toBe(false);
  });
});

describe("fingerprint", () => {
  it("is stable across line order", () => {
    const a = buildDeltaProof({ diffText: lexical(["removed line one"], ["added line one", "added line two"]) });
    const b = buildDeltaProof({ diffText: lexical(["removed line one"], ["added line two", "added line one"]) });
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("is stable across whitespace and casing", () => {
    const a = buildDeltaProof({ diffText: lexical(["Starter is $79 monthly"], ["Starter is $99 monthly"]) });
    const b = buildDeltaProof({ diffText: lexical(["starter   is $79   monthly"], ["STARTER is $99 monthly"]) });
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("differs when the content differs", () => {
    const a = buildDeltaProof({ diffText: lexical(["starter is $79 monthly"], ["starter is $99 monthly"]) });
    const b = buildDeltaProof({ diffText: lexical(["starter is $79 monthly"], ["starter is $89 monthly"]) });
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it("differs from its own inverse (the sides are not symmetric)", () => {
    const proof = buildDeltaProof({ diffText: lexical(["starter is $79 monthly"], ["starter is $99 monthly"]) });
    expect(inverseFingerprintOf(proof)).not.toBe(proof.fingerprint);
  });
});

describe("isInverse", () => {
  it("detects a flip back to the previous variant", () => {
    const forward = buildDeltaProof({ diffText: lexical(["starter is $79 monthly"], ["starter is $99 monthly"]) });
    const backward = buildDeltaProof({ diffText: lexical(["starter is $99 monthly"], ["starter is $79 monthly"]) });
    expect(isInverse(forward.fingerprint, backward)).toBe(true);
    expect(isInverse(backward.fingerprint, forward)).toBe(true);
  });

  it("is false for the same delta seen twice", () => {
    const forward = buildDeltaProof({ diffText: lexical(["starter is $79 monthly"], ["starter is $99 monthly"]) });
    const again = buildDeltaProof({ diffText: lexical(["starter is $79 monthly"], ["starter is $99 monthly"]) });
    expect(isInverse(forward.fingerprint, again)).toBe(false);
    expect(forward.fingerprint).toBe(again.fingerprint);
  });

  it("is false for an unrelated delta", () => {
    const a = buildDeltaProof({ diffText: lexical(["starter is $79 monthly"], ["starter is $99 monthly"]) });
    const b = buildDeltaProof({ diffText: lexical(["we now support single sign on"], ["we now support scim"]) });
    expect(isInverse(a.fingerprint, b)).toBe(false);
  });
});

describe("checkDeltaAgainst", () => {
  const proof = buildDeltaProof({
    diffText: lexical(["Starter plan is $79 per month"], ["Starter plan is $99 per month"]),
  });

  it("reproduces when the added text is present and the removed text is gone", () => {
    const result = checkDeltaAgainst("Plans\n\nSTARTER PLAN IS  $99  PER MONTH\nContact us", proof);
    expect(result.reproduced).toBe(true);
    expect(result.missingAdded).toEqual([]);
    expect(result.lingeringRemoved).toEqual([]);
  });

  it("fails when the added text never shows up", () => {
    const result = checkDeltaAgainst("Plans\n\nContact us for pricing", proof);
    expect(result.reproduced).toBe(false);
    expect(result.missingAdded).toEqual(["starter plan is $99 per month"]);
  });

  it("fails when the removed text is still on the page (an A/B flip back)", () => {
    const result = checkDeltaAgainst("Starter plan is $99 per month\nStarter plan is $79 per month", proof);
    expect(result.reproduced).toBe(false);
    expect(result.lingeringRemoved).toEqual(["starter plan is $79 per month"]);
  });

  it("handles a pure deletion: reproduced when the removed text is absent", () => {
    const deletion = buildDeltaProof({ diffText: lexical(["The free tier includes unlimited seats"], []) });
    expect(checkDeltaAgainst("Pricing starts at $10", deletion).reproduced).toBe(true);
    expect(checkDeltaAgainst("The free tier includes unlimited seats", deletion).reproduced).toBe(false);
  });

  it("ignores whitespace and casing differences between the two captures", () => {
    const result = checkDeltaAgainst("starter    plan\nis $99 per month", proof);
    expect(result.reproduced).toBe(true);
  });
});

describe("formatExcerpts", () => {
  it("renders both sides with their diff markers", () => {
    const proof = buildDeltaProof({ diffText: lexical(["was ninety nine dollars"], ["now seventy nine dollars"]) });
    expect(formatExcerpts(proof)).toBe("- was ninety nine dollars\n+ now seventy nine dollars");
  });
});
