import { describe, expect, it } from "bun:test";
import {
  computeHash,
  computeTextDiff,
  formatDiffForPrompt,
  normalizeHtmlForDiff,
  parseLabelledDiff,
  splitDiffText,
} from "./index";

describe("normalizeHtmlForDiff", () => {
  it("strips csrf meta tags so the token churn does not flip the hash", () => {
    const before = `<head><meta name="csrf-token" content="aaa111"></head><body><h1>Pricing</h1></body>`;
    const after = `<head><meta name="csrf-token" content="bbb222"></head><body><h1>Pricing</h1></body>`;

    expect(computeHash(normalizeHtmlForDiff(before))).toBe(
      computeHash(normalizeHtmlForDiff(after)),
    );
    expect(computeTextDiff(normalizeHtmlForDiff(before), normalizeHtmlForDiff(after)).hasChanges).toBe(
      false,
    );
  });

  it("strips hidden anti-forgery inputs (name before or after value)", () => {
    const before = `<form><input type="hidden" name="_csrf" value="x1"><button>Go</button></form>`;
    const after = `<form><input value="x2" type="hidden" name="_csrf"><button>Go</button></form>`;

    expect(computeTextDiff(normalizeHtmlForDiff(before), normalizeHtmlForDiff(after)).hasChanges).toBe(
      false,
    );
  });

  it("strips CSP nonces from script tags", () => {
    const before = `<script nonce="n-aaa">var x=1</script>`;
    const after = `<script nonce="n-bbb">var x=1</script>`;

    expect(normalizeHtmlForDiff(before)).toBe(normalizeHtmlForDiff(after));
  });

  it("strips csrf token assignments inside inline scripts", () => {
    const before = `<script>window.config={csrfToken:"tok-aaa",plan:"pro"}</script>`;
    const after = `<script>window.config={csrfToken:"tok-bbb",plan:"pro"}</script>`;

    expect(normalizeHtmlForDiff(before)).toBe(normalizeHtmlForDiff(after));
  });

  it("still reports a real content change", () => {
    const before = `<head><meta name="csrf-token" content="aaa"></head><body><h1>$10/mo</h1></body>`;
    const after = `<head><meta name="csrf-token" content="bbb"></head><body><h1>$20/mo</h1></body>`;

    const diff = computeTextDiff(
      normalizeHtmlForDiff(before),
      normalizeHtmlForDiff(after),
    );
    expect(diff.hasChanges).toBe(true);
    expect(diff.added.join("")).toContain("$20/mo");
  });

  it("leaves prose mentioning 'nonce' untouched", () => {
    const html = `<body><p>The nonce: a number used once in cryptography.</p></body>`;
    expect(normalizeHtmlForDiff(html)).toBe(html.trim());
  });
});

describe("computeTextDiff line polarity", () => {
  // diffLines groups consecutive changed lines into ONE part, so a multi-line hunk
  // used to leave every line but the first with no marker. A bare line has no side,
  // and both the prompts and the web preview had to guess or drop it.
  it("marks every line of a multi-line hunk, not only the first", () => {
    const before = "Only pay for the channels you use\nAdd channels as you grow\nFooter";
    const after = "Flexible pricing for everyone\nFooter";

    const { diffText } = computeTextDiff(before, after);
    const body = diffText.split("\n").filter((l) => l.trim());

    expect(body.every((l) => l.startsWith("- ") || l.startsWith("+ "))).toBe(true);
    expect(diffText).toContain("- Add channels as you grow");
  });

  it("round-trips through splitDiffText onto the right sides", () => {
    const { diffText } = computeTextDiff("old one\nold two\nkeep", "new one\nkeep");

    const { removed, added } = splitDiffText(diffText);
    expect(removed).toEqual(["old one", "old two"]);
    expect(added).toEqual(["new one"]);
  });

  it("reads a legacy row's unmarked continuation line as part of the open side", () => {
    // Written before per-line prefixing: only the first line of the hunk is marked.
    // Dropping the rest, or treating it as its own side, misattributes exactly the
    // text these labels exist to disambiguate.
    const legacy = "- Only pay for the channels you use\nAdd channels as you grow\n+ Flexible pricing";

    expect(splitDiffText(legacy)).toEqual({
      removed: ["Only pay for the channels you use", "Add channels as you grow"],
      added: ["Flexible pricing"],
    });
  });
});

describe("formatDiffForPrompt", () => {
  it("labels each side and states what the labels mean", () => {
    const out = formatDiffForPrompt("- gone\n+ here");

    expect(out).toContain("NO LONGER shows");
    expect(parseLabelledDiff(out)).toEqual({ removed: "gone", added: "here" });
  });

  it("omits a side that has no lines rather than emitting an empty block", () => {
    const out = formatDiffForPrompt("+ brand new page");

    expect(out).not.toContain("<removed>");
    expect(parseLabelledDiff(out)).toEqual({ removed: "", added: "brand new page" });
  });

  it("hands back a marker-less blob untouched instead of claiming a side for it", () => {
    const blob = "some unstructured evidence";

    expect(formatDiffForPrompt(blob)).toBe(blob);
    expect(parseLabelledDiff(blob)).toBeNull();
  });
});
