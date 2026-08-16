/**
 * Audit harness, step 2 of 3: turn the route table into a list of real URLs.
 *
 * Seven routes are dynamic. Rather than guess API shapes, this harvests the
 * links the app itself renders (plus the public sitemap) and expands the
 * patterns with the ids it finds. If a pattern resolves to nothing, that is
 * reported as a gap instead of silently crawling a 404 and calling it a bug.
 *
 * Run from the repo root, after login.mjs:
 *   node docs/audits/2026-08-16/harness/inventory.mjs
 *
 * Writes ~/.outrival-audit/2026-08-16/routes.json
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { cwd, env, exit } from "node:process";
import { settle } from "./settle.mjs";

const require = createRequire(join(cwd(), "packages/scrapers/package.json"));
const { chromium } = require("playwright");

const WEB_URL = env.WEB_URL ?? "https://outrival.app";
const STATE_PATH = join(homedir(), ".outrival-audit", "state.json");
const OUT_DIR = join(homedir(), ".outrival-audit", "2026-08-16");

/** Max concrete URLs kept per dynamic pattern. Three is enough to catch a
 *  state-dependent layout break without multiplying the crawl by the dataset. */
const PER_PATTERN = 3;

const PUBLIC = [
  "/", "/pricing", "/about", "/demo", "/sample", "/docs", "/status", "/changelog",
  "/blog", "/bot", "/security", "/accessibility", "/legal", "/legal-notice",
  "/privacy", "/terms", "/terms-of-sale", "/cookies", "/dpa", "/subprocessors",
  "/acceptable-use",
  "/vs/crayon", "/vs/klue", "/vs/diy",
  "/alternatives/crayon", "/alternatives/klue",
  "/alternatives/best-competitive-intelligence-tools",
];

const APP = [
  "/auth", "/onboarding",
  "/dashboard", "/dashboard/activity", "/dashboard/signals", "/dashboard/trends",
  "/dashboard/competitors", "/dashboard/products", "/dashboard/digests",
  "/dashboard/digests/in-progress", "/dashboard/discovery", "/dashboard/compare",
  "/dashboard/battle-cards", "/dashboard/ai-visibility", "/dashboard/ask",
  "/dashboard/sector", "/dashboard/recap", "/dashboard/whats-new",
  "/dashboard/settings", "/dashboard/settings/general",
  "/dashboard/settings/profile", "/dashboard/settings/security",
  "/dashboard/settings/notifications", "/dashboard/settings/products",
  "/dashboard/settings/members", "/dashboard/settings/integrations",
  "/dashboard/settings/api-keys", "/dashboard/settings/usage",
  "/dashboard/settings/data", "/dashboard/settings/billing",
  "/dashboard/settings/danger",
  "/dev/preview", "/dev/preview-emails", "/dev/cron",
];

/** Crawled but never acted on: the crawler only navigates, it never clicks. */
const SENSITIVE = ["/dashboard/settings/danger", "/dashboard/settings/billing"];

/** Out of reach on a non-admin account. Recorded so the report can say so. */
const SKIPPED_ADMIN = 23;

const PATTERNS = [
  { name: "competitor", re: /^\/dashboard\/competitors\/[^/]+$/, extra: ["/sources", "/battle-card"] },
  { name: "product", re: /^\/dashboard\/products\/[^/]+$/, extra: ["/sources"] },
  { name: "digest", re: /^\/dashboard\/digests\/[^/]+$/, extra: [] },
  { name: "brief", re: /^\/brief\/[^/]+$/, extra: [] },
  { name: "report", re: /^\/report\/[^/]+$/, extra: [] },
  { name: "blogPost", re: /^\/blog\/[^/]+$/, extra: [] },
];

const SEEDS = [
  "/dashboard", "/dashboard/competitors", "/dashboard/products",
  "/dashboard/digests", "/dashboard/signals", "/dashboard/battle-cards", "/blog",
];

const browser = await chromium.launch();
const context = await browser.newContext({ storageState: STATE_PATH });
const page = await context.newPage();

const harvested = new Set();

for (const seed of SEEDS) {
  try {
    await page.goto(`${WEB_URL}${seed}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
    for (const href of hrefs) {
      if (!href) continue;
      const path = href.startsWith("http")
        ? (href.startsWith(WEB_URL) ? href.slice(WEB_URL.length) : null)
        : (href.startsWith("/") ? href : null);
      if (path) harvested.add(path.split("#")[0].split("?")[0]);
    }
    console.log(`seed ${seed}: ${hrefs.length} links`);
  } catch (err) {
    console.warn(`seed ${seed} failed: ${err.message}`);
  }
}

// Public slugs come from the sitemap, which is the source of truth for SEO.
try {
  const res = await page.request.get(`${WEB_URL}/sitemap.xml`);
  const xml = await res.text();
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const u = new URL(m[1]);
    harvested.add(u.pathname);
  }
  console.log(`sitemap: ${harvested.size} paths after merge`);
} catch (err) {
  console.warn(`sitemap failed: ${err.message}`);
}

const dynamic = [];
const gaps = [];
for (const p of PATTERNS) {
  const hits = [...harvested].filter((h) => p.re.test(h)).slice(0, PER_PATTERN);
  if (hits.length === 0) {
    gaps.push(p.name);
    continue;
  }
  for (const hit of hits) {
    dynamic.push({ path: hit, group: "dynamic", pattern: p.name });
    for (const suffix of p.extra) {
      dynamic.push({ path: `${hit}${suffix}`, group: "dynamic", pattern: `${p.name}${suffix}` });
    }
  }
}

const routes = [
  ...PUBLIC.map((path) => ({ path, group: "public", auth: false })),
  ...APP.map((path) => ({
    path, group: "app", auth: true, sensitive: SENSITIVE.includes(path),
  })),
  ...dynamic.map((d) => ({ ...d, auth: !d.path.startsWith("/blog") })),
];

await mkdir(OUT_DIR, { recursive: true });
await writeFile(
  join(OUT_DIR, "routes.json"),
  JSON.stringify({ webUrl: WEB_URL, generatedFor: "2026-08-16", routes, gaps, skippedAdmin: SKIPPED_ADMIN }, null, 2),
);

console.log(`\n${routes.length} routes written to ${join(OUT_DIR, "routes.json")}`);
if (gaps.length) console.log(`Unresolved dynamic patterns: ${gaps.join(", ")}`);
console.log(`Admin routes skipped (non-admin account): ${SKIPPED_ADMIN}`);

await browser.close();
if (gaps.length) exit(2);
