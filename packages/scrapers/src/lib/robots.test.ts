import { test, expect } from "bun:test";
import { evaluateIsAllowed, evaluateCrawlDelayMs } from "./robots";

const U = (path: string) => `https://example.com${path}`;

test("absent robots.txt (empty body) → everything allowed", () => {
  expect(evaluateIsAllowed("", U("/"))).toBe(true);
  expect(evaluateIsAllowed("", U("/anything?q=1"))).toBe(true);
});

test("Disallow: / blocks the whole site for the wildcard group", () => {
  const body = "User-agent: *\nDisallow: /";
  expect(evaluateIsAllowed(body, U("/"))).toBe(false);
  expect(evaluateIsAllowed(body, U("/pricing"))).toBe(false);
});

test("Disallow: /admin blocks the subtree but allows the rest", () => {
  const body = "User-agent: *\nDisallow: /admin";
  expect(evaluateIsAllowed(body, U("/admin"))).toBe(false);
  expect(evaluateIsAllowed(body, U("/admin/users"))).toBe(false);
  expect(evaluateIsAllowed(body, U("/pricing"))).toBe(true);
});

test("empty Disallow explicitly allows everything", () => {
  const body = "User-agent: *\nDisallow:";
  expect(evaluateIsAllowed(body, U("/anything"))).toBe(true);
});

test("Allow out-specifies a broader Disallow", () => {
  const body = "User-agent: *\nDisallow: /docs\nAllow: /docs/public";
  expect(evaluateIsAllowed(body, U("/docs/private"))).toBe(false);
  expect(evaluateIsAllowed(body, U("/docs/public/guide"))).toBe(true);
});

test("an OutrivalBot-specific group overrides the wildcard group", () => {
  const body = [
    "User-agent: *",
    "Disallow:",
    "",
    "User-agent: OutrivalBot",
    "Disallow: /",
  ].join("\n");
  // The wildcard allows all, but our named group forbids all → our group wins.
  expect(evaluateIsAllowed(body, U("/"))).toBe(false);
});

test("case-insensitive user-agent + field names", () => {
  const body = "user-agent: outrivalbot\nDISALLOW: /private";
  expect(evaluateIsAllowed(body, U("/private"))).toBe(false);
  expect(evaluateIsAllowed(body, U("/public"))).toBe(true);
});

test("wildcard * and $ end-anchor in patterns", () => {
  const star = "User-agent: *\nDisallow: /*.pdf";
  expect(evaluateIsAllowed(star, U("/files/report.pdf"))).toBe(false);
  expect(evaluateIsAllowed(star, U("/files/report.html"))).toBe(true);

  const anchor = "User-agent: *\nDisallow: /page$";
  expect(evaluateIsAllowed(anchor, U("/page"))).toBe(false);
  expect(evaluateIsAllowed(anchor, U("/page/child"))).toBe(true);
});

test("comments and blank lines are ignored", () => {
  const body = "# hello\nUser-agent: *   # us\n\nDisallow: /x  # nope\n";
  expect(evaluateIsAllowed(body, U("/x"))).toBe(false);
  expect(evaluateIsAllowed(body, U("/y"))).toBe(true);
});

test("query string is part of the matched path", () => {
  const body = "User-agent: *\nDisallow: /search?";
  expect(evaluateIsAllowed(body, U("/search?q=abc"))).toBe(false);
  expect(evaluateIsAllowed(body, U("/results"))).toBe(true);
});

test("Crawl-delay is parsed to milliseconds for our group", () => {
  expect(evaluateCrawlDelayMs("User-agent: *\nCrawl-delay: 5")).toBe(5000);
  expect(evaluateCrawlDelayMs("User-agent: OutrivalBot\nCrawl-delay: 2")).toBe(2000);
  expect(evaluateCrawlDelayMs("User-agent: *\nDisallow: /")).toBeNull();
  expect(evaluateCrawlDelayMs("")).toBeNull();
});

test("directives before any User-agent are ignored (no accidental block)", () => {
  const body = "Disallow: /\nUser-agent: *\nDisallow: /admin";
  expect(evaluateIsAllowed(body, U("/"))).toBe(true);
  expect(evaluateIsAllowed(body, U("/admin"))).toBe(false);
});
