// Proxy abstraction for the scraping cascade. The egress IP is chosen UPSTREAM by
// the monitor (stability / geolocation), NOT in reaction to a block — a proxy
// triggered by a block would be an evasion tool, which the collection doctrine
// forbids. Two tiers only:
//
//   "direct"      → no proxy, the server's own IP            (L0/L1, free)
//   "datacenter"  → ProxyScrape dedicated datacenter pool    (L2, ~fixed/mo egress)
//
// The former L3 upper IP-reputation proxy tier was removed with the doctrine:
// rotating IPs to defeat a site's reputation checks is circumvention, not routing.

export interface ProxyConfig {
  server: string;
  username: string;
  password: string;
}

export type ProxyTier = "direct" | "datacenter";

/**
 * Resolve the ProxyScrape datacenter credentials from the environment. Returns
 * null for "direct" (the browser exits via the server IP) and also when the
 * datacenter tier is unconfigured — the caller falls back to the direct IP
 * instead of throwing, so a missing proxy degrades gracefully (best-effort)
 * rather than breaking every scrape.
 */
export function getProxyConfig(tier: ProxyTier): ProxyConfig | null {
  if (tier === "direct") return null;

  const endpoint = process.env.PROXYSCRAPE_DC_ENDPOINT;
  const username = process.env.PROXYSCRAPE_DC_USERNAME;
  const password = process.env.PROXYSCRAPE_DC_PASSWORD;

  if (!endpoint || !username || !password) {
    console.warn(`[proxy] datacenter config missing — falling back to direct IP`);
    return null;
  }
  return { server: `http://${endpoint}`, username, password };
}

/**
 * Launch options for the render browser (vanilla Playwright Chromium) bound to the
 * given egress tier. NO automation-fingerprint spoofing: the collection doctrine
 * renders in the open — the honest OutrivalBot User-Agent identifies us and
 * navigator.webdriver stays true. The args here are infra-only (sandbox,
 * shared-memory, GPU), never a stealth flag such as
 * `--disable-blink-features=AutomationControlled`.
 */
export function browserLaunchOptions(tier: ProxyTier) {
  const proxy = getProxyConfig(tier);
  return {
    headless: true,
    proxy: proxy ?? undefined,
    args: [
      "--disable-dev-shm-usage", // /dev/shm is tiny under WSL → otherwise swap/crash
      "--disable-gpu",
      "--no-sandbox",
    ],
  };
}
