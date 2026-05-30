import { pgTable, text, timestamp, boolean, jsonb, pgEnum } from "drizzle-orm/pg-core";

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
  digestEmail: text("digest_email"),
  digestEnabled: boolean("digest_enabled").notNull().default(true),
  alertsEnabled: boolean("alerts_enabled").notNull().default(true),
  productUrl: text("product_url"),
  productProfile: jsonb("product_profile").$type<{
    category: string;
    audience: string;
    valueProp: string;
    pricingModel: string;
  }>(),
  detectionConfig: jsonb("detection_config")
    .$type<{
      minOverlap: number;
      autoDetect: boolean;
      cadence: "weekly" | "monthly";
      excludedDomains: string[];
      keywords: string;
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
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
