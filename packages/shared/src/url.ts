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

export function extractHostname(input: string): string | null {
  try {
    const u = input.includes("://") ? new URL(input) : new URL(`https://${input}`);
    return u.hostname.toLowerCase().replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

export function normalizeHostname(input: string): string | null {
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
