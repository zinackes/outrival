import { describe, expect, test } from "bun:test";
import { diagnoseFailure, type AttemptInfo } from "../diagnose-failure";

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

  test("cloudflare challenge → anti_bot (retry_camoufox)", () => {
    const d = diagnoseFailure([{ ok: false, failureReason: "cloudflare_challenge" }], URL);
    expect(d.category).toBe("anti_bot");
    expect(d.suggestedAction).toBe("retry_camoufox");
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
