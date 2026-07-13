/**
 * Well-known / public-domain fingerprint (sitemap v2 sibling card). Two trivial L0
 * surfaces on a competitor's root domain that nobody watches:
 *  - /.well-known/apple-app-site-association + /.well-known/assetlinks.json — the
 *    iOS/Android app-association files. A NEW appID/package appearing means a MOBILE
 *    APP LAUNCH (product/high).
 *  - /llms.txt (+ /llms-full.txt) — an AI/devtools manifest. Its presence is a weak
 *    but real "this competitor is AI/devtools-oriented" tell (api_developer/low), and
 *    its link list reveals what they want LLMs to see.
 *
 * THE trap (why this isn't naive): these same two files also power passkey/WebAuthn
 * and SSO (Okta, Auth0, …) on sites with NO consumer app at all. So we (a) read app
 * IDs only from `applinks` (deep-linking), never from `webcredentials` (passkey), and
 * (b) drop any bundle/package that belongs to a known identity provider. Pure parsing
 * + a static IdP list (extensible), 0 AI, mirroring the AI-free-leaf rule.
 */

/** A known identity-provider reverse-DNS label — its app in an AASA/assetlinks file
 *  is SSO/passkey plumbing, not the competitor shipping a consumer app. Extensible. */
const IDENTITY_PROVIDER_TOKENS = new Set([
  "okta",
  "auth0",
  "onelogin",
  "pingidentity",
  "pingid",
  "duosecurity",
  "jumpcloud",
  "cloudflareaccess",
  "workos",
  "stytch",
  "descope",
  "frontegg",
  "clerk",
  "hanko",
  "corbado",
  "passage",
  "forgerock",
  "miniorange",
  "beyondidentity",
  "authsignal",
  "microsoftauthenticator",
  "azuread",
  "transmitsecurity",
]);

/** Does a reverse-DNS bundle/package belong to a known identity provider? */
export function isIdentityProvider(reverseDns: string): boolean {
  const segs = reverseDns.toLowerCase().split(/[.\-_]/).filter(Boolean);
  return segs.some((s) => IDENTITY_PROVIDER_TOKENS.has(s));
}

/** The iOS bundle part of an AASA appID ("TEAMID.com.acme.app" → "com.acme.app"). */
function bundleOf(appID: string): string {
  const dot = appID.indexOf(".");
  return dot >= 0 ? appID.slice(dot + 1) : appID;
}

/**
 * Extract deep-linking app IDs from an Apple App Site Association document. Reads
 * `applinks.details[].appIDs` (current) + `.appID` (legacy) ONLY — deliberately NOT
 * `webcredentials` (passkey-only files carry no applinks, so they yield nothing here
 * and never look like an app launch). Returns TEAMID.bundle strings. Pure, tolerant.
 */
export function parseAASA(json: unknown): string[] {
  const applinks = (json as { applinks?: unknown })?.applinks as
    | { details?: unknown; apps?: unknown }
    | undefined;
  if (!applinks || typeof applinks !== "object") return [];
  const details = Array.isArray(applinks.details) ? applinks.details : [];
  const out = new Set<string>();
  for (const d of details) {
    if (!d || typeof d !== "object") continue;
    const o = d as { appIDs?: unknown; appID?: unknown };
    if (Array.isArray(o.appIDs)) {
      for (const a of o.appIDs) if (typeof a === "string" && a) out.add(a);
    }
    if (typeof o.appID === "string" && o.appID) out.add(o.appID);
  }
  return [...out];
}

/** Extract Android package names from an assetlinks.json (Digital Asset Links).
 *  Reads target.namespace === "android_app" statements. Pure, tolerant. */
export function parseAssetlinks(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  const out = new Set<string>();
  for (const stmt of json) {
    const target = (stmt as { target?: unknown })?.target as
      | { namespace?: unknown; package_name?: unknown }
      | undefined;
    if (!target || typeof target !== "object") continue;
    if (target.namespace !== "android_app") continue;
    if (typeof target.package_name === "string" && target.package_name) {
      out.add(target.package_name);
    }
  }
  return [...out];
}

