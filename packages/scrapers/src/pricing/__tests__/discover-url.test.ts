import { afterEach, expect, test } from "bun:test";
import {
  deeperPricingLinks,
  discoverPricingUrl,
  findFooterPricingLink,
  findNavPricingLink,
  hasHomepagePricingSection,
} from "../discover-url";

const BASE = "https://collx.app/";

// ── fetch mock ────────────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Call {
  url: string;
  method: string;
}

/** Route by URL; HEAD probes default to 404 unless the handler says otherwise.
 *  A handler may return `url` to simulate a redirect landing (final `res.url`). */
function mockFetch(
  handler: (
    url: string,
    method: string,
  ) => { ok: boolean; body?: string; url?: string; status?: number },
) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init?: { method?: string }) => {
    const url = typeof input === "string" ? input : String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    const r = handler(url, method);
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 404),
      url: r.url ?? url,
      text: async () => r.body ?? "",
      headers: { get: () => null },
    } as Response;
  }) as typeof fetch;
  return calls;
}

const PRICED_PAGE = `<html><body><h2>CollX Pro</h2><p>$9.99 / mo</p><p>$99.99 / year</p></body></html>`;
const NO_PRICE_PAGE = `<html><body><h1>Pro features</h1><p>Level up your collection.</p></body></html>`;

// ── pure link matching (no network) ─────────────────────────────────────────
test("findNavPricingLink catches a tier-branded link (CollX Pro)", () => {
  const html = `<nav><a href="/collx-pro">CollX Pro</a><a href="/collx-gold">CollX Gold</a></nav>`;
  expect(findNavPricingLink(html, new URL(BASE))).toBe("https://collx.app/collx-pro");
});

test("findNavPricingLink prefers a trusted 'Pricing' link over a tier link", () => {
  const html = `<nav><a href="/collx-pro">CollX Pro</a><a href="/pricing">Pricing</a></nav>`;
  expect(findNavPricingLink(html, new URL(BASE))).toBe("https://collx.app/pricing");
});

test("\\bpro\\b does not fire on 'products'", () => {
  const html = `<nav><a href="/products">Our products</a></nav>`;
  expect(findNavPricingLink(html, new URL(BASE))).toBeNull();
});

test("findFooterPricingLink matches a footer plans link", () => {
  const html = `<footer><a href="/plans">Plans</a></footer>`;
  expect(findFooterPricingLink(html, new URL(BASE))).toBe("https://collx.app/plans");
});

test("hasHomepagePricingSection detects an embedded section", () => {
  expect(hasHomepagePricingSection(`<section id="pricing"><h2>Plans</h2></section>`)).toBe(true);
  expect(hasHomepagePricingSection(`<section><h2>Our team</h2></section>`)).toBe(false);
});

// ── discovery cascade with content verification ─────────────────────────────
test("trusted nav link is committed once its target resolves (2xx)", async () => {
  // HEAD probes all 404 (no convention route) → discovery falls to the nav link.
  // The trusted link is now GET-verified for reachability before being committed.
  const calls = mockFetch((url, method) => {
    if (method === "HEAD") return { ok: false };
    return { ok: url.endsWith("/pricing"), body: `<html><body><div id="root"></div></body></html>` };
  });
  const html = `<nav><a href="/pricing">Pricing</a></nav>`;
  const got = await discoverPricingUrl(BASE, html);
  expect(got).toEqual({ url: "https://collx.app/pricing", source: "nav" });
  expect(calls.some((c) => c.method === "GET" && c.url.endsWith("/pricing"))).toBe(true);
});

test("trusted nav link whose target 404s is dropped (apex sub-path bug)", async () => {
  // Regression guard: codebenders.ai 301s only its root to www and hard-404s
  // /pricing. The nav link resolves to a dead URL — it must NOT be committed (or the
  // scraper captures a 404 "Not Found" shell and pricing shows "unknown").
  mockFetch((_url, method) => (method === "HEAD" ? { ok: false } : { ok: false }));
  const html = `<nav><a href="/pricing">Pricing</a></nav>`;
  const got = await discoverPricingUrl(BASE, html);
  expect(got).toBeNull();
});

test("catch-all 2xx HEAD probes fall through to the real nav link (mtgstocks)", async () => {
  // Regression guard: a bot-protected SPA answers a blanket 2xx (mtgstocks 202s)
  // to HEAD on EVERY path, and its guessed convention routes redirect to an error
  // shell (/pricing → /error/404). The canonical pricing page is reachable only via
  // the homepage "Go Premium" nav link — the catch-all HEAD must NOT mask it.
  const MTG = "https://www.mtgstocks.com/";
  mockFetch((url, method) => {
    if (method === "HEAD") {
      // Guessed pricing conventions redirect onto a soft-404 error shell.
      if (/\/(pricing|tarifs|plans|price|prix)/.test(url)) {
        return { ok: true, url: "https://www.mtgstocks.com/error/404" };
      }
      return { ok: true }; // blanket 2xx catch-all for anything else
    }
    if (url.includes("/go-premium")) return { ok: true, body: PRICED_PAGE };
    return { ok: false };
  });
  const html = `<header><a href="/go-premium">Go Premium</a></header>`;
  const got = await discoverPricingUrl(MTG, html);
  expect(got).toEqual({ url: "https://www.mtgstocks.com/go-premium", source: "nav" });
});

