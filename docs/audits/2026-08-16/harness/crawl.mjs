/**
 * Audit harness, step 3 of 3: crawl every route in 4 viewports x 2 themes and
 * record what a browser sees.
 *
 * Read-only by design. It navigates, it never clicks, so it is safe to rerun on
 * production as often as needed, including after the fixes land.
 *
 * The point of this script is that agents never drive the browser. One command
 * produces the evidence; agents read only the failures and the screenshots that
 * matter. That is roughly one API request instead of three hundred.
 *
 * Run from the repo root, after inventory.mjs:
 *   node docs/audits/2026-08-16/harness/crawl.mjs
 *   node docs/audits/2026-08-16/harness/crawl.mjs --limit 3        # smoke first
 *   node docs/audits/2026-08-16/harness/crawl.mjs --only /dashboard
 *
 * Writes ~/.outrival-audit/2026-08-16/{results.json,failures.json,shots/}
 */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { argv, cwd, env } from "node:process";
import { settle } from "./settle.mjs";

const require = createRequire(join(cwd(), "packages/scrapers/package.json"));
const { chromium } = require("playwright");

// axe-core is injected as a plain script rather than through the @axe-core/
// playwright wrapper: the wrapper wants its own playwright instance, and this
// script already resolves one from another workspace package.
// Prerequisite: pnpm add -D axe-core --filter @outrival/web
let AXE_PATH = null;
try {
  AXE_PATH = createRequire(join(cwd(), "apps/web/package.json")).resolve("axe-core/axe.min.js");
} catch {
  console.warn("axe-core not installed, accessibility checks are skipped.");
}
/** Contrast issues differ per theme, tap-target issues per viewport, so axe runs
 *  on laptop and mobile in both themes. Running all eight doubles the wall clock
 *  for findings that repeat. */
const AXE_VIEWPORTS = new Set(["laptop", "mobile"]);

const OUT_DIR = join(homedir(), ".outrival-audit", "2026-08-16");
const SHOTS = join(OUT_DIR, "shots");
const STATE_PATH = join(homedir(), ".outrival-audit", "state.json");

const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const LIMIT = Number(arg("limit", "0"));
const ONLY = arg("only", "");
const WORKERS = Number(arg("workers", "4"));
const DELAY = Number(arg("delay", "250"));

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "desktop", width: 1920, height: 1080 },
];
const THEMES = ["light", "dark"];

const HYDRATION = /hydrat|did not match|Minified React error #(41[0-9]|42[0-9])/i;

const { webUrl, routes } = JSON.parse(
  await readFile(join(OUT_DIR, "routes.json"), "utf8"),
);

let targets = routes;
if (ONLY) targets = targets.filter((r) => r.path.startsWith(ONLY));
if (LIMIT) targets = targets.slice(0, LIMIT);

const jobs = [];
for (const route of targets) {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) jobs.push({ route, vp, theme });
  }
}

console.log(`${targets.length} routes x ${VIEWPORTS.length} viewports x ${THEMES.length} themes = ${jobs.length} loads`);

await mkdir(SHOTS, { recursive: true });

