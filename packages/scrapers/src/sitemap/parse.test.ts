import { test, expect } from "bun:test";
import { gzipSync } from "node:zlib";
import {
  parseSitemap,
  collectSitemapUrls,
  categorizeUrl,
  sitemapBytesToText,
  isComparisonUrl,
  slugMentionsBrand,
  classifyComparisonUrl,
  parseSitemapDoc,
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

// (a) A sitemap INDEX with 3 sub-sitemaps is followed in full.
test("(a) a sitemap index with 3 sub-sitemaps is fully followed", async () => {
  const index = `<sitemapindex>
    <sitemap><loc>https://acme.com/sitemap-blog.xml</loc></sitemap>
    <sitemap><loc>https://acme.com/sitemap-docs.xml</loc></sitemap>
    <sitemap><loc>https://acme.com/sitemap_products_1.xml</loc></sitemap>
  </sitemapindex>`;
  const fixtures: Record<string, string> = {
    "https://acme.com/sitemap.xml": index,
    "https://acme.com/sitemap-blog.xml": `<urlset><url><loc>https://acme.com/blog/a</loc></url></urlset>`,
    "https://acme.com/sitemap-docs.xml": `<urlset><url><loc>https://acme.com/docs/x</loc></url></urlset>`,
    "https://acme.com/sitemap_products_1.xml": `<urlset><url><loc>https://acme.com/products/p</loc></url></urlset>`,
  };
  const fetched: string[] = [];
  const urls = await collectSitemapUrls("https://acme.com/sitemap.xml", {
    fetchBytes: async (u) => {
      fetched.push(u);
      return fixtures[u] ? new Uint8Array(Buffer.from(fixtures[u])) : null;
    },
  });
  expect(fetched).toEqual([
    "https://acme.com/sitemap.xml",
    "https://acme.com/sitemap-blog.xml",
    "https://acme.com/sitemap-docs.xml",
    "https://acme.com/sitemap_products_1.xml",
  ]);
  expect(urls).toEqual(["https://acme.com/blog/a", "https://acme.com/docs/x", "https://acme.com/products/p"]);
});

test("isComparisonUrl + comparison category", () => {
  for (const u of [
    "https://rival.com/vs/notion",
    "https://rival.com/compare/rival-vs-notion",
    "https://rival.com/notion-vs-airtable",
    "https://rival.com/alternatives/salesforce",
    "https://rival.com/best-notion-alternatives",
    "https://rival.com/salesforce-alternative",
  ]) {
    expect(isComparisonUrl(u)).toBe(true);
    expect(categorizeUrl(u)).toBe("comparison");
  }
  expect(isComparisonUrl("https://rival.com/pricing")).toBe(false);
  // a comparison slug wins over a category keyword it happens to contain
  expect(categorizeUrl("https://rival.com/vs/pricing-tools")).toBe("comparison");
});

test("new categories: customers / glossary / landing", () => {
  expect(categorizeUrl("https://acme.com/customers/acme-corp")).toBe("customers");
  expect(categorizeUrl("https://acme.com/case-studies/x")).toBe("customers");
  expect(categorizeUrl("https://acme.com/glossary/crm")).toBe("glossary");
  expect(categorizeUrl("https://acme.com/get-started")).toBe("landing");
});

test("slugMentionsBrand normalizes both sides, ignores too-short brands", () => {
  expect(slugMentionsBrand("https://rival.com/vs/outrival", "Outrival")).toBe(true);
  expect(slugMentionsBrand("https://rival.com/out-rival-alternative", "Outrival")).toBe(true);
  expect(slugMentionsBrand("https://rival.com/vs/notion", "Outrival")).toBe(false);
  expect(slugMentionsBrand("https://rival.com/vs/hi", "hi")).toBe(false); // <3 chars → skip
});

// (b) a new /vs/{another actor} page → content / high (no org attack).
test("(b) comparison page vs another actor → content/high", () => {
  const d = classifyComparisonUrl("https://rival.com/vs/notion", ["Outrival", "outrival"]);
  expect(d).toEqual({ category: "content", severity: "high", targetsOrg: false });
});

// (c) a new /vs/{user's org} page → content / critical.
test("(c) comparison page targeting the user's org → content/critical", () => {
  const d = classifyComparisonUrl("https://rival.com/vs/outrival", ["Outrival", "outrival"]);
  expect(d).toEqual({ category: "content", severity: "critical", targetsOrg: true });
  // a non-comparison URL never produces a signal
  expect(classifyComparisonUrl("https://rival.com/pricing", ["Outrival"])).toBeNull();
});

// (d) a sitemap with NO lastmod (or a misleading one) is diffed on loc only.
test("(d) lastmod is never consulted — the URL set is what the diff compares", () => {
  const noLastmod = `<urlset><url><loc>https://acme.com/a</loc></url><url><loc>https://acme.com/b</loc></url></urlset>`;
  const withStaleLastmod = `<urlset>
    <url><loc>https://acme.com/a</loc><lastmod>2020-01-01</lastmod></url>
    <url><loc>https://acme.com/b</loc><lastmod>2020-01-01</lastmod></url>
  </urlset>`;
  // Same locs, wildly different lastmod → identical parsed URL set (lastmod ignored).
  expect(parseSitemap(noLastmod).urls).toEqual(parseSitemap(withStaleLastmod).urls);
  // And the JSON-island round-trip the branch diffs on carries only the loc set.
  const html = `<script type="application/json" id="outrival-sitemap">${JSON.stringify({ rootUrl: "r", urls: ["https://acme.com/a", "https://acme.com/b"] })}</script>`;
  expect(parseSitemapDoc(html)).toEqual(["https://acme.com/a", "https://acme.com/b"]);
});
