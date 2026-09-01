import { describe, expect, test } from "bun:test";
import {
  validatePublicUrl,
  validateCustomMonitorUrl,
  normalizeCustomUrl,
  validateMonitorUrl,
} from "./monitor-url";

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

// validateCustomMonitorUrl locks a "Watch a custom page" URL to the competitor's
// exact registrable domain (eTLD+1). Unlike validateMonitorUrl (brand-by-label,
// cross-TLD), a different registrable domain is rejected; subdomains are fine.
describe("validateCustomMonitorUrl", () => {
  const competitor = "https://acme.example";

  test("accepts a page on the competitor's own domain", () => {
    const r = validateCustomMonitorUrl("https://acme.example/security", competitor);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBe("https://acme.example/security");
  });

  test("accepts a subdomain of the competitor's registrable domain", () => {
    expect(validateCustomMonitorUrl("https://docs.acme.example/legal/tos", competitor).ok).toBe(true);
  });

  test("rejects a different registrable domain (eTLD+1 mismatch)", () => {
    const r = validateCustomMonitorUrl("https://not-acme.example/security", competitor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("custom_url_domain_mismatch");
  });

  test("rejects a same-label but different-TLD domain (stricter than brand match)", () => {
    // validateMonitorUrl would accept acme.io for acme.example (same "acme" label);
    // the custom domain lock requires the full eTLD+1 to match.
    const r = validateCustomMonitorUrl("https://acme.io/security", competitor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("custom_url_domain_mismatch");
  });

  test("rejects when the competitor has no url to lock against", () => {
    const r = validateCustomMonitorUrl("https://acme.example/security", null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("custom_url_domain_mismatch");
  });

  test("requires https and blocks SSRF hosts even on the same-domain path", () => {
    expect(validateCustomMonitorUrl("http://acme.example/x", competitor).ok).toBe(false);
    const ip = validateCustomMonitorUrl("https://169.254.169.254/", competitor);
    expect(ip.ok).toBe(false);
  });
});

describe("normalizeCustomUrl", () => {
  test("collapses trailing slash and fragment so the same page dedupes", () => {
    expect(normalizeCustomUrl("https://acme.example/enterprise/")).toBe(
      normalizeCustomUrl("https://acme.example/enterprise"),
    );
    expect(normalizeCustomUrl("https://acme.example/enterprise#top")).toBe(
      normalizeCustomUrl("https://acme.example/enterprise"),
    );
  });

  test("keeps distinct query strings distinct", () => {
    expect(normalizeCustomUrl("https://acme.example/docs?tab=security")).not.toBe(
      normalizeCustomUrl("https://acme.example/docs?tab=billing"),
    );
  });
});

// The off-domain exceptions. Each one exists because a source genuinely does not
// live on the competitor's own domain, and refusing it left the user unable to
// answer a "no such surface" verdict they knew to be wrong.
describe("validateMonitorUrl: status pages are rarely on the competitor's brand", () => {
  const ok = (url: string, competitor = "https://acme.com") =>
    validateMonitorUrl("status", url, competitor).ok;

  test("accepts the two vendor hosts the scraper can actually read", () => {
    expect(ok("https://acme.statuspage.io")).toBe(true);
    expect(ok("https://acme.instatus.com")).toBe(true);
  });

  test("accepts the sibling-domain convention, with or without a separator", () => {
    expect(ok("https://www.vercel-status.com", "https://vercel.com")).toBe(true);
    expect(ok("https://www.githubstatus.com", "https://github.com")).toBe(true);
  });

  test("still accepts a status page on their own domain", () => {
    expect(ok("https://status.acme.com")).toBe(true);
  });

  test("the sibling rule is anchored, so a lookalike is not a sibling", () => {
    // startsWith would have accepted this one.
    expect(ok("https://vercelstatus-phish.com", "https://vercel.com")).toBe(false);
    // A shared prefix is not a status page.
    expect(ok("https://acmestatus.com", "https://acme.com")).toBe(true);
    expect(ok("https://acmestatuspage.com", "https://acme.com")).toBe(false);
    // And an unrelated brand stays out entirely.
    expect(ok("https://evil.com")).toBe(false);
  });

  test("a status vendor is not a licence for every other source", () => {
    expect(validateMonitorUrl("pricing", "https://acme.statuspage.io", "https://acme.com").ok).toBe(
      false,
    );
    expect(validateMonitorUrl("blog", "https://vercel-status.com", "https://vercel.com").ok).toBe(
      false,
    );
  });
});

describe("validateMonitorUrl: pinned third-party profiles", () => {
  test("a Trustpilot profile is accepted only for the Trustpilot source", () => {
    const url = "https://www.trustpilot.com/review/acme.com";
    expect(validateMonitorUrl("trustpilot_public", url, "https://acme.com").ok).toBe(true);
    expect(validateMonitorUrl("homepage", url, "https://acme.com").ok).toBe(false);
  });

  test("a YouTube channel is accepted only for the YouTube source", () => {
    const url = "https://www.youtube.com/@acme";
    expect(validateMonitorUrl("youtube", url, "https://acme.com").ok).toBe(true);
    expect(validateMonitorUrl("blog", url, "https://acme.com").ok).toBe(false);
  });

  test("the SSRF guard is untouched by any of it", () => {
    expect(validateMonitorUrl("status", "http://acme.statuspage.io", "https://acme.com").ok).toBe(
      false,
    );
    expect(validateMonitorUrl("status", "https://127.0.0.1", "https://acme.com").ok).toBe(false);
    expect(
      validateMonitorUrl("status", "https://user:pw@acme.statuspage.io", "https://acme.com").ok,
    ).toBe(false);
  });
});

// code:SEC-03 — validateMonitorUrl used to skip the isUnsafeHost check its two
// sibling validators run. extractBrand reduces a 3-label host under an unrecognized
// suffix to its middle label, so `x.<brand>.internal` matched sameBrand and was
// stored as a valid monitor URL. Every case below fails on the pre-fix function.
describe("validateMonitorUrl: internal hosts never pass the brand match", () => {
  const competitor = "https://acme.com";

  test.each([
    ["*.internal under the competitor's brand", "https://x.acme.internal/"],
    ["*.local under the competitor's brand", "https://x.acme.local/"],
    ["*.localhost under the competitor's brand", "https://x.acme.localhost/"],
  ])("rejects %s", (_label, url) => {
    const r = validateMonitorUrl("homepage", url, competitor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("host_not_allowed");
  });

  test("still accepts the competitor's real domain", () => {
    expect(validateMonitorUrl("homepage", "https://www.acme.com/", competitor).ok).toBe(true);
  });

  test("still accepts the off-domain ATS exception for jobs", () => {
    expect(
      validateMonitorUrl("jobs", "https://boards.greenhouse.io/acme", competitor).ok,
    ).toBe(true);
  });
});