test("CollX case: tier link is verified by content and accepted", async () => {
  mockFetch((url, method) => {
    if (method === "HEAD") return { ok: false }; // no /pricing, /plans, … route
    if (url.includes("/collx-pro")) return { ok: true, body: PRICED_PAGE };
    return { ok: false };
  });
  const html = `<nav><a href="/collx-pro">CollX Pro</a><a href="/collx-gold">CollX Gold</a></nav>`;
  const got = await discoverPricingUrl(BASE, html);
  expect(got).toEqual({ url: "https://collx.app/collx-pro", source: "nav" });
});

test("tier link with no prices on the target page is rejected", async () => {
  mockFetch((url, method) => {
    if (method === "HEAD") return { ok: false };
    if (url.includes("/pro-features")) return { ok: true, body: NO_PRICE_PAGE };
    return { ok: false };
  });
  const html = `<nav><a href="/pro-features">Pro features</a></nav>`;
  const got = await discoverPricingUrl(BASE, html);
  expect(got).toBeNull();
});

// ── pricing hub → product page drill (Back4App case) ────────────────────────
const HUB_PAGE = `<html><body><h1>Pricing</h1>
  <a href="/pricing/backend-as-a-service">Backend as a Service</a>
  <a href="/pricing/containers">Containers as a Service</a>
</body></html>`;

test("deeperPricingLinks finds same-origin children under the hub path", () => {
  expect(deeperPricingLinks(HUB_PAGE, "https://collx.app/pricing")).toEqual([
    "https://collx.app/pricing/backend-as-a-service",
    "https://collx.app/pricing/containers",
  ]);
});

test("priceless /pricing hub drills to the first product page that has prices", async () => {
  mockFetch((url, method) => {
    if (method === "HEAD") return { ok: url.endsWith("/pricing") };
    if (url.endsWith("/pricing")) return { ok: true, body: HUB_PAGE };
    if (url.includes("/pricing/backend-as-a-service")) return { ok: true, body: PRICED_PAGE };
    return { ok: false };
  });
  const got = await discoverPricingUrl(BASE, "<nav></nav>");
  expect(got).toEqual({
    url: "https://collx.app/pricing/backend-as-a-service",
    source: "direct",
  });
});

test("a priced /pricing is kept — no drill even if it links to a sub-page", async () => {
  const MAIN = `<html><body><h2>Pro</h2><p>$29 / mo</p>
    <a href="/pricing/enterprise">Enterprise</a></body></html>`;
  const calls = mockFetch((url, method) => {
    if (method === "HEAD") return { ok: url.endsWith("/pricing") };
    if (url.endsWith("/pricing")) return { ok: true, body: MAIN };
    return { ok: false };
  });
  const got = await discoverPricingUrl(BASE, "<nav></nav>");
  expect(got).toEqual({ url: "https://collx.app/pricing", source: "direct" });
  // The page had its own prices, so no child was fetched.
  expect(calls.some((c) => c.url.includes("/enterprise"))).toBe(false);
});

test("a JS-rendered /pricing with no children is kept as-is", async () => {
  mockFetch((url, method) => {
    if (method === "HEAD") return { ok: url.endsWith("/pricing") };
    if (url.endsWith("/pricing")) return { ok: true, body: `<html><body><div id="root"></div></body></html>` };
    return { ok: false };
  });
  const got = await discoverPricingUrl(BASE, "<nav></nav>");
  expect(got).toEqual({ url: "https://collx.app/pricing", source: "direct" });
});

// ── coverage: localized routes, verified ambiguous routes, HEAD-hostile servers ──
test("a localized nav link (Precios) is trusted like Pricing", () => {
  const html = `<nav><a href="/precios">Precios</a></nav>`;
  expect(findNavPricingLink(html, new URL(BASE))).toBe("https://collx.app/precios");
});

test("an ambiguous route (/membership) is committed only once its content shows prices", async () => {
  mockFetch((url, method) => {
    if (method === "HEAD") return { ok: url.endsWith("/membership") };
    if (url.endsWith("/membership")) return { ok: true, body: PRICED_PAGE };
    return { ok: false };
  });
  const got = await discoverPricingUrl(BASE, "<nav></nav>");
  expect(got).toEqual({ url: "https://collx.app/membership", source: "direct" });
});

test("an ambiguous route that is reachable but priceless is rejected (account /upgrade flow)", async () => {
  mockFetch((url, method) => {
    if (method === "HEAD") return { ok: url.endsWith("/upgrade") };
    if (url.endsWith("/upgrade")) return { ok: true, body: NO_PRICE_PAGE };
    return { ok: false };
  });
  const got = await discoverPricingUrl(BASE, "<nav></nav>");
  expect(got).toBeNull();
});

test("a server that rejects HEAD (405) is probed with GET instead", async () => {
  const calls = mockFetch((url, method) => {
    if (method === "HEAD") {
      // Method restriction on the real pricing route; everything else is a real 404.
      return url.endsWith("/pricing") ? { ok: false, status: 405 } : { ok: false };
    }
    return url.endsWith("/pricing") ? { ok: true, body: PRICED_PAGE } : { ok: false };
  });
  const got = await discoverPricingUrl(BASE, "<nav></nav>");
  expect(got).toEqual({ url: "https://collx.app/pricing", source: "direct" });
  expect(calls.some((c) => c.method === "GET" && c.url.endsWith("/pricing"))).toBe(true);
});
