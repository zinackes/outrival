// @ts-check
//
// Versioned capture of the real product screenshots used on the landing (/) and the
// /demo page. Drives a headless Chromium against the dev-only /dev/preview route,
// which renders the ACTUAL dashboard components (Overview, SignalCard, SignalEvidence)
// against sample data — no auth, no API — so the marketing captures always reflect the
// current UI. Re-run whenever the dashboard UI changes.
//
// Prerequisites:
//   • the web app running locally      → pnpm --filter @outrival/web dev   (port 3000)
//   • the chromium browser installed   → npx playwright install chromium
//
// Usage:
//   pnpm --filter @outrival/web capture:shots
//   CAPTURE_BASE_URL=http://localhost:3000 node scripts/capture-product-shots.mjs
//
// Output: apps/web/public/product/{overview,signal-detail,dashboard}.webp
// Viewport 1440×900 (1600×950 for the full app), deviceScaleFactor 2 (retina),
// dark theme, WebP q82.

import { chromium } from "playwright";
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(WEB_ROOT, "public", "product");
const BASE_URL = process.env.CAPTURE_BASE_URL ?? "http://localhost:3000";

/**
 * `viewport` overrides the default only where the shot needs it: the app shot
 * carries the sidebar, so it needs the width a real desktop gives it.
 * @type {{ shot: "overview" | "signal" | "app", file: string,
 *          viewport?: { width: number, height: number } }[]}
 */
const SHOTS = [
  { shot: "overview", file: "overview.webp" },
  { shot: "signal", file: "signal-detail.webp" },
  { shot: "app", file: "dashboard.webp", viewport: { width: 1600, height: 910 } },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });

  // Pre-answer the CNIL cookie consent (ph_consent cookie) so its banner never opens
  // and overlaps the capture — it's app chrome, not product.
  await context.addCookies([
    { name: "ph_consent", value: "denied", url: BASE_URL },
  ]);

  // Force sample mode + dark theme before any app code runs → no skeleton flash and
  // no theme flip mid-capture.
  await context.addInitScript(() => {
    try {
      sessionStorage.setItem("outrival:sample", "1");
      localStorage.setItem("theme", "dark");
    } catch {
      /* private mode — ignore */
    }
  });

  const page = await context.newPage();

  for (const { shot, file, viewport } of SHOTS) {
    if (viewport) await page.setViewportSize(viewport);
    const url = `${BASE_URL}/dev/preview?shot=${shot}`;
    // Not "networkidle": Next dev keeps an HMR websocket open, so networkidle never
    // fires. Wait on the shot container + fonts instead.
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const el = await page.waitForSelector(`[data-shot="${shot}"]`, {
      timeout: 30_000,
    });
    // Next's dev indicator is a body-level portal, so it paints OVER the shot
    // and lands in the crop of anything that reaches the bottom-left corner.
    await page.addStyleTag({
      content: "nextjs-portal{display:none!important}",
    });
    // The sidebar's competitor rail opens by default and polls the API, which
    // this route deliberately does not have — so it would be captured as three
    // loading bars. Collapsed, it is the same nav a signed-in user sees folded.
    if (shot === "app") {
      const collapse = await page.$('[aria-label="Collapse competitors"]');
      if (collapse) await collapse.click();
    }
    await page.evaluate(() => document.fonts?.ready);
    await page.waitForTimeout(700);

    const png = await el.screenshot({ type: "png" });
    const webp = await sharp(png).webp({ quality: 82, effort: 6 }).toBuffer();
    const dest = join(OUT_DIR, file);
    await writeFile(dest, webp);
    console.log(
      `✓ ${shot.padEnd(9)} → public/product/${file} (${(webp.length / 1024).toFixed(0)} KB)`,
    );
  }

  await browser.close();
}

main().catch((err) => {
  console.error("capture failed:", err);
  process.exit(1);
});
