import { describe, expect, test } from "bun:test";
import { detectDenyPage, isSyntheticDocument } from "./deny-page";

// A deny page (soft-404, geo/access block, login wall, worded verification
// interstitial) responds 200 with real-looking HTML but isn't the real content —
// storing it as a "success" snapshot fabricates phantom diffs once the site
// recovers. These cases mirror the prod incidents from the 2026-07-09 audit.

describe("detectDenyPage", () => {
  test("client-rendered 404 (short body) → soft_404", () => {
    const html = `<!doctype html><html><head><title>404 — Not Found</title></head>
      <body><div id="root"><h1>404</h1><p>Not Found</p></div></body></html>`;
    expect(detectDenyPage(html)).toBe("soft_404");
  });

  test("access-denied page (short) → access_denied", () => {
    const html = `<html><head><title>Blocked</title></head>
      <body><h1>Access Denied</h1><p>You don't have permission to access this resource.</p></body></html>`;
    expect(detectDenyPage(html)).toBe("access_denied");
  });

  test("geo block copy → access_denied", () => {
    const html = `<html><head><title>Restricted</title></head>
      <body><h1>Sorry</h1><p>This content is not available in your country.</p></body></html>`;
    expect(detectDenyPage(html)).toBe("access_denied");
  });

  test("login wall with password input → login_wall", () => {
    const html = `<html><head><title>Sign in</title></head>
      <body><form><input type="email" name="email"><input type="password" name="password">
      <button>Sign in</button></form></body></html>`;
    expect(detectDenyPage(html)).toBe("login_wall");
  });

  test("worded verification page (no vendor strings) → verification_wall", () => {
    const html = `<html><head><title>example.com</title></head>
      <body><h1>One moment, please...</h1><p>Your request is being verified. This may take a few seconds.</p></body></html>`;
    expect(detectDenyPage(html)).toBe("verification_wall");
  });

  test("negative: long real page mentioning 404 in an article + sign-in in a footer → null", () => {
    const article = "This is a real paragraph about our product roadmap. ".repeat(80);
    const html = `<html><head><title>Our Blog — Acme</title></head>
      <body>
        <h1>Why our uptime hit 99.99% after the 2019 outage (error 404 postmortem)</h1>
        <p>${article}</p>
        <footer><a href="/login">Sign in</a> to comment.</footer>
      </body></html>`;
    expect(detectDenyPage(html)).toBe(null);
  });

  test("negative: real pricing page with prices, > 3000 chars → null", () => {
    const filler = "Everything you need to grow your business, all in one platform. ".repeat(60);
    const html = `<html><head><title>Pricing — Acme</title></head>
      <body>
        <h1>Plans and pricing</h1>
        <p>${filler}</p>
        <div class="plan"><h2>Starter</h2><p>$29/mo</p></div>
        <div class="plan"><h2>Pro</h2><p>$99/mo</p></div>
      </body></html>`;
    expect(detectDenyPage(html)).toBe(null);
  });

  test("negative: short legit landing page (hero + CTA, no deny copy) → null", () => {
    const html = `<html><head><title>Acme — Project management for teams</title></head>
      <body><h1>Ship faster with Acme</h1><p>The project management tool built for engineering teams.</p>
      <button>Get started</button></body></html>`;
    expect(detectDenyPage(html)).toBe(null);
  });

  // Regression: every branch is length-gated. A false positive on the success path
  // grades a HEALTHY capture partial → silences that monitor's diffs/signals/
  // extraction forever, so a real page carrying deny-shaped markup must pass.

  test("negative: long real page with a hidden inline password login form → null", () => {
    const filler = "Manage your whole operation from one dashboard — invoicing, CRM, and support. ".repeat(60);
    const html = `<html><head><title>Acme — All-in-one platform</title></head>
      <body>
        <h1>The platform that runs your business</h1>
        <p>${filler}</p>
        <dialog id="login"><form>
          <input type="email" name="email">
          <input type="password" name="password">
          <button>Log in</button>
        </form></dialog>
      </body></html>`;
    expect(detectDenyPage(html)).toBe(null);
  });

  test("negative: long real docs article quoting 'One moment, please' in prose → null", () => {
    const filler = "This guide walks through configuring loading states in the Acme SDK. ".repeat(60);
    const html = `<html><head><title>Loading states — Acme Docs</title></head>
      <body>
        <h1>Showing loading states</h1>
        <p>${filler}</p>
        <p>Show a spinner labelled "One moment, please" while data loads.</p>
      </body></html>`;
    expect(detectDenyPage(html)).toBe(null);
  });
});

