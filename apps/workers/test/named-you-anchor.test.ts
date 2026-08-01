import { describe, expect, test } from "bun:test";
import { applySeverityGuard } from "../src/lib/severity-guard";

// Content Intelligence v2 P2 — why `competitor_named_you` is written onto the
// per-competitor `comparison_page` anchor rather than onto the blog change it was
// found in.
//
// generate-signal runs applySeverityGuard over EVERY classification, including the
// synthesized ones this feature emits. content/critical survives from exactly one
// source, and the blog is not it: anchored on the blog, the alert would be demoted
// to "high" in silence — no page, no bypass of the moderation layers — and the
// feature would look like it works.
//
// (The second reason is not testable here and lives in the job's comment: the
// lexical classifier still emits its own signal on that same blog change, and
// signals.changeId is unique, so one of the two would lose.)

describe("competitor_named_you keeps its critical", () => {
  test("from the comparison_page anchor, content/critical survives", () => {
    const result = applySeverityGuard({
      severity: "critical",
      category: "content",
      sourceType: "comparison_page",
      diffText: 'Acme published a post that names your product: "Acme vs Outrival"',
    });
    expect(result).toEqual({ severity: "critical", demoted: false, reason: null });
  });

  test("anchored on the blog instead, the same alert would be demoted", () => {
    const result = applySeverityGuard({
      severity: "critical",
      category: "content",
      sourceType: "blog",
      diffText: 'Acme published a post that names your product: "Acme vs Outrival"',
    });
    expect(result.severity).toBe("high");
    expect(result.demoted).toBe(true);
  });
});
