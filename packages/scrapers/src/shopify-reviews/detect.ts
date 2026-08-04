/**
 * Passive detection of a competitor's own Shopify App Store listing.
 *
 * An e-commerce SaaS that ships a Shopify app links it from its own site ("Install
 * on Shopify", a store badge, the integrations page), and that link carries the app
 * HANDLE, which is exactly the key the reviews capture is built on. Detecting it
 * removes the manual URL paste the source would otherwise ask for, the same way
 * mobile-apps.ts removes it for App Store.
 *
 * Pure parsing, zero AI, no request: it reads HTML we already captured.
 */
import { parseShopifyAppUrl, shopifyAppUrl } from "@outrival/shared";

export interface ShopifyAppPresence {
  handle: string;
  url: string;
}

// Listing URLs as they appear in markup: absolute or protocol-relative, bounded by
// whatever ends an attribute, a text URL or a markdown link.
const SHOPIFY_APP_URL_RE = /(?:https?:)?\/\/apps\.shopify\.com\/[^\s"'<>)\\]+/gi;

/**
 * The competitor's own listing, or null.
 *
 * Null when the page links SEVERAL distinct apps: an integrations directory or a
 * comparison page names other vendors' listings, and picking one of those would
 * quietly point the reviews monitor at a competitor's competitor. One handle is a
 * fact; two is a guess, and this returns facts only.
 */
export function detectShopifyApp(html: string): ShopifyAppPresence | null {
  const handles = new Set<string>();
  for (const raw of html.match(SHOPIFY_APP_URL_RE) ?? []) {
    const absolute = raw.startsWith("//") ? `https:${raw}` : raw;
    const ref = parseShopifyAppUrl(absolute);
    if (ref) handles.add(ref.handle);
  }
  if (handles.size !== 1) return null;
  const [handle] = [...handles];
  if (!handle) return null;
  return { handle, url: shopifyAppUrl(handle) };
}
