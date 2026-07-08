import { describe, expect, test } from "bun:test";
import { textNamesSubject } from "../src/lib/ai-visibility/match";

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
