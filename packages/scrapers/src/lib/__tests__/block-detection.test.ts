import { describe, expect, test } from "bun:test";
import { isCloudflareChallenge } from "../block-detection";

describe("isCloudflareChallenge", () => {
  test("flags legacy IUAM 'Just a moment' page", () => {
    expect(
      isCloudflareChallenge(
        `<html><head><title>Just a moment...</title></head><body><div class="cf-browser-verification"></div></body></html>`,
      ),
    ).toBe(true);
  });

  test("flags modern managed-challenge interstitial (the targetrecruit case)", () => {
    // Bare-domain title + "Checking the site connection security" body — the old
    // title-only check missed this and stored the shell as real content.
    const html = `<!doctype html><html><head><title>www.targetrecruit.net</title></head>
      <body>
        <h1>www.targetrecruit.net</h1>
        <p>Verifying you are human. This may take a few seconds.</p>
        <p>Checking the site connection security</p>
        <p>Enable JavaScript and cookies to continue</p>
        <script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>
      </body></html>`;
    expect(isCloudflareChallenge(html)).toBe(true);
  });

  test("flags on the cdn-cgi/challenge-platform script alone", () => {
    expect(
      isCloudflareChallenge(`<html><body><script src="/cdn-cgi/challenge-platform/x"></script></body></html>`),
    ).toBe(true);
  });

  test("does NOT flag a real page that embeds a standalone Turnstile widget", () => {
    // The Turnstile widget (challenges.cloudflare.com) lives on legit forms — it is
    // not an interstitial, so a real homepage with a contact form must pass.
    const html = `<html><head><title>Acme CRM — Sales software</title></head>
      <body>
        <h1>The CRM for growing teams</h1>
        <p>Manage your pipeline, close more deals.</p>
        <form><div class="cf-turnstile" data-sitekey="abc"></div></form>
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>
      </body></html>`;
    expect(isCloudflareChallenge(html)).toBe(false);
  });

  test("does NOT flag an ordinary content page", () => {
    expect(
      isCloudflareChallenge(`<html><head><title>Pricing</title></head><body><h1>Plans</h1><p>$10/mo</p></body></html>`),
    ).toBe(false);
  });
});
