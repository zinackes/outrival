/**
 * Mobile-app presence — an informational fact, never a signal.
 *
 * Whether a competitor ships an iOS / Android app is something a user would
 * otherwise go and look up by hand, and the tell already sits in HTML we capture
 * daily: a product with an app almost always links its store badges from the
 * footer, and iOS-aware sites additionally advertise a smart app banner
 * (`<meta name="apple-itunes-app" content="app-id=…">`).
 *
 * Two deliberate properties:
 *  - Pure parsing, zero AI, mirroring the leaf-parser rule of the other sources.
 *  - An App Store link carries Apple's NUMERIC app id, which is exactly the key
 *    the `appstore_reviews` RSS feed is built on. Detecting it therefore also
 *    removes the manual URL paste that source asks the user for today.
 *
 * The .well-known files (wellknown.ts) are the fallback for a site that ships an
 * app but never links a badge. They only yield reverse-DNS identifiers: an
 * Android package IS a Play Store URL (deterministic, no request), while an iOS
 * bundle is NOT an App Store URL and has to go through Apple's public keyless
 * lookup endpoint.
 */
import { parseAppStoreUrl, extractBrand } from "@outrival/shared";
import { safeFetch } from "../lib/guarded-fetch";
import { isIdentityProvider } from "../wellknown/wellknown";

export interface IosApp {
  /** Apple's numeric App Store id — the key the customer-reviews RSS feed uses. */
  appId: string;
  /** Storefront the link was published under ("us" when it carries none). */
  country: string;
  url: string;
}

export interface AndroidApp {
  packageName: string;
  url: string;
}

/** What we know about a competitor's mobile footprint. Either half may be null. */
export interface MobileAppPresence {
  ios: IosApp | null;
  android: AndroidApp | null;
}

/** Canonical Play Store listing for a package. Deterministic, no lookup needed. */
export function playStoreUrl(packageName: string): string {
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}`;
}

/** Canonical App Store listing for a numeric app id. */
export function appStoreUrl(appId: string, country = "us"): string {
  return `https://apps.apple.com/${country}/app/id${appId}`;
}

