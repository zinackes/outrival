/**
 * Customer-name identity for the known-customers registry (Content Intelligence
 * v2 P3).
 *
 * A competitor names the same customer three ways without meaning anything by it:
 * "Acme Inc." in a case-study title, "Acme" in the logo's alt text, "ACME GmbH" on
 * the customers page. The registry exists to make `customer_win` fire ONCE per
 * customer per competitor, ever, so those three have to be one key — otherwise the
 * same win is announced every time a new surface mentions it.
 *
 * Deliberately CONSERVATIVE. Lowercase, collapse whitespace, strip the legal-form
 * suffix, drop trailing punctuation. Nothing else. Aggressive normalisation
 * (dropping "the", stripping every non-letter, collapsing spaces away) would merge
 * two genuinely different customers — "Data Inc" and "Datainc" are not obviously
 * the same company, and a false merge SILENTLY loses a win, which is the failure
 * this feature has no way to notice.
 *
 * PURE: no I/O, no DB.
 */

/**
 * Legal forms, stripped only when they TRAIL the name. A company called "SAS
 * Institute" keeps its "SAS" — the token is only a legal form when it is where a
 * legal form goes.
 */
const LEGAL_SUFFIXES = [
  "inc",
  "incorporated",
  "llc",
  "l l c",
  "ltd",
  "limited",
  "plc",
  "corp",
  "corporation",
  "co",
  "company",
  "gmbh",
  "mbh",
  "ag",
  "kg",
  "ohg",
  "ug",
  "sas",
  "sasu",
  "sarl",
  "sa",
  "sarlu",
  "eurl",
  "snc",
  "bv",
  "nv",
  "bvba",
  "ab",
  "oy",
  "oyj",
  "as",
  "asa",
  "aps",
  "spa",
  "srl",
  "sl",
  "slu",
  "sl u",
  "spzoo",
  "pty",
  "pty ltd",
  "pte",
  "pte ltd",
  "kk",
  "kabushiki kaisha",
  "gmbh co kg",
];

const SUFFIX_RE = new RegExp(`(?:[,\\s]+(?:${LEGAL_SUFFIXES.join("|")}))+$`, "i");

/**
 * The registry key for a customer name. Empty string when the input carries no
 * name at all, which callers treat as "not a customer" rather than as a key.
 */
export function normalizeCustomerName(raw: string): string {
  const base = raw
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    // Trailing punctuation a title leaves behind ("Acme.", "Acme —").
    .replace(/[\s.,;:•·|—–-]+$/g, "")
    .toLowerCase()
    // Punctuation INSIDE the legal form only ("acme, inc." → "acme, inc"), so the
    // suffix pattern below can be written against words.
    .replace(/[.]/g, "");
  const stripped = base.replace(SUFFIX_RE, "").replace(/[\s,]+$/g, "");
  // A name that IS its legal form ("GmbH") normalises to nothing; keep the original
  // rather than mint an empty key.
  return (stripped || base).trim();
}

/** Display form: whitespace collapsed, trailing punctuation dropped, casing kept
 *  exactly as the page wrote it. The key is for matching; this is for reading. */
export function displayCustomerName(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s.,;:•·|—–-]+$/g, "")
    .trim();
}
