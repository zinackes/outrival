import type { TechCatalog } from "./types";

/**
 * House-authored fingerprint dataset (patch-31), in the Wappalyzer format. Kept
 * deliberately small and high-signal — it covers the frameworks / CMS / hosting /
 * CDN / analytics we actually route or report on. Grows by observation, exactly
 * like the patch-18 tech-stack catalog. NOT derived from the GPL Wappalyzer data.
 *
 * Patterns are case-insensitive regexes (see engine.ts). Escape dots in hosts.
 */
export const HOUSE_TECHNOLOGIES: TechCatalog = {
  // ── Web frameworks (cat 18) ──────────────────────────────────────────────
  "Next.js": {
    cats: [18],
    headers: { "x-powered-by": "Next\\.js" },
    html: ['id="__NEXT_DATA__"', "/_next/static/"],
    website: "https://nextjs.org",
  },
  "Nuxt.js": {
    cats: [18],
    html: ['id="__NUXT__"', "/_nuxt/"],
    js: { __NUXT__: "" },
    website: "https://nuxt.com",
  },
  Remix: {
    cats: [18],
    html: ["window\\.__remixContext", "/build/_shared/"],
    website: "https://remix.run",
  },
  SvelteKit: {
    cats: [18],
    html: ["/_app/immutable/", "__sveltekit"],
    website: "https://kit.svelte.dev",
  },
  Gatsby: {
    cats: [18],
    html: ['id="___gatsby"', "/page-data/app-data\\.json"],
    website: "https://gatsbyjs.com",
  },
  Astro: {
    cats: [18],
    html: ["<astro-island", "data-astro-cid"],
    meta: { generator: "Astro" },
    website: "https://astro.build",
  },

  // ── CMS / site builders (cat 1) ──────────────────────────────────────────
  WordPress: {
    cats: [1],
    html: ["/wp-content/", "/wp-includes/"],
    meta: { generator: "WordPress(?:\\s([\\d.]+))?\\;version:\\1" },
    website: "https://wordpress.org",
  },
  Webflow: {
    cats: [1],
    html: ["data-wf-page", "data-wf-site"],
    meta: { generator: "Webflow" },
    scriptSrc: ["assets(?:-global)?\\.website-files\\.com"],
    website: "https://webflow.com",
  },
  Framer: {
    cats: [1],
    html: ["data-framer-name", "framerusercontent\\.com"],
    meta: { generator: "Framer" },
    website: "https://framer.com",
  },
  Ghost: {
    cats: [1],
    headers: { "x-ghost-cache-status": "" },
    meta: { generator: "Ghost(?:\\s([\\d.]+))?\\;version:\\1" },
    website: "https://ghost.org",
  },
  Shopify: {
    cats: [1],
    headers: { "x-shopid": "", "x-shopify-stage": "" },
    html: ["cdn\\.shopify\\.com", "Shopify\\.theme"],
    website: "https://shopify.com",
  },
  Wix: {
    cats: [1],
    headers: { "x-wix-request-id": "" },
    html: ["static\\.wixstatic\\.com"],
    website: "https://wix.com",
  },
  Squarespace: {
    cats: [1],
    html: ["static1\\.squarespace\\.com", "squarespace\\.com"],
    meta: { generator: "Squarespace" },
    website: "https://squarespace.com",
  },

  // ── Hosting / PaaS (cat 62) ──────────────────────────────────────────────
  Vercel: {
    cats: [62],
    headers: { server: "[Vv]ercel", "x-vercel-id": "", "x-vercel-cache": "" },
    website: "https://vercel.com",
  },
  Netlify: {
    cats: [62],
    headers: { server: "[Nn]etlify", "x-nf-request-id": "" },
    website: "https://netlify.com",
  },

  // ── CDN (cat 31) ─────────────────────────────────────────────────────────
  Cloudflare: {
    cats: [31],
    headers: { server: "cloudflare", "cf-ray": "" },
    website: "https://cloudflare.com",
  },
  Fastly: {
    cats: [31],
    headers: { "x-served-by": "cache-", "x-fastly-request-id": "", "fastly-io-info": "" },
    website: "https://fastly.com",
  },
  "AWS CloudFront": {
    cats: [31],
    headers: { "x-amz-cf-id": "", via: "[Cc]loud[Ff]ront" },
    website: "https://aws.amazon.com/cloudfront",
  },

  // ── Analytics (cat 10) ───────────────────────────────────────────────────
  "Google Analytics": {
    cats: [10],
    scriptSrc: ["googletagmanager\\.com/gtag", "google-analytics\\.com/(?:analytics|ga)\\.js"],
    cookies: { _ga: "" },
    website: "https://analytics.google.com",
  },
  PostHog: {
    cats: [10],
    scriptSrc: ["\\bi?\\.?posthog\\.com", "/array\\.js"],
    js: { posthog: "" },
    website: "https://posthog.com",
  },
  Segment: {
    cats: [10],
    scriptSrc: ["cdn\\.segment\\.(?:com|io)"],
    js: { analytics: "" },
    website: "https://segment.com",
  },
  Mixpanel: {
    cats: [10],
    scriptSrc: ["cdn\\.mxpnl\\.com", "mixpanel\\.com"],
    js: { mixpanel: "" },
    website: "https://mixpanel.com",
  },
  Amplitude: {
    cats: [10],
    scriptSrc: ["cdn\\.amplitude\\.com", "api\\.amplitude\\.com"],
    js: { amplitude: "" },
    website: "https://amplitude.com",
  },
  Plausible: {
    cats: [10],
    scriptSrc: ["plausible\\.io/js"],
    website: "https://plausible.io",
  },
};