const slug = (p) => (p === "/" ? "home" : p.replace(/^\//, "").replace(/\//g, "_"));
const browser = await chromium.launch();
const results = [];
let done = 0;

async function runJob(ctx, { route, vp, theme }) {
  const page = await ctx.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const httpErrors = [];
  const failedRequests = [];

  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") {
      consoleErrors.push({ type: m.type(), text: m.text().slice(0, 400) });
    }
  });
  page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 400)));
  page.on("response", (r) => {
    if (r.status() >= 400) httpErrors.push({ status: r.status(), url: r.url().slice(0, 300) });
  });
  page.on("requestfailed", (r) => {
    failedRequests.push({ url: r.url().slice(0, 300), reason: r.failure()?.errorText ?? "unknown" });
  });

  const started = Date.now();
  const record = {
    path: route.path, group: route.group, viewport: vp.name, theme,
    sensitive: Boolean(route.sensitive),
  };

  try {
    const res = await page.goto(`${webUrl}${route.path}`, {
      waitUntil: "domcontentloaded", timeout: 45_000,
    });
    record.status = res?.status() ?? null;
    await settle(page);

    const probe = await page.evaluate(() => ({
      title: document.title,
      h1: document.querySelector("h1")?.textContent?.trim().slice(0, 200) ?? null,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      textLength: (document.body?.innerText ?? "").length,
      hasNextError: Boolean(document.querySelector("nextjs-portal")),
      bodyStart: (document.body?.innerText ?? "").trim().slice(0, 160),
    }));

    record.title = probe.title;
    record.h1 = probe.h1;
    record.overflowPx = Math.max(0, probe.scrollWidth - probe.innerWidth);
    record.textLength = probe.textLength;
    record.nextErrorOverlay = probe.hasNextError;
    record.bodyStart = probe.bodyStart;

    const shot = `${slug(route.path)}__${vp.name}__${theme}.jpg`;
    await page.screenshot({
      path: join(SHOTS, shot), fullPage: true, type: "jpeg", quality: 70,
    });
    record.screenshot = shot;

    if (AXE_PATH && AXE_VIEWPORTS.has(vp.name)) {
      try {
        await page.addScriptTag({ path: AXE_PATH });
        record.axe = await page.evaluate(async () => {
          const r = await window.axe.run(document, {
            resultTypes: ["violations"],
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
          });
          return r.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            nodes: v.nodes.length,
            sample: v.nodes[0]?.target?.join(" ")?.slice(0, 160) ?? null,
          }));
        });
      } catch (e) {
        record.axeError = String(e.message).slice(0, 200);
      }
    }
  } catch (err) {
    record.crashed = String(err.message).slice(0, 300);
  }

  record.ms = Date.now() - started;
  record.consoleErrors = consoleErrors;
  record.pageErrors = pageErrors;
  record.httpErrors = httpErrors;
  record.failedRequests = failedRequests;
  record.hydration = [...consoleErrors.map((c) => c.text), ...pageErrors].filter((t) => HYDRATION.test(t));

  await page.close();
  results.push(record);
  done += 1;
  if (done % 25 === 0) console.log(`  ${done}/${jobs.length}`);
  return record;
}

async function worker(queue) {
  // One context per worker, reused across jobs: cheap, and it keeps the session
  // warm the way a real user's browser would.
  let ctx = null;
  let currentKey = null;
  for (;;) {
    const job = queue.shift();
    if (!job) break;
    const key = `${job.vp.name}:${job.theme}`;
    if (key !== currentKey) {
      if (ctx) await ctx.close();
      ctx = await browser.newContext({
        storageState: STATE_PATH,
        viewport: { width: job.vp.width, height: job.vp.height },
        colorScheme: job.theme,
        ignoreHTTPSErrors: false,
      });
      // next-themes persists the choice in localStorage under "theme".
      await ctx.addInitScript((t) => {
        try { window.localStorage.setItem("theme", t); } catch {}
      }, job.theme);
      currentKey = key;
    }
    await runJob(ctx, job);
    if (DELAY) await new Promise((r) => setTimeout(r, DELAY));
  }
  if (ctx) await ctx.close();
}

// Group by viewport+theme so each worker rebuilds its context rarely.
jobs.sort((a, b) => `${a.vp.name}${a.theme}`.localeCompare(`${b.vp.name}${b.theme}`));
const queue = [...jobs];
await Promise.all(Array.from({ length: WORKERS }, () => worker(queue)));
await browser.close();

const isFailure = (r) =>
  r.crashed ||
  r.nextErrorOverlay ||
  (r.status ?? 200) >= 400 ||
  r.pageErrors.length > 0 ||
  r.hydration.length > 0 ||
  r.overflowPx > 1 ||
  r.textLength < 120 ||
  r.httpErrors.length > 0 ||
  (r.axe ?? []).some((v) => v.impact === "critical" || v.impact === "serious");

const failures = results.filter(isFailure);

await writeFile(join(OUT_DIR, "results.json"), JSON.stringify(results, null, 2));
await writeFile(join(OUT_DIR, "failures.json"), JSON.stringify(failures, null, 2));

const byPath = new Set(failures.map((f) => f.path));
console.log(`\n${results.length} loads, ${failures.length} flagged across ${byPath.size} routes`);
console.log(`results.json, failures.json and ${results.length} screenshots in ${OUT_DIR}`);
