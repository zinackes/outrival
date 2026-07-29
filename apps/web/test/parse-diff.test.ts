import { test, expect } from "bun:test";
import { parseDiff } from "../src/components/outrival/diff-preview";

const marked = (kind: "+" | "-", n: number, label: string) =>
  Array.from({ length: n }, (_, i) => `${kind} ${label} ${i + 1}`).join("\n");

test("the added side survives a change that removed more lines than the cap", () => {
  // The regression this exists for: with removals emitted first and a flat cap,
  // a page that dropped 30 lines and gained 3 rendered only the deleted text, so
  // the reader never saw the news and read removals as the competitor's new
  // position.
  const diff = `${marked("-", 30, "old")}\n${marked("+", 3, "new")}`;
  const { lines, truncated } = parseDiff(diff, 18);

  const added = lines.filter((l) => l.kind === "add");
  expect(added).toHaveLength(3);
  expect(added[0]!.text).toBe("new 1");
  // Added leads: the first thing read is what the page now says.
  expect(lines[0]!.kind).toBe("add");
  expect(lines).toHaveLength(18);
  expect(truncated).toBe(true);
});

test("a one-sided change spends the whole budget on that side", () => {
  const { lines, truncated } = parseDiff(marked("+", 12, "role"), 18);
  expect(lines).toHaveLength(12);
  expect(lines.every((l) => l.kind === "add")).toBe(true);
  expect(truncated).toBe(false);
});

test("both sides long: the budget splits so neither starves", () => {
  const diff = `${marked("-", 40, "old")}\n${marked("+", 40, "new")}`;
  const { lines, truncated } = parseDiff(diff, 18);
  expect(lines.filter((l) => l.kind === "add")).toHaveLength(9);
  expect(lines.filter((l) => l.kind === "remove")).toHaveLength(9);
  expect(truncated).toBe(true);
});

test("markup-only lines leave nothing to render", () => {
  const { lines } = parseDiff("+ <div></div>\n- <span>  </span>", 18);
  expect(lines).toHaveLength(0);
});

test("continuation lines of a multi-line hunk keep the side the marker opened", () => {
  // Rows written before per-line prefixing carry a marker on the hunk's first
  // line only; splitDiffText attributes the rest to that side.
  const { lines } = parseDiff("+ first added\nsecond added\n- first removed", 18);
  expect(lines.filter((l) => l.kind === "add").map((l) => l.text)).toEqual([
    "first added",
    "second added",
  ]);
  expect(lines.filter((l) => l.kind === "remove").map((l) => l.text)).toEqual([
    "first removed",
  ]);
});
