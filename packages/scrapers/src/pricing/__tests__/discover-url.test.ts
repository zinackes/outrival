import { afterEach, expect, test } from "bun:test";
import {
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

/** Route by URL; HEAD probes default to 404 unless the handler says otherwise. */
function mockFetch(handler: (url: string, method: string) => { ok: boolean; body?: string }) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init?: { method?: string }) => {
    const url = typeof input === "string" ? input : String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    const r = handler(url, method);
    return {
      ok: r.ok,
      status: r.ok ? 200 : 404,
      text: async () => r.body ?? "",
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
test("trusted nav link is returned without a content fetch", async () => {
  const calls = mockFetch((_url, method) => (method === "HEAD" ? { ok: false } : { ok: false }));
  const html = `<nav><a href="/pricing">Pricing</a></nav>`;
  const got = await discoverPricingUrl(BASE, html);
  expect(got).toEqual({ url: "https://collx.app/pricing", source: "nav" });
  // No GET was needed — the match was trusted.
  expect(calls.some((c) => c.method === "GET")).toBe(false);
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
