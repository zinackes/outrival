/**
 * Audit harness, step 1 of 4: adopt an existing browser session.
 *
 * The account signs in with Google, which cannot be driven headlessly, so the
 * session is imported from the browser instead of recreated.
 *
 * HOW TO PRODUCE THE INPUT (30 seconds, nothing is pasted into a chat):
 *   1. Open https://outrival.app/dashboard while signed in.
 *   2. DevTools > Network > click any request to outrival.app.
 *   3. Right click > Copy > Copy as cURL.
 *   4. Paste it into ~/.outrival-audit/curl.txt and save.
 *
 * "Copy as cURL" is used rather than document.cookie because the Better Auth
 * session token is HttpOnly and therefore invisible to page scripts.
 *
 * Run from the repo root:
 *   node docs/audits/2026-08-16/harness/adopt-cookies.mjs
 *
 * Writes ~/.outrival-audit/state.json, then proves it works by loading the
 * dashboard and reading back the plan. Cookie VALUES are never printed.
 */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { cwd, env, exit } from "node:process";
import { settle } from "./settle.mjs";

const require = createRequire(join(cwd(), "packages/scrapers/package.json"));
const { chromium } = require("playwright");

const WEB_URL = env.WEB_URL ?? "https://outrival.app";
const OUT_DIR = join(homedir(), ".outrival-audit");
const CURL_PATH = join(OUT_DIR, "curl.txt");
const STATE_PATH = join(OUT_DIR, "state.json");

/** Cookies are scoped to the registrable domain so they reach api.outrival.app
 *  too (auth.ts enables crossSubDomainCookies). */
const COOKIE_DOMAIN = ".outrival.app";

const JSON_PATH = join(OUT_DIR, "cookies.json");

/** Playwright wants Lax/Strict/None; extensions export them lowercased, and
 *  "no_restriction" is Chrome's wire name for None. */
const sameSite = (v) => {
  const s = String(v ?? "lax").toLowerCase();
  if (s === "strict") return "Strict";
  if (s === "none" || s === "no_restriction") return "None";
  return "Lax";
};

let cookies;
try {
  // Preferred input: a cookie-editor style JSON export. It already carries
  // domain, httpOnly and the real expiry, so nothing has to be inferred.
  const exported = JSON.parse(await readFile(JSON_PATH, "utf8"));
  cookies = exported.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain ?? COOKIE_DOMAIN,
    path: c.path ?? "/",
    expires: c.expirationDate ? Math.floor(c.expirationDate) : Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
    httpOnly: Boolean(c.httpOnly),
    secure: c.secure !== false,
    sameSite: sameSite(c.sameSite),
  }));
} catch {
  let raw;
  try {
    raw = await readFile(CURL_PATH, "utf8");
  } catch {
    console.error(`Missing both ${JSON_PATH} and ${CURL_PATH}.`);
    console.error("Provide a cookie-editor JSON export, or a 'Copy as cURL' paste. See the header of this file.");
    exit(1);
  }
  // Fallback: a full cURL paste, or a bare "k=v; k=v" cookie string.
  const headerMatch = raw.match(/-H\s+['"]?cookie:\s*([^'"\n]+)['"]?/i);
  cookies = (headerMatch?.[1] ?? raw)
    .trim()
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      return eq === -1 ? null : { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() };
    })
    .filter(Boolean)
    .map((c) => ({
      ...c,
      domain: COOKIE_DOMAIN,
      path: "/",
      expires: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
      httpOnly: c.name.includes("session_token"),
      secure: true,
      sameSite: "Lax",
    }));
}

if (cookies.length === 0) {
  console.error("No cookies found in the input. Is the paste complete?");
  exit(1);
}

const hasSession = cookies.some((c) => /session_token/.test(c.name));
console.log(`Parsed ${cookies.length} cookies: ${cookies.map((c) => c.name).join(", ")}`);
if (!hasSession) {
  console.warn("No *session_token* cookie present. The paste may come from a logged-out request.");
}

await mkdir(OUT_DIR, { recursive: true });
await writeFile(STATE_PATH, JSON.stringify({ cookies, origins: [] }, null, 2));

// Prove the session actually works before anything is built on top of it.
const browser = await chromium.launch();
const context = await browser.newContext({ storageState: STATE_PATH });
const page = await context.newPage();

await page.goto(`${WEB_URL}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45_000 });
await settle(page);

const landed = page.url();
if (/\/auth/.test(landed)) {
  console.error(`Redirected to ${landed}. The session was not accepted.`);
  await page.screenshot({ path: join(OUT_DIR, "adopt-failure.png") }).catch(() => {});
  await browser.close();
  exit(1);
}

const who = await page.evaluate(() => ({
  title: document.title,
  text: (document.body?.innerText ?? "").slice(0, 300),
}));
console.log(`\nDashboard reachable at ${landed}`);
console.log(`Title: ${who.title}`);

// Read the plan back instead of trusting a guess: it decides which gated
// features are "blocked by design" versus "broken" during the audit.
await page.goto(`${WEB_URL}/dashboard/settings/billing`, { waitUntil: "domcontentloaded" });
await settle(page);
const billing = await page.evaluate(() => (document.body?.innerText ?? "").slice(0, 1200));
const plan = billing.match(/\b(Free|Starter|Pro|Scale|Enterprise)\b/)?.[1] ?? "unknown";
console.log(`Detected plan: ${plan}`);

// audit-ux reads this from the dated artifacts dir, next to routes.json.
await mkdir(join(OUT_DIR, "2026-08-16"), { recursive: true });
await writeFile(join(OUT_DIR, "2026-08-16", "session-check.json"), JSON.stringify({ landed, plan, checkedAt: new Date().toISOString() }, null, 2));
console.log(`\nSession saved to ${STATE_PATH}`);
console.log("Next: node docs/audits/2026-08-16/harness/inventory.mjs");

await browser.close();
