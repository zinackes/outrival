import { safeFetch } from "../lib/guarded-fetch";
import type { ScrapeOptions, ScrapeOutcome } from "../types";
import { buildFingerprint, buildWellKnownDoc, type RawWellKnown } from "./wellknown";

/**
 * Well-known / public-domain fingerprint scraper. GETs four static L0 files on the
 * competitor's root domain — /.well-known/apple-app-site-association (no extension,
 * JSON), /.well-known/assetlinks.json, /llms.txt, /llms-full.txt — and synthesises a
 * deterministic snapshot. Pure fetch, no browser/cascade. A domain exposing NONE of
 * these is the COMMON, valid case (an empty fingerprint), so this NEVER throws on
 * absence — that would mark every plain-website competitor unscrapable. It only ever
 * returns a snapshot; the scrape-monitor wellknown branch decides what's a signal.
 */

const FETCH_TIMEOUT_MS = 10_000;
const UA = "Mozilla/5.0 (compatible; OutrivalBot/1.0; +https://outrival.io)";

export interface CollectDeps {
  /** Injected for tests; defaults to the SSRF-safe fetch. Null = missing/unreachable. */
  fetchText?: (url: string) => Promise<string | null>;
}

async function defaultFetchText(url: string): Promise<string | null> {
  try {
    const res = await safeFetch(url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: { "user-agent": UA, accept: "application/json, text/plain, */*" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function parseJsonSafe(text: string | null): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Fetch the four well-known files → raw payloads (any/all may be missing). */
export async function collectWellKnown(
  url: string,
  deps: CollectDeps = {},
): Promise<{ domain: string; raw: RawWellKnown }> {
  const origin = new URL(url).origin;
  const domain = new URL(url).hostname;
  const fetchText = deps.fetchText ?? defaultFetchText;

  const [aasaText, assetlinksText, llms, llmsFull] = await Promise.all([
    fetchText(`${origin}/.well-known/apple-app-site-association`),
    fetchText(`${origin}/.well-known/assetlinks.json`),
    fetchText(`${origin}/llms.txt`),
    fetchText(`${origin}/llms-full.txt`),
  ]);

  return {
    domain,
    raw: {
      aasa: parseJsonSafe(aasaText),
      assetlinks: parseJsonSafe(assetlinksText),
      // Either llms file counts as "present"; keep the richer one for its links.
      llms: llms ?? llmsFull ?? null,
    },
  };
}

export async function scrape(
  _competitorId: string,
  url: string,
  _options: ScrapeOptions = {},
): Promise<ScrapeOutcome> {
  const { domain, raw } = await collectWellKnown(url);
  const fp = buildFingerprint(raw);
  const { html, text } = buildWellKnownDoc(domain, fp);
  return {
    html,
    text,
    screenshotBuffer: Buffer.alloc(0),
    metadata: {
      url: `https://${domain}/.well-known/`,
      scrapedWith: "wellknown",
      source: "wellknown",
      iosApps: fp.appIDs.length,
      androidApps: fp.androidPackages.length,
      llms: fp.llmsPresent,
    },
    statusCode: 200,
    level: 0,
    attempts: 1,
  };
}
