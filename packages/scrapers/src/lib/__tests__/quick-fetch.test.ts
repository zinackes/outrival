import { describe, expect, test } from "bun:test";
import { quickFetchText } from "../quick-fetch";

// quickFetchText runs an in-process fetch in the API from a user-supplied URL
// (onboarding analyze). The SSRF guard must reject an internal host BEFORE any
// network call — these assertions would still pass with no network at all.
describe("quickFetchText SSRF guard", () => {
  test.each([
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1:3001/",
    "http://localhost/",
    "http://redis/",
  ])("rejects internal host %s without fetching", async (url) => {
    await expect(quickFetchText(url)).rejects.toThrow("unsafe_url");
  });
});
