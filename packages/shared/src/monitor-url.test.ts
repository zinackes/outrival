import { describe, expect, test } from "bun:test";
import { validatePublicUrl } from "./monitor-url";

// validatePublicUrl is the SSRF guard reused by the API (competitor / product
// URLs) and as a defense-in-depth net in the scraper layer (crawler.ts,
// quick-fetch.ts). These cases lock the host filter that those call sites rely on.
describe("validatePublicUrl", () => {
  test("accepts a normal public https site", () => {
    const r = validatePublicUrl("https://stripe.com/pricing");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBe("https://stripe.com/pricing");
  });

  test("accepts plain http on a public host", () => {
    expect(validatePublicUrl("http://example.com").ok).toBe(true);
  });

  test("accepts an off-domain ATS host (jobs)", () => {
    expect(validatePublicUrl("https://boards.greenhouse.io/acme").ok).toBe(true);
  });

  test.each([
    ["IPv4 literal", "http://169.254.169.254/latest/meta-data/"],
    ["IPv4 loopback", "http://127.0.0.1/internal"],
    ["IPv6 literal", "http://[::1]/"],
    ["localhost", "http://localhost/"],
    ["*.localhost", "http://api.localhost/"],
    ["*.internal", "http://db.internal/"],
    ["*.local", "http://printer.local/"],
    ["single-label intranet host", "http://redis/"],
    ["decimal IP form (no dot → single-label)", "http://2130706433/"],
  ])("rejects %s as host_not_allowed", (_label, url) => {
    const r = validatePublicUrl(url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("host_not_allowed");
  });

  test("rejects embedded credentials", () => {
    const r = validatePublicUrl("https://user:pass@example.com");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("credentials_not_allowed");
  });

  test("rejects a non-standard port", () => {
    const r = validatePublicUrl("http://example.com:8080/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("port_not_allowed");
  });

  test("rejects a non-http(s) scheme", () => {
    const r = validatePublicUrl("file:///etc/passwd");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("must_be_http");
  });

  test("rejects an unparseable url", () => {
    const r = validatePublicUrl("not a url");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid_url");
  });
});
