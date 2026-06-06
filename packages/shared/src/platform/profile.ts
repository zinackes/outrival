import { z } from "zod";

/**
 * Platform profile (patch-31). The cached result of pure, AI-free detection of
 * the platforms a competitor's site runs — and, where it matters, the extracted
 * identifier (ATS board token, status-page id, RSS feed url). Persisted on
 * `competitors.platform_profile` and read on every scrape to ROUTE each source to
 * its structured connector (jobs → ATS API, changelog → RSS, …). The profile only
 * ever optimises; the scraping cascade + patch-30 staged-extraction floor still
 * guarantee a result when a field is absent or wrong.
 *
 * Every field carries `evidence[]` (which signal proved it: "header:server",
 * "script:js.stripe.com", "cname:status.x.com") so the detection is auditable and
 * a stale field is explainable, never a silent guess.
 */

export const PLATFORM_CONFIDENCE = ["high", "medium", "low"] as const;
export type PlatformConfidence = (typeof PLATFORM_CONFIDENCE)[number];

export interface PlatformField<T> {
  value: T;
  confidence: PlatformConfidence;
  /** Signal tags that matched, e.g. "header:server=vercel", "cname:*.statuspage.io". */
  evidence: string[];
}

const ConfidenceSchema = z.enum(PLATFORM_CONFIDENCE);
const StringField = z.object({
  value: z.string(),
  confidence: ConfidenceSchema,
  evidence: z.array(z.string()),
});

export const PlatformProfileSchema = z.object({
  /** Web framework: next, nuxt, remix, sveltekit, gatsby… */
  framework: StringField.optional(),
  /** CMS / site builder: webflow, wordpress, framer, ghost, shopify… */
  cms: StringField.optional(),
  /** Hosting/PaaS: vercel, netlify… */
  hosting: StringField.optional(),
  /** CDN: cloudflare, fastly, cloudfront… (low-signal, tracked not routed). */
  cdn: StringField.optional(),
  /** "<provider>:<token>" — the jobs routing key, e.g. "greenhouse:airbnb". */
  ats: StringField.optional(),
  /** Pricing widget (NOT the payment processor): "stripe" | "paddle" | "chargebee". */
  pricingWidget: StringField.optional(),
  /** "statuspage:<host-or-id>" | "instatus:<slug>" — routes to the JSON status endpoint. */
  statusPage: StringField.optional(),
  /** "canny" | "headway" | "beamer" | "rss:<feed_url>" — routes the changelog source. */
  changelog: StringField.optional(),
  /** Analytics/telemetry vendors (many): posthog, segment, ga, mixpanel… */
  analytics: z.array(StringField).optional(),
  /** ISO timestamp of the last full detection — drives the ~30d re-detect cadence. */
  detectedAt: z.string(),
  /** Schema version, so a future shape change can force a re-detect of old profiles. */
  v: z.number().int().positive(),
});

export type PlatformProfile = z.infer<typeof PlatformProfileSchema>;

/** Bump when the PlatformProfile shape changes incompatibly → forces re-detection. */
export const PLATFORM_PROFILE_VERSION = 1;
