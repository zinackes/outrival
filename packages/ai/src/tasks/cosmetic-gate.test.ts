import { describe, expect, test } from "bun:test";
import { gateAppliesTo, suppressesAsCosmetic } from "./cosmetic-gate";

// Suppressing a change is invisible to the customer by construction — nothing is
// shown, so a wrong suppression is a signal lost in silence. These tests pin the
// two properties that keep that from happening: the gate fails OPEN, and it only
// ever runs on generic prose diffs.

describe("gateAppliesTo", () => {
  test("runs on generic prose sources", () => {
    for (const s of ["homepage", "pricing", "blog", "changelog", "custom", "github_repo", "jobs"]) {
      expect(gateAppliesTo(s)).toBe(true);
    }
  });

  test("skips list-shaped sources — a new entry there is new by construction", () => {
    for (const s of ["sitemap", "subdomains", "youtube", "news", "hackernews", "wellknown", "docs"]) {
      expect(gateAppliesTo(s)).toBe(false);
    }
  });

  test("skips the comparison-page anchor (deterministic signal, never AI-judged)", () => {
    expect(gateAppliesTo("comparison_page")).toBe(false);
  });

  test("an unknown source type is undefined-safe", () => {
    expect(gateAppliesTo(undefined)).toBe(false);
  });
});

describe("suppressesAsCosmetic", () => {
  const generic = { isStructured: false, sourceType: "blog" };

  test("an explicit cosmetic verdict on a generic change suppresses", () => {
    expect(
      suppressesAsCosmetic({ substantive: false, reason: "reworded hero" }, generic),
    ).toBe(true);
  });

  test("a substantive verdict does not suppress", () => {
    expect(suppressesAsCosmetic({ substantive: true, reason: "new price" }, generic)).toBe(false);
  });

  test("FAIL OPEN: a null gate never suppresses", () => {
    // Parse miss, provider down, circuit breaker open — the change must reach the
    // classifier exactly as it did before the gate existed.
    expect(suppressesAsCosmetic(null, generic)).toBe(false);
  });

  test("the structured homepage path is exempt even on a cosmetic verdict", () => {
    // Relevance scoring + volatile-line learning already dropped cosmetic churn
    // there, before a change row was written.
    expect(
      suppressesAsCosmetic(
        { substantive: false, reason: "reordered" },
        { isStructured: true, sourceType: "homepage" },
      ),
    ).toBe(false);
  });

  test("list-shaped sources are exempt even on a cosmetic verdict", () => {
    expect(
      suppressesAsCosmetic(
        { substantive: false, reason: "same urls, reordered" },
        { isStructured: false, sourceType: "sitemap" },
      ),
    ).toBe(false);
  });
});
