const MULTI_PART_TLDS = new Set([
  "co.uk",
  "co.jp",
  "co.kr",
  "co.nz",
  "co.za",
  "co.in",
  "co.id",
  "com.au",
  "com.br",
  "com.mx",
  "com.sg",
  "com.tr",
  "com.cn",
  "com.tw",
  "com.hk",
  "com.ar",
  "com.co",
  "org.uk",
  "gov.uk",
  "ac.uk",
  "ne.jp",
  "or.jp",
]);

export function extractHostname(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    const u = input.includes("://") ? new URL(input) : new URL(`https://${input}`);
    return u.hostname.toLowerCase().replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

export function normalizeHostname(input: string | null | undefined): string | null {
  const h = extractHostname(input);
  if (!h) return null;
  const parts = h.split(".").filter(Boolean);
  if (parts.length < 2) return h;
  const lastTwo = parts.slice(-2).join(".");
  if (parts.length >= 3 && MULTI_PART_TLDS.has(lastTwo)) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

/**
 * Bare host for keying per-domain resources, lowercased with `www.` stripped so
 * www/non-www share one entry (patch-30 parser-extractor cache). Keeps the full
 * host below that — `sub.domain.com` stays distinct from `domain.com`, because a
 * subdomain can ship a different layout. Null on an unparseable input.
 */
export function normalizeDomain(input: string | null | undefined): string | null {
  const h = extractHostname(input);
  if (!h) return null;
  return h.startsWith("www.") ? h.slice(4) : h;
}

/**
 * Registrable brand label, TLD-stripped — `amazon` for amazon.com, amazon.fr,
 * www.amazon.de or amazon.co.uk. Used to detect the same company across TLDs.
 */
export function extractBrand(input: string | null | undefined): string | null {
  const host = normalizeHostname(input);
  if (!host) return null;
  const label = host.split(".")[0];
  return label && label.length > 0 ? label : null;
}

const TEMPORARY_HOSTS = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  ".vercel.app", // previews (a custom domain would not end with this)
  ".netlify.app",
  ".ngrok.io",
  ".ngrok-free.app",
  ".replit.dev",
];

/**
 * Heuristic: does this URL look like a preview/local deploy rather than a real
 * product site? Used in onboarding "live" mode as a non-blocking WARNING only —
 * the user can still proceed or switch to the "developing" (repo) mode.
 */
export function detectTemporaryUrl(url: string): { temporary: boolean; reason?: string } {
  try {
    const u = new URL(url);
    if (TEMPORARY_HOSTS.some((h) => u.hostname.endsWith(h) || u.hostname === h)) {
      return { temporary: true, reason: "Cette URL semble temporaire (preview ou local)" };
    }
    return { temporary: false };
  } catch {
    return { temporary: false };
  }
}
