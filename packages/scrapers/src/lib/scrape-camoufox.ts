import { Camoufox } from "camoufox-js";
import { getProxyConfig } from "./proxy";
import { capturePage, type PatchrightOptions, type ScrapeResult } from "./scrape-patchright";

// L4 — last resort. Camoufox is a Firefox fork patched at the C++ level, used
// ONLY when Patchright + residential is still blocked, i.e. the Chromium
// fingerprint itself is detected (rare). Runs on the residential proxy. Camoufox
// is flagged "experimental" in 2026 (maintenance gap), so we keep its use minimal
// and isolated; a failure here just surfaces as an unscrapable source.
//
// camoufox-js ships shifting/loose types across versions, so we drive it through
// a narrow structural signature instead of its declared types — this path is not
// runtime-verified in this codebase (no residential creds / Firefox binary in CI).

interface CamoufoxPage {
  goto(url: string, opts: { waitUntil: string; timeout: number }): Promise<unknown>;
  on(event: string, handler: (r: unknown) => void): void;
}
interface CamoufoxContext {
  newPage(): Promise<CamoufoxPage>;
  close(): Promise<void>;
}
interface CamoufoxBrowser {
  newContext(opts: Record<string, unknown>): Promise<CamoufoxContext>;
  isConnected(): boolean;
}
type CamoufoxLauncher = (opts: Record<string, unknown>) => Promise<CamoufoxBrowser>;

let camoufoxBrowser: CamoufoxBrowser | null = null;

async function getCamoufoxBrowser(): Promise<CamoufoxBrowser> {
  if (camoufoxBrowser && camoufoxBrowser.isConnected()) return camoufoxBrowser;
  const proxy = getProxyConfig("residential"); // Camoufox runs on residential
  const launch = Camoufox as unknown as CamoufoxLauncher;
  camoufoxBrowser = await launch({
    headless: process.env.CAMOUFOX_HEADLESS !== "false",
    proxy: proxy
      ? { server: proxy.server, username: proxy.username, password: proxy.password }
      : undefined,
    os: "windows",
    screen: { width: 1920, height: 1080 },
  });
  return camoufoxBrowser;
}

export async function scrapeWithCamoufox(
  url: string,
  options: PatchrightOptions = {},
): Promise<ScrapeResult> {
  const startedAt = Date.now();
  // Camoufox is slower through Cloudflare → longer ceiling than the Chromium path.
  const timeout = Number(process.env.CAMOUFOX_TIMEOUT_MS ?? 60000);

  let context: CamoufoxContext | null = null;
  try {
    const browser = await getCamoufoxBrowser();
    context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    const scriptUrls: string[] = [];
    page.on("response", (r: unknown) => {
      const resp = r as { request?: () => { resourceType: () => string }; url?: () => string };
      if (resp.request?.().resourceType() === "script" && resp.url) scriptUrls.push(resp.url());
    });

    const response = await page.goto(url, { waitUntil: "networkidle", timeout });
    if (!response) {
      return { ok: false, failureReason: "network_error", durationMs: Date.now() - startedAt };
    }
    // The Camoufox page/response are Playwright-API-compatible; capturePage only
    // touches the shared surface (status/content/evaluate/screenshot/headers).
    return await capturePage(
      page as unknown as Parameters<typeof capturePage>[0],
      response as unknown as Parameters<typeof capturePage>[1],
      scriptUrls,
      options,
      startedAt,
    );
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return {
      ok: false,
      failureReason: name === "TimeoutError" ? "timeout" : "network_error",
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await context?.close().catch(() => {});
  }
}
