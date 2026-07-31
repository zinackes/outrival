// Reserved keys in the hiring_geo `country_code` column (Hiring Intelligence v2 P2).
//
// A job board's open roles do not all name a country: some say "EMEA", some say
// "Remote", and some say something the offline resolver cannot place. Those three
// outcomes are recorded alongside the real countries rather than dropped, because
// the share of a board we cannot place is what tells a reader whether the rest of
// the chart can be trusted — and because a footprint that silently omits them reads
// as more complete than it is.
//
// ISO-3166-1 alpha-2 codes are two UPPERCASE letters, so a lowercase reserved key
// can never collide with a real country, and the country-level signal
// (first_role_in_country) can filter on case alone.

export const HIRING_GEO_REMOTE = "remote";
export const HIRING_GEO_REGION = "region";
export const HIRING_GEO_UNRESOLVED = "unresolved";

export const HIRING_GEO_RESERVED_KEYS = [
  HIRING_GEO_REMOTE,
  HIRING_GEO_REGION,
  HIRING_GEO_UNRESOLVED,
] as const;

export type HiringGeoReservedKey = (typeof HIRING_GEO_RESERVED_KEYS)[number];

/** True for a real ISO-3166-1 alpha-2 country code (never a reserved key). */
export function isCountryKey(key: string): boolean {
  return /^[A-Z]{2}$/.test(key);
}

/** How a non-country row reads in the UI. */
export const HIRING_GEO_RESERVED_LABELS: Record<string, string> = {
  [HIRING_GEO_REMOTE]: "Remote, no country given",
  [HIRING_GEO_REGION]: "Named a region, not a country",
  [HIRING_GEO_UNRESOLVED]: "Location not resolved",
};
