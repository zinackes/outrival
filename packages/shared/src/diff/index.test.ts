import { describe, expect, it } from "bun:test";
import { computeHash, computeTextDiff, normalizeHtmlForDiff } from "./index";

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