// Store URLs as they appear in markup: absolute, or protocol-relative ("//apps…").
// Bounded by the characters that end an attribute, a text URL or a markdown link.
const APPLE_URL_RE = /(?:https?:)?\/\/(?:apps|itunes)\.apple\.com\/[^\s"'<>)\\]+/gi;
const PLAY_URL_RE =
  /(?:https?:)?\/\/play\.google\.com\/store\/apps\/details\?[^\s"'<>)\\]+/gi;
// Smart app banner. Its content is a comma-separated list; only app-id is required.
const ITUNES_META_RE =
  /<meta[^>]+name=["']apple-itunes-app["'][^>]+content=["']([^"']+)["']/i;

/** Attribute values arrive HTML-escaped, so `&amp;` has to become `&` to parse. */
function unescapeUrl(raw: string): string {
  const decoded = raw.replace(/&amp;/gi, "&");
  return decoded.startsWith("//") ? `https:${decoded}` : decoded;
}

/**
 * Does this reverse-DNS id or store slug belong to the competitor themselves?
 * "com.Slack" against slack.com, "com.linear" against linear.app. Used to pick
 * between candidates on a page that links more than one app (an integrations
 * page, a partner badge), never to reject the only candidate found.
 */
function matchesBrand(candidate: string, brand: string | null): boolean {
  if (!brand) return false;
  return candidate
    .toLowerCase()
    .split(/[.\-_/]/)
    .filter(Boolean)
    .includes(brand.toLowerCase());
}

/**
 * The competitor's own app among several candidates: one whose identifier names
 * the brand wins, otherwise the first one on the page (badges live in the footer
 * of the site they belong to, so document order is a decent tiebreak).
 */
function pickOwn<T>(candidates: T[], brand: string | null, hint: (c: T) => string): T | null {
  return candidates.find((c) => matchesBrand(hint(c), brand)) ?? candidates[0] ?? null;
}

/** Every distinct App Store listing linked on the page, in document order. */
function collectIosLinks(html: string): Array<IosApp & { slug: string }> {
  const out: Array<IosApp & { slug: string }> = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(APPLE_URL_RE)) {
    const url = unescapeUrl(m[0]);
    // Developer and editorial pages carry an /idNNN too, but that id is not an app
    // and would resolve to an empty reviews feed.
    if (/\/(?:developer|story|app-bundle)\//i.test(url)) continue;
    const ref = parseAppStoreUrl(url);
    if (!ref || seen.has(ref.appId)) continue;
    seen.add(ref.appId);
    // ".../app/<slug>/id123" — the slug is the brand tell when there are several.
    const slug = /\/app\/([^/]+)\/id\d/i.exec(url)?.[1] ?? "";
    out.push({ appId: ref.appId, country: ref.country, url, slug });
  }
  return out;
}

/** Every distinct Play Store listing linked on the page, in document order. */
function collectAndroidLinks(html: string): AndroidApp[] {
  const out: AndroidApp[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(PLAY_URL_RE)) {
    let pkg: string | null = null;
    try {
      pkg = new URL(unescapeUrl(m[0])).searchParams.get("id");
    } catch {
      continue;
    }
    // Same trap as the well-known files: an SSO/passkey vendor's app is plumbing,
    // not this competitor shipping a consumer app.
    if (!pkg || seen.has(pkg) || isIdentityProvider(pkg)) continue;
    seen.add(pkg);
    out.push({ packageName: pkg, url: playStoreUrl(pkg) });
  }
  return out;
}

/**
 * Read a competitor's mobile footprint off a page we already captured. `pageUrl`
 * is only used to work out the brand, so a page linking several apps resolves to
 * theirs. Pure — no network, no AI. Returns nulls when the page shows no app,
 * which is the common case and means nothing more than "not advertised here".
 */
export function detectMobileApps(html: string, pageUrl?: string): MobileAppPresence {
  const brand = extractBrand(pageUrl);

  // A smart app banner is by definition the site's OWN app (a page never publishes
  // one for someone else's), so it outranks any linked badge.
  const bannerId = /app-id\s*=\s*(\d+)/i.exec(ITUNES_META_RE.exec(html)?.[1] ?? "")?.[1];
  const iosLinks = collectIosLinks(html);
  const ios: IosApp | null = bannerId
    ? // Prefer a real link for the same app: it carries the storefront the site
      // publishes under, which the banner does not.
      (iosLinks.find((l) => l.appId === bannerId) ?? {
        appId: bannerId,
        country: "us",
        url: appStoreUrl(bannerId),
      })
    : pickOwn(iosLinks, brand, (l) => l.slug);

  const android = pickOwn(collectAndroidLinks(html), brand, (l) => l.packageName);

  return {
    ios: ios ? { appId: ios.appId, country: ios.country, url: ios.url } : null,
    android,
  };
}

const LOOKUP_TIMEOUT_MS = 8_000;

export interface LookupDeps {
  /** Injected by tests; defaults to the SSRF-safe fetch. */
  fetchJson?: (url: string) => Promise<unknown>;
}

/**
 * Resolve an iOS bundle id (all the .well-known file gives us) to its numeric App
 * Store id, through Apple's public iTunes lookup endpoint — keyless, the same
 * family as the customer-reviews RSS feed `appstore_reviews` already reads.
 * Best-effort: an app that is not on the given storefront, a rate limit or a
 * network blip all return null, and the caller simply records no iOS link.
 */
export async function lookupAppStoreId(
  bundleId: string,
  country = "us",
  deps: LookupDeps = {},
): Promise<IosApp | null> {
  const url =
    `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}` +
    `&country=${encodeURIComponent(country)}&entity=software`;
  const fetchJson = deps.fetchJson ?? defaultFetchJson;
  let body: unknown;
  try {
    body = await fetchJson(url);
  } catch {
    return null;
  }
  const results = (body as { results?: unknown })?.results;
  if (!Array.isArray(results)) return null;
  for (const r of results) {
    const trackId = (r as { trackId?: unknown })?.trackId;
    if (typeof trackId !== "number" && typeof trackId !== "string") continue;
    const appId = String(trackId);
    if (!/^\d+$/.test(appId)) continue;
    const viewUrl = (r as { trackViewUrl?: unknown })?.trackViewUrl;
    return {
      appId,
      country,
      url: typeof viewUrl === "string" && viewUrl ? viewUrl : appStoreUrl(appId, country),
    };
  }
  return null;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await safeFetch(url, {
    timeoutMs: LOOKUP_TIMEOUT_MS,
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; OutrivalBot/1.0; +https://outrival.io)",
      accept: "application/json",
    },
  });
  if (!res.ok) return null;
  return await res.json();
}
