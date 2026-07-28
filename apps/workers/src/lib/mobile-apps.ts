// Mobile-app presence recorded as a FACT on the competitor, never as a signal.
//
// Two captures we already take answer "does this competitor ship a mobile app?":
// the homepage (store badges in the footer, or a smart app banner) and the
// wellknown fingerprint (the app-association files, which a site publishes even
// when it links no badge). Neither costs a new scrape, and the parsing is AI-free.
//
// The homepage path is authoritative when it finds something: a store link carries
// Apple's numeric app id and the storefront, which is exactly what the
// `appstore_reviews` feed needs. The wellknown path only yields reverse-DNS ids, so
// an Android package becomes a Play URL for free while an iOS bundle costs one
// keyless lookup against Apple's public endpoint.
//
// We never clear a half we previously knew: not finding a badge on today's homepage
// means the badge is not on the page, not that the app is gone. And we only write
// when something actually changed, so a daily scrape of a stable site is read-only.
import { sql, eq } from "drizzle-orm";
import { db, competitors } from "@outrival/db";
import {
  detectMobileApps,
  lookupAppStoreId,
  playStoreUrl,
  type AndroidApp,
  type IosApp,
} from "@outrival/scrapers/mobile-apps";
import { parseWellKnownDoc, isIdentityProvider } from "@outrival/scrapers/wellknown";
import { logger } from "./job-logger";

/** Shape stored under `competitors.metadata.mobileApps`. Read by the API as-is. */
export interface MobileAppsMeta {
  ios: IosApp | null;
  android: AndroidApp | null;
}

/** The bundle part of an AASA appID ("TEAMID.com.acme.app" → "com.acme.app"). */
function bundleOf(appID: string): string {
  const dot = appID.indexOf(".");
  return dot >= 0 ? appID.slice(dot + 1) : appID;
}

function readStored(metadata: unknown): MobileAppsMeta | null {
  const m = (metadata as { mobileApps?: MobileAppsMeta } | null)?.mobileApps;
  return m && typeof m === "object" ? m : null;
}

/** Same apps as last time → no write. Compared on identity, not on the URL. */
function unchanged(prev: MobileAppsMeta | null, next: MobileAppsMeta): boolean {
  return (
    (prev?.ios?.appId ?? null) === (next.ios?.appId ?? null) &&
    (prev?.android?.packageName ?? null) === (next.android?.packageName ?? null)
  );
}

/**
 * What the wellknown fingerprint of this capture says about the competitor's apps.
 * The Android package maps straight to a listing; the iOS bundle needs Apple's
 * lookup, which we only pay for when we don't already have an app id on file.
 */
async function fromWellKnown(html: string, stored: MobileAppsMeta | null) {
  const fp = parseWellKnownDoc(html);
  if (!fp) return { ios: null, android: null };

  const pkg = fp.androidPackages.find((p) => !isIdentityProvider(p)) ?? null;
  const bundle = fp.appIDs.map(bundleOf).find((b) => !isIdentityProvider(b)) ?? null;

  const ios = !bundle || stored?.ios ? null : await lookupAppStoreId(bundle);
  return {
    ios,
    android: pkg ? { packageName: pkg, url: playStoreUrl(pkg) } : null,
  };
}

/**
 * Record the competitor's mobile footprint from a capture we just took. No-op for
 * every source other than homepage and wellknown. Best-effort by contract: the
 * caller must never let a failure here affect the scrape.
 */
export async function recordMobileApps(input: {
  competitorId: string;
  metadata: unknown;
  sourceType: string;
  html: string;
  url: string;
}): Promise<void> {
  const { competitorId, metadata, sourceType, html, url } = input;
  if (sourceType !== "homepage" && sourceType !== "wellknown") return;

  const stored = readStored(metadata);
  const found =
    sourceType === "homepage" ? detectMobileApps(html, url) : await fromWellKnown(html, stored);

  const next: MobileAppsMeta = {
    ios: found.ios ?? stored?.ios ?? null,
    android: found.android ?? stored?.android ?? null,
  };
  if ((!next.ios && !next.android) || unchanged(stored, next)) return;

  // Merged in SQL rather than read-modify-written, so a concurrent scrape writing
  // another key of this jsonb (ambiguousName) can't be clobbered.
  await db
    .update(competitors)
    .set({
      metadata: sql`coalesce(${competitors.metadata}, '{}'::jsonb) || ${JSON.stringify({ mobileApps: next })}::jsonb`,
    })
    .where(eq(competitors.id, competitorId));

  logger.info("Mobile apps recorded", {
    competitorId,
    sourceType,
    ios: next.ios?.appId ?? null,
    android: next.android?.packageName ?? null,
  });
}
