// Shopify App Store presence recorded as a FACT on the competitor, never as a signal.
//
// An e-commerce SaaS links its own listing from its site, and that link carries the
// app handle the `shopify_reviews` capture is built on. Reading it off the homepage
// we already scrape removes the manual URL paste the source would otherwise ask for,
// exactly like mobile-apps.ts does for App Store.
//
// We never clear a handle we previously knew: a badge missing from today's homepage
// means the badge is not on the page, not that the app was delisted. And we only
// write when the handle actually changed, so a daily scrape of a stable site is
// read-only.
import { sql, eq } from "drizzle-orm";
import { db, competitors } from "@outrival/db";
import { detectShopifyApp, type ShopifyAppPresence } from "@outrival/scrapers/shopify-app";
import { logger } from "./job-logger";

/** Shape stored under `competitors.metadata.shopifyApp`. Read by the API as-is. */
export type ShopifyAppMeta = ShopifyAppPresence;

function readStored(metadata: unknown): ShopifyAppMeta | null {
  const m = (metadata as { shopifyApp?: ShopifyAppMeta } | null)?.shopifyApp;
  return m && typeof m === "object" ? m : null;
}

/**
 * Record the competitor's Shopify listing from a capture we just took. No-op for
 * every source other than homepage. Best-effort by contract: the caller must never
 * let a failure here affect the scrape.
 */
export async function recordShopifyApp(input: {
  competitorId: string;
  metadata: unknown;
  sourceType: string;
  html: string;
}): Promise<void> {
  const { competitorId, metadata, sourceType, html } = input;
  if (sourceType !== "homepage") return;

  const found = detectShopifyApp(html);
  if (!found) return;

  const stored = readStored(metadata);
  if (stored?.handle === found.handle) return;

  // Merged in SQL rather than read-modify-written, so a concurrent scrape writing
  // another key of this jsonb (mobileApps, ambiguousName) can't be clobbered.
  await db
    .update(competitors)
    .set({
      metadata: sql`coalesce(${competitors.metadata}, '{}'::jsonb) || ${JSON.stringify({ shopifyApp: found })}::jsonb`,
    })
    .where(eq(competitors.id, competitorId));

  logger.info("Shopify app recorded", { competitorId, handle: found.handle });
}
