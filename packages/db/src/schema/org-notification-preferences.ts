import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  pgEnum,
} from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { organizations } from "./organizations";

// Patch-26: notification frequency moderation. Preferences are ORG-scoped (one
// row per org), mirroring the rest of the notification stack — delivery targets
// live on the org (digestEmail / slackWebhookUrl / webhookUrl) and alerts/digests
// are org-scoped. A per-user layer can be added on top once multiUser (Phase 10)
// ships, without breaking this.

// How a given severity is delivered. "muted" drops it entirely (still visible
// in-app via the signal feed).
export const channelModeEnum = pgEnum("channel_mode", [
  "email_immediate",
  "digest_daily",
  "digest_weekly",
  "in_app_only",
  "muted",
]);

export const orgNotificationPreferences = pgTable("org_notification_preferences", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id")
    .notNull()
    .unique()
    .references(() => organizations.id, { onDelete: "cascade" }),

  // Channel per severity. Defaults encode the patch's escalation ladder:
  // critical = instant email, high = next daily digest, medium = weekly digest,
  // low = in-app only.
  channelCritical: channelModeEnum("channel_critical").notNull().default("email_immediate"),
  channelHigh: channelModeEnum("channel_high").notNull().default("digest_daily"),
  channelMedium: channelModeEnum("channel_medium").notNull().default("digest_weekly"),
  channelLow: channelModeEnum("channel_low").notNull().default("in_app_only"),

  // Quiet hours. timezone is auto-detected (Intl, browser) unless the user set it
  // manually — in which case timezoneDetectedAt is null and auto-detection must
  // never overwrite it.
  timezone: text("timezone").notNull().default("UTC"),
  timezoneDetectedAt: timestamp("timezone_detected_at"),
  quietHoursStart: integer("quiet_hours_start").notNull().default(22), // 0-23 local
  quietHoursEnd: integer("quiet_hours_end").notNull().default(8), // 0-23 local
  weekendOff: boolean("weekend_off").notNull().default(true),

  // Frequency cap: max immediate emails per calendar day (org timezone). Beyond
  // it, non-critical emails are deferred to the daily digest. Critical bypasses.
  dailyEmailCap: integer("daily_email_cap").notNull().default(10),

  // Batching of similar signals (handled by signal-batching.job.ts).
  batchingEnabled: boolean("batching_enabled").notNull().default(true),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type OrgNotificationPreferences = InferSelectModel<typeof orgNotificationPreferences>;
export type NewOrgNotificationPreferences = InferInsertModel<typeof orgNotificationPreferences>;
