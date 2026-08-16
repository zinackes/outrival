import { describe, expect, test } from "bun:test";

import { isGitHubRepoUrl, isValidHttpUrl } from "../src/lib/utils";

// OUT-203: the add-product wizard used to gate a "developing" product on
// isValidHttpUrl, so a non-GitHub URL created a github_repo monitor that could
// never resolve. Both forms now share this single rule.
describe("isGitHubRepoUrl", () => {
  test("accepts an owner/repo URL on github.com", () => {
    expect(isGitHubRepoUrl("https://github.com/vercel/next.js")).toBe(true);
    expect(isGitHubRepoUrl("https://www.github.com/vercel/next.js")).toBe(true);
  });

  test("accepts deeper paths and a trailing slash", () => {
    expect(isGitHubRepoUrl("https://github.com/vercel/next.js/")).toBe(true);
    expect(isGitHubRepoUrl("https://github.com/vercel/next.js/tree/canary")).toBe(true);
  });

  test("trims surrounding whitespace", () => {
    expect(isGitHubRepoUrl("  https://github.com/vercel/next.js  ")).toBe(true);
  });

  test("rejects another host, even when it is a valid http URL", () => {
    for (const url of [
      "https://gitlab.com/vercel/next.js",
      "https://example.com",
      "https://notgithub.com/vercel/next.js",
    ]) {
      expect(isValidHttpUrl(url)).toBe(true);
      expect(isGitHubRepoUrl(url)).toBe(false);
    }
  });

  test("rejects github.com without an owner and a repo", () => {
    expect(isGitHubRepoUrl("https://github.com")).toBe(false);
    expect(isGitHubRepoUrl("https://github.com/vercel")).toBe(false);
  });

  test("rejects a non-http scheme and garbage", () => {
    expect(isGitHubRepoUrl("git@github.com:vercel/next.js.git")).toBe(false);
    expect(isGitHubRepoUrl("github.com/vercel/next.js")).toBe(false);
    expect(isGitHubRepoUrl("")).toBe(false);
  });
});
