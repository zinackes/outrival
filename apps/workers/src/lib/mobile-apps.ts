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
//
// The iOS half is also what UNBLOCKS the `appstore_reviews` source: it is the one
// source whose URL no domain can produce, so it used to wait on the user pasting an
// App Store link. Knowing the app id, we seed the monitor and run the first scrape
// straight away (seedAppStoreReviews), gated by the org's monitoring defaults.
import { sql, eq, and } from "drizzle-orm";
import { db, competitors, monitors, organizations } from "@outrival/db";
import { scrapeMonitor } from "@outrival/queue";
import {
  appStoreUrl,
  detectMobileApps,
  lookupAppStoreId,
  playStoreUrl,
  type AndroidApp,
  type IosApp,
} from "@outrival/scrapers/mobile-apps";
import { parseWellKnownDoc, isIdentityProvider } from "@outrival/scrapers/wellknown";
import {
  planAllowsMonitorSource,
  seedFrequencyFor,
  wantsDetectedSource,
} from "@outrival/shared";
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
 * Provision the App Store reviews source now that we know the competitor's numeric
 * app id — the source used to sit behind a manual paste of a URL only Apple could
 * give, on a competitor whose store badge we were already reading every day.
 *
 * Deliberately runs on every capture that KNOWS an app (not only the one that first
 * recorded it), because the three gates below move on their own: an org upgrades to
 * pro, or ticks the setting, long after the app id was written. Re-running means the
 * source appears by itself on the next scrape instead of waiting for the app to
 * change. The cost of that is one indexed lookup per capture, which is also the
 * short-circuit in the steady state.
 *
 * Never re-created once it exists: a user who turned the source off keeps it off.
 * Best-effort — a failure here must not touch the scrape.
 */
async function seedAppStoreReviews(competitorId: string, ios: IosApp): Promise<void> {
  const existing = await db.query.monitors.findFirst({
    where: and(
      eq(monitors.competitorId, competitorId),
      eq(monitors.sourceType, "appstore_reviews"),
    ),
    columns: { id: true },
  });
  if (existing) return;

  const [ctx] = await db
    .select({
      type: competitors.type,
      plan: organizations.plan,
      defaultSources: organizations.defaultSources,
    })
    .from(competitors)
    .innerJoin(organizations, eq(organizations.id, competitors.orgId))
    .where(eq(competitors.id, competitorId))
    .limit(1);
  if (!ctx) return;

  // Reviews are never scraped for the org's own product (scrape-monitor skips their
  // extraction for self), so a row here would only ever be dead weight.
  if (ctx.type === "self") return;
  if (!wantsDetectedSource("appstore_reviews", ctx.defaultSources)) return;
  // Plan-gated at SEED time rather than frozen by the scheduler: a plan that doesn't
  // include the source would otherwise show a locked row nobody asked for. The re-run
  // above provisions it on the first capture after an upgrade.
  if (!planAllowsMonitorSource(ctx.plan, "appstore_reviews")) return;

  // The canonical listing URL rather than the link we found: the id and storefront
  // are what the RSS feed is built on, and a badge href can carry campaign params.
  const [monitor] = await db
    .insert(monitors)
    .values({
      competitorId,
      sourceType: "appstore_reviews",
      frequency: seedFrequencyFor("appstore_reviews"),
      config: { url: appStoreUrl(ios.appId, ios.country) },
      scrapeStartedAt: new Date(),
    })
    .returning({ id: monitors.id });
  if (!monitor) return;

  await scrapeMonitor.enqueue({ monitorId: monitor.id });
  logger.info("Seeded App Store reviews from a detected app link", {
    competitorId,
    appId: ios.appId,
    country: ios.country,
  });
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

  // Provisioning runs off what we KNOW, so it sits above the no-change short-circuit
  // below: a competitor whose app id was recorded months ago still gets the source
  // the day the org upgrades or ticks the setting.
  if (next.ios) {
    try {
      await seedAppStoreReviews(competitorId, next.ios);
    } catch (err) {
      logger.warn("Seeding App Store reviews failed (non-fatal)", {
        competitorId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

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
