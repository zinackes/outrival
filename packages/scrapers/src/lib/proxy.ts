// Proxy abstraction for the scraping cascade (patch-20). Two independent axes:
// browser fingerprint (Patchright/Camoufox) vs IP reputation (these tiers). The
// cascade escalates the IP tier separately from the browser, cheapest first.
//
//   "direct"      → no proxy, the server's own IP            (L1, free)
//   "datacenter"  → ProxyScrape dedicated datacenter pool    (L2, ~fixed/mo)
//   "residential" → ProxyScrape residential pay-per-GB       (L3 + L4 fallback)
//
// ScrapingBee + Webshare were removed in patch-20: no per-request paid path.

export interface ProxyConfig {
  server: string;
  username: string;
  password: string;
}

export type ProxyTier = "direct" | "datacenter" | "residential";

/**
 * Resolve the ProxyScrape credentials for a tier from the environment. Returns
 * null for "direct" (Patchright then exits via the server IP) and also when a
 * paid tier is unconfigured — the caller falls back to the direct IP for that
 * tier instead of throwing, so a missing proxy degrades gracefully (best-effort)
 * rather than breaking every scrape.
 */
export function getProxyConfig(tier: ProxyTier): ProxyConfig | null {
  if (tier === "direct") return null;

  const prefix = tier === "datacenter" ? "PROXYSCRAPE_DC" : "PROXYSCRAPE_RESI";
  const endpoint = process.env[`${prefix}_ENDPOINT`];
  const username = process.env[`${prefix}_USERNAME`];
  const password = process.env[`${prefix}_PASSWORD`];

  if (!endpoint || !username || !password) {
    console.warn(`[proxy] ${tier} config missing — falling back to direct IP for this tier`);
    return null;
  }
  return { server: `http://${endpoint}`, username, password };
}

/** Launch options for a Patchright Chromium bound to the given proxy tier. */
export function patchrightLaunchOptions(tier: ProxyTier) {
  const proxy = getProxyConfig(tier);
  return {
    headless: true,
    proxy: proxy ?? undefined,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-dev-shm-usage", // /dev/shm is tiny under WSL → otherwise swap/crash
      "--disable-gpu",
      "--no-sandbox",
    ],
  };
}
