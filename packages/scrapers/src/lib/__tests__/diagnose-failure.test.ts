import { describe, expect, test } from "bun:test";
import { diagnoseFailure, isOffsiteRedirect, type AttemptInfo } from "../diagnose-failure";

const URL = "https://linear.app";

describe("diagnoseFailure", () => {
  test("404 → site_dead (high)", () => {
    const attempts: AttemptInfo[] = [
      { ok: false, statusCode: 404, failureReason: "needs_render" },
    ];
    const d = diagnoseFailure(attempts, URL);
    expect(d.category).toBe("site_dead");
    expect(d.confidence).toBe("high");
    expect(d.suggestedAction).toBe("detect_pivot");
  });

  test("network_error → site_dead (medium)", () => {
    const d = diagnoseFailure([{ ok: false, failureReason: "network_error" }], URL);
    expect(d.category).toBe("site_dead");
    expect(d.confidence).toBe("medium");
  });

  test("redirect to a different root domain → site_redirected", () => {
    const d = diagnoseFailure(
      [{ ok: true, statusCode: 200, finalUrl: "https://atlassian.com/landing" }],
      URL,
    );
    expect(d.category).toBe("site_redirected");
    expect(d.suggestedAction).toBe("detect_pivot");
  });

  test("redirect within the same root domain is NOT a redirect", () => {
    const d = diagnoseFailure(
      [{ ok: false, failureReason: "needs_render", finalUrl: "https://blog.linear.app" }],
      URL,
    );
    expect(d.category).not.toBe("site_redirected");
  });

  test("password input → login_required", () => {
    const html = `<form><input type="password" name="pw"/></form>`;
    const d = diagnoseFailure([{ ok: true, statusCode: 200, html }], URL);
    expect(d.category).toBe("login_required");
    expect(d.suggestedAction).toBe("propose_alternative");
  });

  test("needs_render with tiny text → spa_empty (capture_api)", () => {
    const d = diagnoseFailure(
      [{ ok: false, statusCode: 200, failureReason: "needs_render", text: "Loading" }],
      URL,
    );
    expect(d.category).toBe("spa_empty");
    expect(d.suggestedAction).toBe("capture_api");
  });

  test("geo-blocking copy → geo_blocked", () => {
    const html = `<html><body><h1>This content is not available in your region</h1></body></html>`;
    const d = diagnoseFailure([{ ok: false, html }], URL);
    expect(d.category).toBe("geo_blocked");
  });

  test("cloudflare challenge → anti_bot (mark_unscrapable, no bypass)", () => {
    const d = diagnoseFailure([{ ok: false, failureReason: "cloudflare_challenge" }], URL);
    expect(d.category).toBe("anti_bot");
    expect(d.suggestedAction).toBe("mark_unscrapable");
  });

  test("no clear pattern → unknown (mark_unscrapable)", () => {
    const d = diagnoseFailure([{ ok: false, failureReason: "timeout" }], URL);
    expect(d.category).toBe("unknown");
    expect(d.suggestedAction).toBe("mark_unscrapable");
  });

  test("dead status is found even when it's not the last attempt", () => {
    const d = diagnoseFailure(
      [
        { ok: false, statusCode: 410, failureReason: "needs_render" },
        { ok: false, failureReason: "timeout" },
      ],
      URL,
    );
    expect(d.category).toBe("site_dead");
  });
});

// R6 (2026-07 audit, T5): the same cross-root check the failure path uses, exposed
// so the SUCCESS path can grade an offsite-redirected capture `partial`. It must
// stay conservative — only a genuinely different registrable domain, never a
// locale path, a subdomain, or a www toggle (those are still the right site).
describe("isOffsiteRedirect", () => {
  test("different registrable domain → offsite", () => {
    expect(isOffsiteRedirect("https://acme.com", "https://acme-parked.com")).toBe(true);
    expect(isOffsiteRedirect("https://acme.com/pricing", "https://buydomain.io/parked")).toBe(true);
  });

  test("locale path on the same host → NOT offsite", () => {
    expect(isOffsiteRedirect("https://acme.com/pricing", "https://acme.com/fr/pricing")).toBe(false);
  });

  test("subdomain of the same root → NOT offsite", () => {
    expect(isOffsiteRedirect("https://acme.com", "https://blog.acme.com")).toBe(false);
  });

  test("www toggle → NOT offsite", () => {
    expect(isOffsiteRedirect("https://www.acme.com", "https://acme.com")).toBe(false);
    expect(isOffsiteRedirect("https://acme.com", "https://www.acme.com")).toBe(false);
  });

  test("identical URL → NOT offsite", () => {
    expect(isOffsiteRedirect("https://acme.com/x", "https://acme.com/x")).toBe(false);
  });

  test("unparseable finalUrl → NOT offsite (fail safe, never grade partial on garbage)", () => {
    expect(isOffsiteRedirect("https://acme.com", "not a url")).toBe(false);
    expect(isOffsiteRedirect("also not a url", "https://acme.com")).toBe(false);
  });
});
