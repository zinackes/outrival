import { pgTable, text, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { users } from "./users";
import { organizations } from "./organizations";

// Patch-25: one resumable onboarding attempt per user. Stage mirrors the
// single-page wizard screens (apps/web onboarding-form.tsx) plus the
// post-complete analysis lifecycle. Pre-complete stages are "resumable" (a
// refresh lands the user back on that screen); once /complete flips it to
// analysis_in_progress the user is on the dashboard watching the first pass.
export const onboardingSessionStageEnum = pgEnum("onboarding_session_stage", [
  "started",
  "input",
  "profile",
  "discover",
  "monitoring",
  "analysis_in_progress",
  "completed",
  "abandoned",
]);

export type OnboardingSessionProfile = {
  category: string;
  audience: string;
  valueProp: string;
  pricingModel: string;
};

export const onboardingSessions = pgTable("onboarding_sessions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  orgId: text("org_id").references(() => organizations.id, { onDelete: "cascade" }),

  stage: onboardingSessionStageEnum("stage").notNull().default("started"),
  // "quick_start" (default, formalized) | "full" — the two onboarding modes.
  mode: text("mode").notNull().default("quick_start"),

  // Saved state for resume after a tab close / refresh.
  productUrl: text("product_url"),
  productProfile: jsonb("product_profile").$type<OnboardingSessionProfile>(),
  discoverySuggestions: jsonb("discovery_suggestions").$type<unknown[]>(),
  addedCompetitorIds: jsonb("added_competitor_ids").$type<string[]>(),

  // Per-milestone timestamps (epoch ms) keyed by ONBOARDING_EVENTS name, merged
  // on each PATCH. The admin metrics compute per-step durations / percentiles in
  // JS (row counts are small) — cheaper than one nullable column per milestone.
  timings: jsonb("timings").$type<Record<string, number>>().notNull().default({}),

  startedAt: timestamp("started_at").notNull().defaultNow(),
  lastActivityAt: timestamp("last_activity_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export type OnboardingSession = InferSelectModel<typeof onboardingSessions>;
export type NewOnboardingSession = InferInsertModel<typeof onboardingSessions>;
