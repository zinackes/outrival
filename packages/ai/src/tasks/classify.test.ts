import { describe, expect, test } from "bun:test";
import { buildClassifyContextBlock } from "./classify";

// The context block is what grounds the lexical classifier. For a custom-page
// monitor the page-type hint is injected as an explicit line — a big relevance win
// for the long-tail source — so lock that it actually reaches the prompt.
describe("buildClassifyContextBlock — custom-page hint", () => {
  test("injects the hint as its own line", () => {
    const block = buildClassifyContextBlock({
      sourceType: "custom",
      competitorName: "Acme",
      hint: "security",
    });
    expect(block).toContain("This page is the competitor's security page.");
    // Still names where the change was detected.
    expect(block).toContain("Acme");
  });

  test("each supported hint surfaces verbatim", () => {
    for (const hint of ["legal", "team", "product", "security", "docs", "other"]) {
      const block = buildClassifyContextBlock({ sourceType: "custom", hint });
      expect(block).toContain(`This page is the competitor's ${hint} page.`);
    }
  });

  test("no hint → no hint line (unchanged behaviour for other sources)", () => {
    const block = buildClassifyContextBlock({ sourceType: "pricing", competitorName: "Acme" });
    expect(block).not.toContain("This page is the competitor's");
    expect(block).toContain("pricing page");
  });

  test("empty context → empty block", () => {
    expect(buildClassifyContextBlock({})).toBe("");
  });
});
