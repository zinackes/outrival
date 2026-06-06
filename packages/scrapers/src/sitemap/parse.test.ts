import { test, expect } from "bun:test";
import { gzipSync } from "node:zlib";
import {
  parseSitemap,
  collectSitemapUrls,
  categorizeUrl,
  sitemapBytesToText,
} from "./parse";

test("parseSitemap reads page URLs from a urlset", () => {
  const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url><loc>https://acme.com/</loc></url>
    <url><loc>https://acme.com/pricing</loc></url>
  </urlset>`;
  const { urls, sitemaps } = parseSitemap(xml);
  expect(urls).toEqual(["https://acme.com/", "https://acme.com/pricing"]);
  expect(sitemaps).toEqual([]);
});

test("parseSitemap reads nested sitemaps from a sitemapindex", () => {
  const xml = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <sitemap><loc>https://acme.com/sitemap-pages.xml</loc></sitemap>
    <sitemap><loc>https://acme.com/sitemap-blog.xml.gz</loc></sitemap>
  </sitemapindex>`;
  const { urls, sitemaps } = parseSitemap(xml);
  expect(urls).toEqual([]);
  expect(sitemaps).toEqual([
    "https://acme.com/sitemap-pages.xml",
    "https://acme.com/sitemap-blog.xml.gz",
  ]);
});

test("categorizeUrl classifies by path", () => {
  expect(categorizeUrl("https://acme.com/blog/my-post")).toBe("blog");
  expect(categorizeUrl("https://acme.com/pricing")).toBe("pricing");
  expect(categorizeUrl("https://acme.com/careers/eng")).toBe("jobs");
  expect(categorizeUrl("https://acme.com/changelog")).toBe("changelog");
  expect(categorizeUrl("https://acme.com/docs/api")).toBe("docs");
  expect(categorizeUrl("https://acme.com/privacy")).toBe("legal");
  expect(categorizeUrl("https://acme.com/product/analytics")).toBe("product");
  expect(categorizeUrl("https://acme.com/about")).toBe("other");
});

test("sitemapBytesToText gunzips gzip-framed bytes", () => {
  const xml = "<urlset><url><loc>https://acme.com/x</loc></url></urlset>";
  const gz = gzipSync(Buffer.from(xml));
  expect(sitemapBytesToText(new Uint8Array(gz), "https://acme.com/sitemap.xml.gz")).toBe(xml);
  // plain bytes pass through
  expect(sitemapBytesToText(new Uint8Array(Buffer.from(xml)), "https://acme.com/sitemap.xml")).toBe(
    xml,
  );
});

test("collectSitemapUrls recurses index → children, dedupes + sorts, decompresses .gz", async () => {
  const index = `<sitemapindex>
    <sitemap><loc>https://acme.com/s-a.xml</loc></sitemap>
    <sitemap><loc>https://acme.com/s-b.xml.gz</loc></sitemap>
  </sitemapindex>`;
  const childA = `<urlset>
    <url><loc>https://acme.com/b</loc></url>
    <url><loc>https://acme.com/a</loc></url>
  </urlset>`;
  const childB = `<urlset><url><loc>https://acme.com/a</loc></url><url><loc>https://acme.com/c</loc></url></urlset>`;

  const fixtures: Record<string, Uint8Array> = {
    "https://acme.com/sitemap.xml": new Uint8Array(Buffer.from(index)),
    "https://acme.com/s-a.xml": new Uint8Array(Buffer.from(childA)),
    "https://acme.com/s-b.xml.gz": new Uint8Array(gzipSync(Buffer.from(childB))),
  };

  const urls = await collectSitemapUrls("https://acme.com/sitemap.xml", {
    fetchBytes: async (u) => fixtures[u] ?? null,
  });
  expect(urls).toEqual(["https://acme.com/a", "https://acme.com/b", "https://acme.com/c"]);
});

test("collectSitemapUrls is bounded by maxUrls", async () => {
  const big = `<urlset>${Array.from({ length: 100 }, (_, i) => `<url><loc>https://acme.com/p${i}</loc></url>`).join("")}</urlset>`;
  const urls = await collectSitemapUrls("https://acme.com/sitemap.xml", {
    fetchBytes: async () => new Uint8Array(Buffer.from(big)),
    maxUrls: 10,
  });
  expect(urls.length).toBeLessThanOrEqual(10);
});
