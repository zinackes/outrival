import { describe, expect, test } from "bun:test";
import { silentEmailHtml } from "../src/core/detect-silent-monitors";

// code:SEC-05 — the silent-monitor email quotes competitor names, and a competitor
// name is scraped from the competitor's own pages. It reached <h1> and <p> raw, so
// markup in a name rendered as markup in the inbox. emailShell's `inner` is raw HTML
// by contract (every template builds its own), so the escape belongs at the call site.

const PAYLOAD = '<img src=x onerror="alert(1)">';

describe("silentEmailHtml", () => {
  test("escapes the title", () => {
    const html = silentEmailHtml(PAYLOAD, "body", "https://outrival.app/dashboard");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  test("escapes the body", () => {
    const html = silentEmailHtml(
      "2 monitored sources have gone quiet",
      `Acme ${PAYLOAD} (pricing) hasn't produced anything in a while.`,
      "https://outrival.app/dashboard",
    );
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("onerror=\"alert(1)\">");
  });

  test("leaves the preheader to emailShell, which escapes it itself", () => {
    // Double-escaping here would surface "&amp;lt;" in the inbox preview line.
    const html = silentEmailHtml("t", "Acme & Co <b>", "https://outrival.app/dashboard");
    expect(html).not.toContain("&amp;lt;");
    expect(html).toContain("&amp; Co &lt;b&gt;");
  });

  test("still renders the CTA and the real copy", () => {
    const html = silentEmailHtml(
      "1 monitored source has gone quiet",
      "Acme (pricing) hasn't produced anything in a while.",
      "https://outrival.app/dashboard/competitors/c1",
    );
    expect(html).toContain("1 monitored source has gone quiet");
    expect(html).toContain("https://outrival.app/dashboard/competitors/c1");
    expect(html).toContain("Review the source");
  });
});
