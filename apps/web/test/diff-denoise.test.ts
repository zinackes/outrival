import { test, expect } from "bun:test";
import { denoiseDiffLines, type DiffLine } from "../src/lib/diff-denoise";

const add = (text: string): DiffLine => ({ kind: "add", text });
const remove = (text: string): DiffLine => ({ kind: "remove", text });
const texts = (lines: DiffLine[]) => lines.map((l) => `${l.kind[0]} ${l.text}`);

test("a line reported on both sides did not change, so neither side keeps it", () => {
  // The reading the user was right to distrust: a lexical diff re-emits text it
  // merely moved, and the panel showed it as both removed and added.
  const kept = denoiseDiffLines([
    add("Contact Sales"),
    add("Starter is now $29"),
    remove("Contact Sales"),
    remove("Starter is now $19"),
  ]);
  expect(texts(kept)).toEqual(["a Starter is now $29", "r Starter is now $19"]);
});

test("case and spacing are not a change either", () => {
  const kept = denoiseDiffLines([add("Book  a Demo"), remove("book a demo")]);
  expect(kept).toHaveLength(0);
});

test("single glyphs from letter-by-letter hero text are dropped", () => {
  // Measured on production: 674 such lines over 30 days, one per character of a
  // word the page animates.
  const kept = denoiseDiffLines(
    [..."LangSmith"].map((c) => add(c)).concat(add("Ship agents that work")),
  );
  expect(texts(kept)).toEqual(["a Ship agents that work"]);
});

test("a checkmark on its own is not evidence", () => {
  expect(denoiseDiffLines([remove("✓"), remove("·")])).toHaveLength(0);
});

test("navigation, legal and language chrome go, in every language present", () => {
  const kept = denoiseDiffLines([
    add("Pricing"),
    add("Datenschutz"),
    add("日本語"),
    add("© 2026 Acme, Inc."),
    add("mentions légales"),
    add("Unlimited seats on every plan"),
  ]);
  expect(texts(kept)).toEqual(["a Unlimited seats on every plan"]);
});

test("a call to action is kept: swapping the primary CTA is news", () => {
  const kept = denoiseDiffLines([add("Book a demo"), remove("Start free trial")]);
  expect(texts(kept)).toEqual(["a Book a demo", "r Start free trial"]);
});

test("a line repeated on one side is kept once", () => {
  // Logo carousels and repeated feature rows: "THE HOME DEPOT / Podium" arrived
  // three times in one production homepage diff.
  const kept = denoiseDiffLines([
    remove("THE HOME DEPOT"),
    remove("Podium"),
    remove("THE HOME DEPOT"),
    remove("Podium"),
    remove("THE HOME DEPOT"),
  ]);
  expect(texts(kept)).toEqual(["r THE HOME DEPOT", "r Podium"]);
});

test("the same text on opposite sides survives deduplication as a real pair", () => {
  // Guard against collapsing across sides: a price that moved is one line per
  // side and both have to reach the reader.
  const kept = denoiseDiffLines([add("$29 per seat"), remove("$19 per seat")]);
  expect(kept).toHaveLength(2);
});

test("a diff of nothing but chrome empties rather than inventing a change", () => {
  expect(denoiseDiffLines([add("Blog"), add("Careers"), remove("Support")])).toEqual([]);
});
