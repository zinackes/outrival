import {
  extractHostname,
  PLATFORM_PROFILE_VERSION,
  type PlatformProfile,
  type PlatformField,
  type PlatformConfidence,
} from "@outrival/shared";
import { fetchTechStackEvidence } from "../tech-stack/scraper";
import { matchFingerprints, type MatchInput } from "./wappalyzer/engine";
import { HOUSE_TECHNOLOGIES } from "./wappalyzer/technologies";
import { CATEGORIES } from "./wappalyzer/categories";
import { detectBusinessSignatures } from "./signatures";
import { resolveCnames } from "./dns";

/**
 * Platform detection (patch-31). `detectPlatform` is PURE — it matches a
 * PlatformProfile from already-fetched evidence (step A signals + optional
 * rendered js globals from step B). `detectPlatformForUrl` is the thin async
 * convenience that fetches the page (native GET, reusing the tech-stack fetch) and
 * optionally resolves CNAME, then calls `detectPlatform`. Heavy step B
 * (browser/SPA api-capture) is orchestrated worker-side, not here.
 */

export interface PlatformEvidence {
  url: string | null;
  html: string;
  /** Response headers, lower-cased names. */
  headers: Record<string, string>;
  scriptSrc: string[];
  /** Rendered global JS vars — present only after a render (step B). */
  js?: Record<string, unknown>;
  /** Resolved CNAME chain (empty when DNS is off/failed). */
  cname?: string[];
}

const RANK: Record<PlatformConfidence, number> = { high: 3, medium: 2, low: 1 };

export function detectPlatform(evidence: PlatformEvidence): PlatformProfile {
  const input: MatchInput = {
    html: evidence.html,
    headers: evidence.headers,
    scriptSrc: evidence.scriptSrc,
    cookies: parseCookieNames(evidence.headers),
    meta: extractMeta(evidence.html),
    js: evidence.js ?? {},
    cname: evidence.cname ?? [],
  };

  const detections = matchFingerprints(input, HOUSE_TECHNOLOGIES);

  const profile: PlatformProfile = {
    detectedAt: new Date().toISOString(),
    v: PLATFORM_PROFILE_VERSION,
  };
  const analytics: PlatformField<string>[] = [];

  for (const d of detections) {
    const fieldName = profileFieldFor(d.categories);
    if (!fieldName) continue;
    const built: PlatformField<string> = {
      value: slug(d.tech),
      confidence: d.confidence,
      evidence: d.evidence,
    };
    if (fieldName === "analytics") {
      if (!analytics.some((a) => a.value === built.value)) analytics.push(built);
      continue;
    }
    // Single-value field: keep the strongest detection.
    const current = profile[fieldName];
    if (!current || RANK[built.confidence] > RANK[current.confidence]) {
      profile[fieldName] = built;
    }
  }
  if (analytics.length > 0) profile.analytics = analytics;

  // Business signatures (ID-bearing) override the generic engine for their fields.
  const sigs = detectBusinessSignatures({
    html: evidence.html,
    scriptSrc: evidence.scriptSrc,
    cname: evidence.cname ?? [],
  });
  if (sigs.ats) profile.ats = sigs.ats;
  if (sigs.pricingWidget) profile.pricingWidget = sigs.pricingWidget;
  if (sigs.statusPage) profile.statusPage = sigs.statusPage;
  if (sigs.changelog) profile.changelog = sigs.changelog;

  return profile;
}

export interface DetectPlatformOptions {
  /** Resolve the host's CNAME (signal 6). Off by default — adds a DNS round-trip. */
  dns?: boolean;
}

/**
 * Step-A detection straight from a URL: a single native GET (the same fetch the
 * tech-stack scraper uses) + optional CNAME. Returns null when the page can't be
 * fetched (the caller treats that as "not detected", never an error).
 */
export async function detectPlatformForUrl(
  url: string,
  options: DetectPlatformOptions = {},
): Promise<PlatformProfile | null> {
  const evidence = await fetchTechStackEvidence(url);
  if (!evidence) return null;
  const cname = options.dns ? await resolveCnames(extractHostname(evidence.url)) : [];
  return detectPlatform({
    url: evidence.url,
    html: evidence.html,
    headers: evidence.responseHeaders,
    scriptSrc: evidence.scriptUrls,
    cname,
  });
}

// ── helpers ────────────────────────────────────────────────────────────────

function profileFieldFor(
  categories: number[],
): "framework" | "cms" | "hosting" | "cdn" | "analytics" | null {
  for (const cat of categories) {
    const def = CATEGORIES[cat];
    if (def) return def.profileField;
  }
  return null;
}

/** Readable, routable slug: "Next.js" → "next", "Google Analytics" → "google-analytics". */
function slug(tech: string): string {
  return tech
    .toLowerCase()
    .replace(/\.js$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `<meta name|property>` → content, lower-cased keys. Regex-only (no cheerio). */
function extractMeta(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const tags = html.match(/<meta\b[^>]*>/gi);
  if (!tags) return out;
  for (const tag of tags) {
    const name = /\b(?:name|property)=["']([^"']+)["']/i.exec(tag)?.[1];
    const content = /\bcontent=["']([^"']*)["']/i.exec(tag)?.[1];
    if (name && content !== undefined) out[name.toLowerCase()] = content;
  }
  return out;
}

/**
 * Cookie names from a (possibly comma-joined) Set-Cookie header. We only need
 * presence/name for detection, so values are left empty. The lookahead splits on
 * the comma that precedes a new `name=` pair, not commas inside a cookie value
 * (e.g. an Expires date).
 */
function parseCookieNames(headers: Record<string, string>): Record<string, string> {
  const raw = headers["set-cookie"];
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const part of raw.split(/,(?=\s*[A-Za-z0-9_\-.]+=)/)) {
    const name = part.trim().split("=")[0]?.trim();
    if (name) out[name] = "";
  }
  return out;
}
