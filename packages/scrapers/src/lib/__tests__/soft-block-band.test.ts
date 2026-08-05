import { describe, test, expect } from "bun:test";
import { isSoftBlockShell, SOFT_BLOCK_TEXT_BAND } from "../block-detection";
import { extractContent, isContentCollapsed } from "../extract-content";

/** The decision as scrape-patchright makes it, so fixtures drive the real call. */
function verdict(innerText: string, html: string, statusCode = 200): boolean {
  return isSoftBlockShell(
    innerText.length,
    statusCode,
    isContentCollapsed(extractContent(html)),
  );
}

// A styled shell: chrome only, empty <main>. ~300 chars of innerText — inside the
// audit's 100-600 dead band, which the pre-P1 band of 100 accepted as a success.
const SHELL_HTML =
  `<html><head><title>Acme</title></head><body>` +
  `<nav></nav><main></main><footer></footer>` +
  `</body></html>`;
const SHELL_INNER_TEXT =
  "Acme Home Product Pricing Docs Company Careers Blog Contact Log in Sign up " +
  "© 2026 Acme Inc. Privacy Terms Cookies Status Security Trust Center " +
  "Twitter LinkedIn GitHub YouTube English Français Deutsch Español ";

// A real marketing page whose copy lives in a <canvas>/WebGL hero: innerText reads
// near-empty (computed CSS), the markup carries the text. The reason the band is
// only a trigger and the markup cross-check is the verdict.
const CANVAS_HERO_HTML =
  `<html><head><title>Acme</title></head><body><main>` +
  `<h1>Ship your roadmap, not your infrastructure</h1>` +
  `<p>${"Teams at every stage use Acme to keep shipping. ".repeat(20)}</p>` +
  `</main></body></html>`;

describe("isSoftBlockShell — the widened band (R6)", () => {
  test("a styled shell inside the 100-600 dead band is now caught", () => {
    expect(SHELL_INNER_TEXT.length).toBeGreaterThan(100);
    expect(SHELL_INNER_TEXT.length).toBeLessThan(SOFT_BLOCK_TEXT_BAND);
    expect(verdict(SHELL_INNER_TEXT, SHELL_HTML)).toBe(true);
  });

  test("the same shell was NOT caught by the pre-P1 band of 100", () => {
    // The regression this widening closes, asserted rather than described.
    expect(SHELL_INNER_TEXT.length < 100).toBe(false);
  });

  test("a canvas/WebGL hero with real markup is never a soft block", () => {
    expect(verdict("", CANVAS_HERO_HTML)).toBe(false);
    expect(verdict("Ship", CANVAS_HERO_HTML)).toBe(false);
  });

  test("a page above the band is never a soft block, whatever its markup", () => {
    expect(verdict("x".repeat(SOFT_BLOCK_TEXT_BAND), SHELL_HTML)).toBe(false);
  });

  test("an HTTP error body is an http error, not a soft block", () => {
    expect(verdict(SHELL_INNER_TEXT, SHELL_HTML, 404)).toBe(false);
    expect(verdict(SHELL_INNER_TEXT, SHELL_HTML, 503)).toBe(false);
  });

  test("an empty render with empty markup is still caught (pre-P1 behaviour kept)", () => {
    expect(verdict("", SHELL_HTML)).toBe(true);
  });
});
