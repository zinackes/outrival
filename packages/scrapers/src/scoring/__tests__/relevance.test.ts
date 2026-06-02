import { test, expect, describe } from "bun:test";
import { scoreRelevance } from "../relevance";
import type { StructuredChange } from "../../diff/homepage-diff";

const change = (c: Partial<StructuredChange>): StructuredChange => ({
  kind: "hero_headline_changed",
  field: "hero.headline",
  before: null,
  after: null,
  ...c,
});

describe("scoreRelevance", () => {
  test("a real H1 rewrite passes the 0.5 threshold", () => {
    const r = scoreRelevance(
      change({
        kind: "hero_headline_changed",
        field: "hero.headline",
        before: "Project management for teams",
        after: "AI-powered project intelligence",
      }),
      { previousChangesInLast7Days: 0 },
    );
    expect(r.score).toBeGreaterThanOrEqual(0.5);
  });

  test("a footer tweak is filtered (< 0.5)", () => {
    const r = scoreRelevance(
      change({
        kind: "meta_changed",
        field: "footer",
        before: "© 2025 Acme Inc. All rights reserved.",
        after: "© 2025 Acme Inc. All rights reserved. Terms.",
      }),
      { previousChangesInLast7Days: 0 },
    );
    expect(r.score).toBeLessThan(0.5);
  });

  test("a new section is always high magnitude", () => {
    const r = scoreRelevance(
      change({ kind: "section_added", field: "sections[pricing]", after: "Pricing" }),
      { previousChangesInLast7Days: 0 },
    );
    expect(r.components.magnitude).toBe(1);
    expect(r.score).toBeGreaterThanOrEqual(0.5);
  });

  test("recency damps a competitor that changes constantly", () => {
    const c = change({
      kind: "hero_headline_changed",
      field: "hero.headline",
      before: "Project management for teams",
      after: "AI-powered project intelligence",
    });
    const calm = scoreRelevance(c, { previousChangesInLast7Days: 0 });
    const noisy = scoreRelevance(c, { previousChangesInLast7Days: 10 });
    expect(noisy.score).toBeLessThan(calm.score);
  });

  test("a large numeric claim move scores above threshold", () => {
    const r = scoreRelevance(
      change({
        kind: "numeric_claim_changed",
        field: "numeric_claim_changed",
        before: "10,000 teams",
        after: "50,000 teams",
        metadata: { variation: 4 },
      }),
      { previousChangesInLast7Days: 1 },
    );
    expect(r.score).toBeGreaterThanOrEqual(0.5);
  });
});
