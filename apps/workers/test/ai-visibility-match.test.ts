import { describe, expect, test } from "bun:test";
import { buildEvidenceExcerpt, textNamesSubject } from "../src/lib/ai-visibility/match";

// Deterministic name-presence guard that validates an LLM `mentioned` verdict against
// the actual answer text (kills phantom mentions the classifier invents for names it's
// handed in the subject list).
describe("textNamesSubject", () => {
  test("matches a plain brand name, case-insensitively", () => {
    expect(textNamesSubject("We recommend Linear for issue tracking.", "Linear")).toBe(true);
    expect(textNamesSubject("we recommend LINEAR for tracking", "Linear")).toBe(true);
  });

  test("returns false when the name is absent (the hallucination case)", () => {
    // The bug: classifier said mentioned=true, but the name is nowhere in the answer.
    expect(textNamesSubject("Jira and Asana are popular choices.", "Linear")).toBe(false);
    expect(textNamesSubject("", "Linear")).toBe(false);
  });

  test("tolerates a trailing TLD on the roster name", () => {
    expect(textNamesSubject("Capydex helps track TCG collections.", "capydex.fr")).toBe(true);
    expect(textNamesSubject("Try linear.app or its alternatives.", "linear.app")).toBe(true);
  });

  test("is accent-insensitive both ways", () => {
    expect(textNamesSubject("Héberg is a French host.", "Heberg")).toBe(true);
    expect(textNamesSubject("Heberg is a French host.", "Héberg")).toBe(true);
  });

  test("matches multi-word brands across arbitrary whitespace", () => {
    expect(textNamesSubject("The best option is Acme  CRM today.", "Acme CRM")).toBe(true);
    expect(textNamesSubject("Acme\nCRM leads the market.", "Acme CRM")).toBe(true);
  });

  test("respects word boundaries — no substring false positives", () => {
    expect(textNamesSubject("The airplane landed.", "Lane")).toBe(false);
    expect(textNamesSubject("Notionally speaking, it works.", "Notion")).toBe(false);
    expect(textNamesSubject("Notion is a great tool.", "Notion")).toBe(true);
  });

  test("ignores 1-character names (too noisy to word-match)", () => {
    expect(textNamesSubject("X marks the spot.", "X")).toBe(false);
  });
});

// The evidence quote a question shows. The bug it fixes: `answer.slice(0, 2000)` cut
// before the engine named anyone, so the page listed three competitors above a quote in
// which none of them appear.
describe("buildEvidenceExcerpt", () => {
  const filler = (n: number) => "Collaborating on scheduled content takes structure. ".repeat(n);

  test("returns a short answer untouched", () => {
    expect(buildEvidenceExcerpt("Hootsuite leads.", ["Hootsuite"])).toBe("Hootsuite leads.");
  });

  test("keeps the opening AND a window around every name past the head cut", () => {
    const answer = `${filler(60)}The main options are Hootsuite, then Sprout Social, and finally Buffer.${filler(60)}`;
    const out = buildEvidenceExcerpt(answer, ["Hootsuite", "Sprout Social", "Buffer"]);
    expect(out.length).toBeLessThanOrEqual(2100);
    expect(out).toContain("Hootsuite");
    expect(out).toContain("Sprout Social");
    expect(out).toContain("Buffer");
    expect(out.startsWith("Collaborating")).toBe(true);
    expect(out).toContain("[…]");
  });

  test("names close together are quoted once, not twice", () => {
    const answer = `${filler(60)}Hootsuite and Buffer both do this.${filler(60)}`;
    const out = buildEvidenceExcerpt(answer, ["Hootsuite", "Buffer"]);
    expect(out.split("Hootsuite and Buffer").length - 1).toBe(1);
  });

  test("falls back to the head cut when no name is found", () => {
    const answer = filler(80);
    const out = buildEvidenceExcerpt(answer, ["Hootsuite"]);
    expect(out.startsWith("Collaborating")).toBe(true);
    expect(out.length).toBeLessThan(answer.length);
  });

  test("finds an accented name and quotes it from the original text", () => {
    const answer = `${filler(60)}Héberg is the French option here.${filler(60)}`;
    expect(buildEvidenceExcerpt(answer, ["Heberg"])).toContain("Héberg is the French option");
  });
});
