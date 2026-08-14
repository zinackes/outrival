import { pgTable, text, timestamp, boolean, jsonb, pgEnum } from "drizzle-orm/pg-core";
import type { SourceType } from "@outrival/shared";

export const planEnum = pgEnum("plan", ["free", "starter", "pro", "business"]);
export const billingPeriodEnum = pgEnum("billing_period", ["monthly", "yearly"]);

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: planEnum("plan").notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  planPeriod: billingPeriodEnum("plan_period"),
  slackWebhookUrl: text("slack_webhook_url"),
  webhookUrl: text("webhook_url"),
  digestEmail: text("digest_email"),
  digestEnabled: boolean("digest_enabled").notNull().default(true),
  alertsEnabled: boolean("alerts_enabled").notNull().default(true),
  productUrl: text("product_url"),
  // GitHub repo of the user's product (developing stage) — monitored via the
  // github_repo source when there's no live site yet (patch-15).
  productRepoUrl: text("product_repo_url"),
  // Mirrors ProductProfileSchema (@outrival/ai). whatItDoes/keywords are optional:
  // the AI has derived them since patch-25, but rows written before that don't carry
  // them — and the column type omitted them entirely, so anything reading this profile
  // back could not see the two fields that sharpen the discovery query.
  productProfile: jsonb("product_profile").$type<{
    category: string;
    audience: string;
    valueProp: string;
    pricingModel: string;
    whatItDoes?: string;
    keywords?: string[];
  }>(),
  detectionConfig: jsonb("detection_config")
    .$type<{
      minOverlap: number;
      autoDetect: boolean;
      cadence: "weekly" | "monthly";
      excludedDomains: string[];
      keywords: string;
      // Primary market for discovery geo-biasing (ISO alpha-2, null = global).
      // Optional: legacy rows predate it; resolveDetectionConfig fills the default.
      region?: string | null;
    }>()
    .notNull()
    .default({
      minOverlap: 65,
      autoDetect: true,
      cadence: "weekly",
      excludedDomains: [],
      keywords: "",
    }),
  detectionLastRunAt: timestamp("detection_last_run_at"),
  // Which sources a newly-added competitor starts monitoring (Settings → General →
  // "Monitoring defaults"). Narrowed by the plan at seed time, so storing a source
  // the org can't reach yet is harmless — it starts applying on upgrade. null = the
  // built-in default set, kept nullable rather than defaulted so widening that set
  // later reaches every org that never customised it.
  defaultSources: jsonb("default_sources").$type<SourceType[]>(),
  // The volumes this workspace compares metered pricing at (Pricing Intelligence
  // P3). A meter and a quantity: "10,000 requests", "500 GB". null = the preset
  // ladder, kept nullable rather than defaulted so a change to the presets
  // reaches every workspace that never set its own. NOT a scrape input — the
  // cost at a custom volume is computed on read from the SAME cost model that
  // wrote the stored points, so editing this never needs a re-capture.
  referenceVolumes: jsonb("reference_volumes").$type<Array<{ unit: string; qty: number }>>(),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  // Project stage chosen at onboarding step 1: "idea" | "document" | "developing" | "live".
  // Drives which input mode the user went through and lets us adapt re-onboarding.
  projectStage: text("project_stage"),
  // Last reached onboarding step, for resuming after a tab close:
  // "stage" | "input" | "profile" | "discover" | "monitoring" | "done".
  onboardingStep: text("onboarding_step"),
  // True when the user chose "leave for now" — grants dashboard access without
  // having completed onboarding (non-blocking completion banner shown instead).
  onboardingSkipped: boolean("onboarding_skipped").notNull().default(false),
  // Set once the first post-onboarding analysis pass finishes (all selected
  // competitors have an AI summary) or the watcher times out. One-shot guard for
  // the "analysis ready" notification so it never fires twice (e.g. re-onboarding).
  analysisNotifiedAt: timestamp("analysis_notified_at"),
  // OUT-193 — self-updating battle cards. When on, the daily
  // refresh-stale-battle-cards cron regenerates the org's cards that the feed has
  // outdated, instead of leaving them frozen until someone clicks Regenerate.
  // Defaults ON, but the cron skips free orgs: their whole quota is 1 card/day, so
  // an automatic refresh would spend the card the user wanted to generate himself.
  battleCardAutoRefresh: boolean("battle_card_auto_refresh").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