describe("isSyntheticDocument", () => {
  test("true for a synthesized sitemap document", () => {
    const html = `<!doctype html><html><body><section data-outrival-sitemap><ul>` +
      `<li>https://acme.com/</li><li>https://acme.com/pricing</li></ul></section></body></html>`;
    expect(isSyntheticDocument(html)).toBe(true);
  });

  test("true for a synthesized ATS jobs document", () => {
    const html = `<!doctype html><html><body><section data-outrival-ats><ul>` +
      `<li>Senior Engineer</li></ul></section></body></html>`;
    expect(isSyntheticDocument(html)).toBe(true);
  });

  test("false for a real fetched page", () => {
    const html = `<html><head><title>Acme</title></head><body><h1>Home</h1><p>Welcome.</p></body></html>`;
    expect(isSyntheticDocument(html)).toBe(false);
  });

  test("false for a real page carrying the pricing-toggle billing block (regression)", () => {
    // data-outrival-billing marks a block APPENDED to a real page, NOT a synthesized
    // document — it must stay deny-checkable.
    const html = `<html><head><title>Pricing — Acme</title></head><body>` +
      `<h1>Plans</h1><div class="plan">$29/mo</div>` +
      `<div data-outrival-billing="alternate" hidden><div class="plan">$290/yr</div></div>` +
      `</body></html>`;
    expect(isSyntheticDocument(html)).toBe(false);
  });

  test("why the job-level gate exists: a sitemap listing /404 trips detectDenyPage but is synthetic", () => {
    // A small real sitemap that happens to list a /404 route reads as a soft-404 to
    // the copy heuristic — which is exactly why the job skips detectDenyPage on
    // synthesized documents. Both assertions together are the guard's rationale.
    const html = `<!doctype html><html><body><section data-outrival-sitemap><ul>` +
      `<li>https://acme.com/404</li><li>https://acme.com/</li></ul></section></body></html>`;
    expect(detectDenyPage(html)).toBe("soft_404");
    expect(isSyntheticDocument(html)).toBe(true);
  });
});

describe("detectDenyPage — consent wall (R6, success path)", () => {
  test("a consent interstitial that replaced the page is a deny page", () => {
    const html =
      `<html><head><title>Acme</title></head><body>` +
      `<h1>We value your privacy</h1>` +
      `<p>We and our partners use cookies to personalise content.</p>` +
      `<button>Accept all</button><button>Reject all</button>` +
      `</body></html>`;
    expect(detectDenyPage(html)).toBe("consent_wall");
  });

  test("the same copy as a BANNER over a real page is not a deny page", () => {
    // The length gate is the whole separation: a banner never makes a page short.
    const article = "Our pricing is built around how much you actually ship. ".repeat(80);
    const html =
      `<html><head><title>Pricing — Acme</title></head><body>` +
      `<div class="cookie-banner"><p>This site uses cookies.</p>` +
      `<button>Accept all</button></div>` +
      `<main><h1>Pricing</h1><p>${article}</p></main>` +
      `</body></html>`;
    expect(detectDenyPage(html)).toBe(null);
  });

  test("consent copy with no consent control is not enough", () => {
    const html =
      `<html><body><h1>Privacy</h1><p>We value your privacy.</p>` +
      `<a href="/policy">Read our policy</a></body></html>`;
    expect(detectDenyPage(html)).toBe(null);
  });
});
