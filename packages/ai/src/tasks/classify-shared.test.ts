import { describe, expect, test } from "bun:test";
import { MATERIALITY_RUBRIC, CATEGORY_RULES } from "./classify-shared";
import { CLASSIFY_SYSTEM } from "./classify";
import { buildStructuredClassifyPrompt } from "./classify-structured";

// Anti-divergence lock: both classifiers must judge by the SAME rubric. The
// blocks used to be pasted verbatim in two files; this pins them to the shared
// constants so an edit to one path can never silently fork the other.
describe("shared classification blocks", () => {
  const structuredPrompt = buildStructuredClassifyPrompt([
    { kind: "hero_headline_changed", field: "hero", before: "a", after: "b" },
  ]);

  test("the lexical classifier's system prompt embeds both blocks verbatim", () => {
    expect(CLASSIFY_SYSTEM).toContain(MATERIALITY_RUBRIC);
    expect(CLASSIFY_SYSTEM).toContain(CATEGORY_RULES);
  });

  test("the structured classifier's prompt embeds both blocks verbatim", () => {
    expect(structuredPrompt).toContain(MATERIALITY_RUBRIC);
    expect(structuredPrompt).toContain(CATEGORY_RULES);
  });

  test("the rubric still carries its load-bearing criteria", () => {
    // The three axes ARE the contract with materiality.ts's mapping table: drop
    // one from the prompt and the model stops returning it, the schema fails to
    // parse, and every classification retries into a dead letter.
    expect(MATERIALITY_RUBRIC).toContain("decision_impact");
    expect(MATERIALITY_RUBRIC).toContain("urgency");
    expect(MATERIALITY_RUBRIC).toContain("corroboration");
    // Corroboration defaults to 1: without this instruction the model reads the
    // axis as "how sure am I" and inflates it, which would promote medium to high
    // across the whole feed.
    expect(MATERIALITY_RUBRIC).toContain("THIS IS THE NORMAL CASE");
    expect(MATERIALITY_RUBRIC).toContain("never on the size of the diff");
  });

  test("NEITHER classifier asks the model for a severity", () => {
    // The point of the materiality rework: the band is computed in TypeScript. If
    // a severity ever reappears in a prompt, the model's answer would silently win
    // over the mapping table for anyone reading the prompt as the spec.
    for (const prompt of [CLASSIFY_SYSTEM, structuredPrompt]) {
      expect(prompt).not.toContain('"severity"');
      expect(prompt).not.toContain("low|medium|high|critical");
      expect(prompt).not.toContain('"is_significant"');
    }
    expect(MATERIALITY_RUBRIC).toContain("Do NOT assign a severity");
  });

  test("the category rules cover the eleven model-chosen categories", () => {
    for (const c of [
      "pricing", "product", "hiring", "reviews", "content", "funding",
      "partnerships", "ma", "leadership", "security_compliance", "ads",
    ]) {
      expect(CATEGORY_RULES).toContain(`- ${c}:`);
    }
    // api_developer is deterministic-only — it must stay OUT of the prompt so the
    // model never picks it (see materiality.ts / sources.ts).
    expect(CATEGORY_RULES).not.toContain("api_developer");
  });
});
