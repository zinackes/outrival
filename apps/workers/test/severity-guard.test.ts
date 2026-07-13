import { describe, expect, test } from "bun:test";
import { applySeverityGuard } from "../src/lib/severity-guard";

// Plan-027 regression: "critical" bypasses every notification-moderation layer
// and pages the customer immediately, but the classifier is never told that
// stake. This guard demotes an unjustified "critical" to "high" — it must never
// upgrade a severity, and must never block the rubric's canonical critical case
// (a real direct-competitor pricing/funding/product move).

describe("applySeverityGuard — non-critical passthrough", () => {
  test("low/medium/high pass through untouched, any category/source", () => {
    for (const severity of ["low", "medium", "high"] as const) {
      const result = applySeverityGuard({
        severity,
        category: "content",
        sourceType: "jobs",
        diffText: "no price here",
      });
      expect(result).toEqual({ severity, demoted: false, reason: null });
    }
  });
});

describe("applySeverityGuard — critical demotion", () => {
  test("critical + category content → demoted, reason category_content", () => {
    const result = applySeverityGuard({
      severity: "critical",
      category: "content",
      sourceType: "homepage",
      diffText: "New tagline on the hero",
    });
    expect(result).toEqual({ severity: "high", demoted: true, reason: "category_content" });
  });

  test("critical + funding + source news → stays critical (Series F case)", () => {
    const result = applySeverityGuard({
      severity: "critical",
      category: "funding",
      sourceType: "news",
      diffText: "Acme raises $500M Series F",
    });
    expect(result).toEqual({ severity: "critical", demoted: false, reason: null });
  });

  test("critical + product + source jobs → demoted, reason source_jobs", () => {
    const result = applySeverityGuard({
      severity: "critical",
      category: "product",
      sourceType: "jobs",
      diffText: "50 new engineering roles posted",
    });
    expect(result).toEqual({ severity: "high", demoted: true, reason: "source_jobs" });
  });

  test("critical + pricing + source pricing + a price token → stays critical", () => {
    const result = applySeverityGuard({
      severity: "critical",
      category: "pricing",
      sourceType: "pricing",
      diffText: "Pro plan now $79/mo",
    });
    expect(result).toEqual({ severity: "critical", demoted: false, reason: null });
  });

  test("critical + pricing + source pricing + no price token → demoted", () => {
    const result = applySeverityGuard({
      severity: "critical",
      category: "pricing",
      sourceType: "pricing",
      diffText: "We simplified our plans",
    });
    expect(result).toEqual({
      severity: "high",
      demoted: true,
      reason: "pricing_without_price_token",
    });
  });
});

describe("applySeverityGuard — comparison_page carve-out (sitemap v2)", () => {
  test("critical + content + source comparison_page → stays critical (org attack)", () => {
    const result = applySeverityGuard({
      severity: "critical",
      category: "content",
      sourceType: "comparison_page",
      diffText: "Rival published /vs/outrival targeting you by name",
    });
    expect(result).toEqual({ severity: "critical", demoted: false, reason: null });
  });

  test("the carve-out is narrow: content critical from sitemap itself still demotes", () => {
    const result = applySeverityGuard({
      severity: "critical",
      category: "content",
      sourceType: "sitemap",
      diffText: "many new pages",
    });
    expect(result).toEqual({ severity: "high", demoted: true, reason: "category_content" });
  });

  test("a NON-content critical from comparison_page still demotes (only content is carved out)", () => {
    const result = applySeverityGuard({
      severity: "critical",
      category: "reviews",
      sourceType: "comparison_page",
      diffText: "x",
    });
    expect(result).toEqual({ severity: "high", demoted: true, reason: "category_reviews" });
  });
});

describe("applySeverityGuard — invariants", () => {
  test("never returns a severity above the input, never upgrades", () => {
    const inputs = [
      { severity: "low" as const, category: "pricing", sourceType: "pricing", diffText: "$79/mo" },
      { severity: "medium" as const, category: "funding", sourceType: "news", diffText: "raise" },
      { severity: "high" as const, category: "product", sourceType: "homepage", diffText: "launch" },
    ];
    for (const input of inputs) {
      const result = applySeverityGuard(input);
      expect(result.severity).toBe(input.severity);
      expect(result.demoted).toBe(false);
    }
  });

  test("never returns critical for a non-critical input", () => {
    const result = applySeverityGuard({
      severity: "high",
      category: "pricing",
      sourceType: "pricing",
      diffText: "$79/mo",
    });
    expect(result.severity).not.toBe("critical");
  });
});