/** Presence + link list of an llms.txt: markdown links and bare URLs, capped. Pure. */
export function parseLlms(text: string, cap = 50): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (u: string) => {
    if (u && !seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  };
  for (const m of text.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)) if (m[1]) push(m[1]);
  for (const m of text.matchAll(/(?<![("])\bhttps?:\/\/[^\s)]+/g)) push(m[0]);
  return out.slice(0, cap);
}

export interface WellKnownFingerprint {
  /** Consumer iOS appIDs (TEAMID.bundle), IdP bundles removed, sorted. */
  appIDs: string[];
  /** Consumer Android packages, IdP packages removed, sorted. */
  androidPackages: string[];
  llmsPresent: boolean;
  /** Links advertised in llms.txt, sorted (positioning tell). */
  llmsLinks: string[];
}

export interface RawWellKnown {
  aasa?: unknown;
  assetlinks?: unknown;
  llms?: string | null;
}

/**
 * Build the deterministic fingerprint from the raw fetched files: app IDs / packages
 * with identity-provider entries filtered out, llms presence + links. Sorted so an
 * unchanged domain yields a constant snapshot. Pure.
 */
export function buildFingerprint(raw: RawWellKnown): WellKnownFingerprint {
  const appIDs = parseAASA(raw.aasa).filter((a) => !isIdentityProvider(bundleOf(a))).sort();
  const androidPackages = parseAssetlinks(raw.assetlinks).filter((p) => !isIdentityProvider(p)).sort();
  const llmsPresent = typeof raw.llms === "string" && raw.llms.trim().length > 0;
  const llmsLinks = llmsPresent ? parseLlms(raw.llms as string).sort() : [];
  return { appIDs, androidPackages, llmsPresent, llmsLinks };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const WELLKNOWN_DOC_MARKER = "outrival-wellknown";

/**
 * Deterministic snapshot. Verbose stable header (clears extractContent's
 * COLLAPSE_FLOOR even for an empty fingerprint — an absent .well-known footprint is
 * the common, valid case) + a JSON island the scrape-monitor branch diffs. Pure.
 */
export function buildWellKnownDoc(domain: string, fp: WellKnownFingerprint): { html: string; text: string } {
  const header =
    `Well-known public footprint for ${domain}: ${fp.appIDs.length} iOS app IDs, ` +
    `${fp.androidPackages.length} Android packages, llms.txt ${fp.llmsPresent ? "present" : "absent"}`;
  const items = [
    ...fp.appIDs.map((a) => `ios: ${a}`),
    ...fp.androidPackages.map((p) => `android: ${p}`),
    ...(fp.llmsPresent ? [`llms: ${fp.llmsLinks.length} links`] : []),
  ];
  const lis = items.map((i) => `<li>${escapeHtml(i)}</li>`).join("");
  const json = JSON.stringify({ domain, ...fp }).replace(/</g, "\\u003c");
  const html =
    `<!doctype html><html><body><section data-outrival-wellknown>` +
    `<h2>${escapeHtml(header)}</h2><ul>${lis}</ul></section>` +
    `<script type="application/json" id="${WELLKNOWN_DOC_MARKER}">${json}</script></body></html>`;
  const text = `${header}\n${items.join("\n")}`;
  return { html, text };
}

/** Read a fingerprint back out of a wellknown snapshot's JSON island (branch diff). Pure. */
export function parseWellKnownDoc(html: string): WellKnownFingerprint | null {
  const m = new RegExp(
    `<script[^>]*id=["']${WELLKNOWN_DOC_MARKER}["'][^>]*>([\\s\\S]*?)</script>`,
    "i",
  ).exec(html);
  if (!m?.[1]) return null;
  try {
    const p = JSON.parse(m[1].replace(/\\u003c/g, "<")) as Partial<WellKnownFingerprint>;
    return {
      appIDs: Array.isArray(p.appIDs) ? (p.appIDs as string[]) : [],
      androidPackages: Array.isArray(p.androidPackages) ? (p.androidPackages as string[]) : [],
      llmsPresent: !!p.llmsPresent,
      llmsLinks: Array.isArray(p.llmsLinks) ? (p.llmsLinks as string[]) : [],
    };
  } catch {
    return null;
  }
}

export interface WellKnownDelta {
  /** Consumer app IDs/packages present now but not before → mobile-app launch. */
  newApps: string[];
  /** llms.txt appeared this run (absent → present). */
  llmsAppeared: boolean;
}

/**
 * What's genuinely new vs the previous snapshot: consumer app tells (never seen
 * before) and a first-time llms.txt. A prior null fingerprint (first scrape) is the
 * baseline — nothing is "new" against it, so the very first capture never signals
 * (mirrors the other internal sources). Pure.
 */
export function wellKnownDelta(
  prev: WellKnownFingerprint | null,
  current: WellKnownFingerprint,
): WellKnownDelta {
  if (!prev) return { newApps: [], llmsAppeared: false };
  const seen = new Set([...prev.appIDs, ...prev.androidPackages]);
  const newApps = [...current.appIDs, ...current.androidPackages].filter((a) => !seen.has(a));
  return { newApps, llmsAppeared: current.llmsPresent && !prev.llmsPresent };
}
