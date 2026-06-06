import { test, expect } from "bun:test";
import { detectPlatform, type PlatformEvidence } from "../detect";

const ev = (over: Partial<PlatformEvidence>): PlatformEvidence => ({
  url: "https://example.com",
  html: "",
  headers: {},
  scriptSrc: [],
  ...over,
});

test("extracts the Greenhouse board token from the careers HTML", () => {
  const p = detectPlatform(
    ev({ html: `<a href="https://boards.greenhouse.io/airbnb">Open roles</a>` }),
  );
  expect(p.ats?.value).toBe("greenhouse:airbnb");
  expect(p.ats?.confidence).toBe("high");
});

test("detects the Stripe pricing-table widget (not the payment SDK)", () => {
  const p = detectPlatform(
    ev({ html: `<stripe-pricing-table pricing-table-id="prctbl_1" publishable-key="pk_live_x"></stripe-pricing-table>` }),
  );
  expect(p.pricingWidget?.value).toBe("stripe");
});

test("captures the Statuspage host", () => {
  const p = detectPlatform(
    ev({ html: `<a href="https://airbnb.statuspage.io">Status</a>` }),
  );
  expect(p.statusPage?.value).toBe("statuspage:airbnb.statuspage.io");
});

test("detects a Canny changelog widget", () => {
  const p = detectPlatform(ev({ scriptSrc: ["https://canny.io/sdk.js"] }));
  expect(p.changelog?.value).toBe("canny");
});

test("routes an RSS feed only when the path hints a changelog", () => {
  const blog = detectPlatform(
    ev({ html: `<link rel="alternate" type="application/rss+xml" href="/blog/feed.xml">` }),
  );
  expect(blog.changelog).toBeUndefined();

  const changelog = detectPlatform(
    ev({ html: `<link rel="alternate" type="application/rss+xml" href="https://x.com/changelog.rss">` }),
  );
  expect(changelog.changelog?.value).toBe("rss:https://x.com/changelog.rss");
});

test("detects Webflow as the CMS via marker + generator", () => {
  const p = detectPlatform(
    ev({ html: `<html data-wf-page="abc"><meta name="generator" content="Webflow"></html>` }),
  );
  expect(p.cms?.value).toBe("webflow");
});

test("detects WordPress via wp-content path", () => {
  const p = detectPlatform(ev({ html: `<link href="/wp-content/themes/x/style.css">` }));
  expect(p.cms?.value).toBe("wordpress");
});

test("detects Next.js framework + Vercel hosting from headers + html", () => {
  const p = detectPlatform(
    ev({
      headers: { "x-powered-by": "Next.js", "x-vercel-id": "cdg1::abc" },
      html: `<script id="__NEXT_DATA__" type="application/json">{}</script><link href="/_next/static/x.css">`,
    }),
  );
  expect(p.framework?.value).toBe("next");
  expect(p.hosting?.value).toBe("vercel");
});

test("CDN-masked page still detects via cross-signals (cookies + html)", () => {
  // Cloudflare/Fastly stripped Server + X-Powered-By; we fall back to cookies + html.
  const p = detectPlatform(
    ev({
      headers: { "set-cookie": "_ga=GA1.2.123; Path=/, _gid=GA1.2.456; Path=/" },
      html: `<link href="/_next/static/app.css">`,
    }),
  );
  expect(p.framework?.value).toBe("next");
  expect(p.analytics?.some((a) => a.value === "google-analytics")).toBe(true);
});

test("empty evidence yields an empty profile (just metadata)", () => {
  const p = detectPlatform(ev({}));
  expect(p.framework).toBeUndefined();
  expect(p.cms).toBeUndefined();
  expect(p.ats).toBeUndefined();
  expect(typeof p.detectedAt).toBe("string");
  expect(p.v).toBe(1);
});
