import { chromium } from "patchright";
import { patchrightLaunchOptions } from "../lib/proxy";
import { realisticHeaders, realisticUserAgent } from "../lib/fingerprint";
import { collapseAnimatedCounters } from "../lib/normalize-text";
import type { CapturedApiCall } from "./filter";

/**
 * Runtime API capture for pure SPAs (patch-23). When a site renders almost no
 * HTML and loads its content from a JSON API, we observe the XHR/fetch calls,
 * keep the JSON ones, and hand them to the pure filter (./filter) which turns the
 * relevant ones into a document the normal pipeline consumes.
 *
 * Imports Patchright (Chromium) → heavy: exposed via the main `@outrival/scrapers`
 * entry and lazy-imported worker-side, never from a pure subpath.
 */

export interface SpaCaptureResult {
  html: string;
  text: string;
  statusCode?: number;
  apiCalls: CapturedApiCall[];
}

const BODY_CAP = 50_000;

export async function scrapeWithApiCapture(url: string): Promise<SpaCaptureResult> {
  const timeout = Number(process.env.SPA_API_CAPTURE_TIMEOUT_MS ?? 15_000);
  // Discovery runs on the server IP (no proxy): a pure SPA returned a 200 shell,
  // so it isn't IP-blocked — it just needs its API observed.
  const browser = await chromium.launch(patchrightLaunchOptions("direct"));
  try {
    const context = await browser.newContext({
      userAgent: realisticUserAgent(),
      locale: "en-US",
      timezoneId: "America/New_York",
      viewport: { width: 1920, height: 1080 },
      extraHTTPHeaders: realisticHeaders(),
    });
    const page = await context.newPage();
    const apiCalls: CapturedApiCall[] = [];

    page.on("response", async (response) => {
      try {
        const request = response.request();
        const type = request.resourceType();
        if (type !== "xhr" && type !== "fetch") return;
        const contentType = response.headers()["content-type"] ?? "";
        if (!contentType.includes("json")) return;
        const rawText = await response.text();
        let body: unknown = null;
        try {
          body = JSON.parse(rawText);
        } catch {
          // not valid JSON — keep the raw text only
        }
        apiCalls.push({
          url: response.url(),
          method: request.method(),
          status: response.status(),
          contentType,
          body,
          rawText: rawText.slice(0, BODY_CAP),
        });
      } catch {
        // a single failed body read must never break the capture
      }
    });

    try {
      const response = await page.goto(url, { waitUntil: "networkidle", timeout });
      // Let late XHR/fetch calls (post-hydration data fetches) land.
      await page.waitForTimeout(2000);
      const html = await page.content();
      const text = collapseAnimatedCounters(await page.evaluate(() => document.body?.innerText ?? ""));
      return { html, text, statusCode: response?.status(), apiCalls };
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }
}
