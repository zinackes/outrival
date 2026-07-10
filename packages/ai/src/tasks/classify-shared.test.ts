import { describe, expect, test } from "bun:test";
import { SEVERITY_RUBRIC, CATEGORY_RULES } from "./classify-shared";
import { CLASSIFY_SYSTEM } from "./classify";
import { buildStructuredClassifyPrompt } from "./classify-structured";

// Anti-divergence lock: both classifiers must judge by the SAME rubric. The
// blocks used to be pasted verbatim in two files; this pins them to the shared
// constants so an edit to one path can never silently fork the other.
describe("shared classification blocks", () => {
  test("the lexical classifier's system prompt embeds both blocks verbatim", () => {
    expect(CLASSIFY_SYSTEM).toContain(SEVERITY_RUBRIC);
    expect(CLASSIFY_SYSTEM).toContain(CATEGORY_RULES);
  });

  test("the structured classifier's prompt embeds both blocks verbatim", () => {
    const prompt = buildStructuredClassifyPrompt([
      { kind: "hero_headline_changed", field: "hero", before: "a", after: "b" },
    ]);
    expect(prompt).toContain(SEVERITY_RUBRIC);
    expect(prompt).toContain(CATEGORY_RULES);
  });

  test("the rubric still carries its load-bearing criteria", () => {
    // The critical gate is a two-part test + a tie-breaker toward high; the
    // guard (severity-guard.ts) and the dispatcher both assume this framing.
    expect(SEVERITY_RUBRIC).toContain("BOTH hold");
    expect(SEVERITY_RUBRIC).toContain('If unsure between "critical" and "high", choose "high".');
    expect(SEVERITY_RUBRIC).toContain("never on the size of the diff");
  });
});
