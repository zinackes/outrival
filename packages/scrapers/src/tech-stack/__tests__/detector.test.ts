import { test, expect, describe } from "bun:test";
import { detectTechStack, type TechStackInput } from "../detector";
import { extractScriptUrls } from "../scraper";

const input = (over: Partial<TechStackInput>): TechStackInput => ({
  url: "https://acme.com",
  html: "<html><body></body></html>",
  responseHeaders: {},
  scriptUrls: [],
  ...over,
});

const find = (out: ReturnType<typeof detectTechStack>, id: string) =>
  out.find((d) => d.techId === id);

describe("detectTechStack", () => {
  test("detects Stripe via script URL and footer keyword", () => {
    const out = detectTechStack(
      input({
        html: '<html><body><footer>Powered by Stripe · © Acme</footer></body></html>',
        scriptUrls: ["https://js.stripe.com/v3/"],
      }),
    );
    const stripe = find(out, "stripe");
    expect(stripe).toBeDefined();
    expect(stripe!.importance).toBe("high");
    expect(stripe!.evidence.some((e) => e.startsWith("script:"))).toBe(true);
    expect(stripe!.evidence.some((e) => e.startsWith("footer:"))).toBe(true);
  });

  test("detects Vercel via response headers", () => {
    const out = detectTechStack(
      input({
        responseHeaders: { server: "Vercel", "x-vercel-id": "cdg1::abc" },
      }),
    );
    const vercel = find(out, "vercel");
    expect(vercel).toBeDefined();
    expect(vercel!.category).toBe("hosting");
    expect(vercel!.evidence.some((e) => e.startsWith("header:"))).toBe(true);
  });

  test("detects Cloudflare via cf-ray presence header", () => {
    const out = detectTechStack(
      input({ responseHeaders: { "cf-ray": "8a1b2c3d4e5f-CDG" } }),
    );
    expect(find(out, "cloudflare")).toBeDefined();
  });

  test("detects Salesforce via footer integration mention", () => {
    const out = detectTechStack(
      input({
        html: "<footer>Integrates with Salesforce, HubSpot and more.</footer>",
      }),
    );
    const sf = find(out, "salesforce");
    expect(sf).toBeDefined();
    expect(sf!.category).toBe("crm_integration");
    expect(sf!.importance).toBe("high");
  });

  test("detects Next.js via DOM marker", () => {
    const out = detectTechStack(
      input({ html: '<script id="__NEXT_DATA__">{}</script>' }),
    );
    expect(find(out, "next.js")).toBeDefined();
  });

  test("detects PostHog via script path", () => {
    const out = detectTechStack(
      input({ scriptUrls: ["https://eu.i.posthog.com/static/array.js"] }),
    );
    expect(find(out, "posthog")).toBeDefined();
  });

  test("returns nothing for a bare page with no signatures", () => {
    const out = detectTechStack(input({ html: "<html><body>hello</body></html>" }));
    expect(out).toHaveLength(0);
  });

  test("reports a tech once even with multiple matching scripts", () => {
    const out = detectTechStack(
      input({
        scriptUrls: [
          "https://js.stripe.com/v3/",
          "https://checkout.stripe.com/x.js",
        ],
      }),
    );
    expect(out.filter((d) => d.techId === "stripe")).toHaveLength(1);
  });
});

describe("extractScriptUrls", () => {
  test("resolves relative and protocol-relative srcs against the page URL", () => {
    const urls = extractScriptUrls(
      '<script src="/_next/static/x.js"></script>' +
        '<script src="//cdn.segment.com/analytics.js/v1/KEY/analytics.min.js"></script>' +
        '<script src="https://js.stripe.com/v3/"></script>',
      "https://acme.com/pricing",
    );
    expect(urls).toContain("https://acme.com/_next/static/x.js");
    expect(urls.some((u) => u.includes("cdn.segment.com"))).toBe(true);
    expect(urls).toContain("https://js.stripe.com/v3/");
  });
});
