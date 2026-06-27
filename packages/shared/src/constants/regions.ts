// Discovery geo-biasing. A "primary market" biases Exa company discovery toward a
// region (its ISO 3166-1 alpha-2 code feeds Exa's `userLocation`); `null` = global,
// the default and historical behaviour. It BIASES, never hard-filters — a French
// product still competes with global players, so strong off-region matches survive.

export interface DiscoveryRegion {
  /** ISO 3166-1 alpha-2, lowercase — passed to Exa `userLocation`. */
  code: string;
  label: string;
}

// Curated set of primary markets offered in the UI. Kept intentionally short
// (the common SaaS markets); extend as needed. Ordered for the picker.
export const DISCOVERY_REGIONS: DiscoveryRegion[] = [
  { code: "us", label: "United States" },
  { code: "gb", label: "United Kingdom" },
  { code: "ca", label: "Canada" },
  { code: "fr", label: "France" },
  { code: "de", label: "Germany" },
  { code: "es", label: "Spain" },
  { code: "it", label: "Italy" },
  { code: "nl", label: "Netherlands" },
  { code: "be", label: "Belgium" },
  { code: "ch", label: "Switzerland" },
  { code: "at", label: "Austria" },
  { code: "ie", label: "Ireland" },
  { code: "pt", label: "Portugal" },
  { code: "se", label: "Sweden" },
  { code: "no", label: "Norway" },
  { code: "dk", label: "Denmark" },
  { code: "fi", label: "Finland" },
  { code: "pl", label: "Poland" },
  { code: "au", label: "Australia" },
  { code: "nz", label: "New Zealand" },
  { code: "jp", label: "Japan" },
  { code: "in", label: "India" },
  { code: "sg", label: "Singapore" },
  { code: "br", label: "Brazil" },
  { code: "mx", label: "Mexico" },
  { code: "ae", label: "United Arab Emirates" },
  { code: "za", label: "South Africa" },
];

const REGION_CODES = new Set(DISCOVERY_REGIONS.map((r) => r.code));

/** True for a supported region code; `null`/`undefined`/unknown → false. */
export function isDiscoveryRegion(code: string | null | undefined): code is string {
  return typeof code === "string" && REGION_CODES.has(code);
}

/** Human label for a region code, or null for global/unknown. */
export function regionLabel(code: string | null | undefined): string | null {
  return DISCOVERY_REGIONS.find((r) => r.code === code)?.label ?? null;
}

// A few ccTLDs whose ISO code differs from the literal TLD label.
const CCTLD_ALIAS: Record<string, string> = {
  uk: "gb", // .co.uk / .uk → United Kingdom (gb)
};

/**
 * Best-effort default market from a product URL's ccTLD (e.g. `.fr` → "fr",
 * `.co.uk` → "gb"). Generic gTLDs (`.com`, `.io`, `.ai`, `.app`…) and any
 * unsupported ccTLD return null (global) — we never guess past the curated set.
 */
export function inferRegionFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const tld = host.split(".").pop();
  if (!tld) return null;
  const code = CCTLD_ALIAS[tld] ?? tld;
  return REGION_CODES.has(code) ? code : null;
}
