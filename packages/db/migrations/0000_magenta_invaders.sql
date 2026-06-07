CREATE TYPE "public"."billing_period" AS ENUM('monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('free', 'starter', 'pro', 'business');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."frequency" AS ENUM('realtime', 'daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('homepage', 'pricing', 'blog', 'changelog', 'jobs', 'g2_reviews', 'capterra_reviews', 'appstore_reviews', 'trustpilot_reviews', 'trustradius_reviews', 'gartner_reviews', 'playstore_reviews', 'reddit', 'linkedin', 'twitter', 'github_repo', 'tech_stack', 'status', 'sitemap');--> statement-breakpoint
CREATE TYPE "public"."snapshot_status" AS ENUM('success', 'failed', 'partial');--> statement-breakpoint
CREATE TYPE "public"."category" AS ENUM('pricing', 'product', 'hiring', 'reviews', 'content', 'funding');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."alert_channel" AS ENUM('email', 'slack', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."review_source" AS ENUM('g2', 'capterra', 'appstore', 'playstore', 'trustpilot', 'trustradius', 'gartner', 'reddit');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('signal', 'new_competitor', 'self_change', 'onboarding_complete', 'structural_change', 'silent_monitor');--> statement-breakpoint
CREATE TYPE "public"."candidate_source" AS ENUM('detection', 'onboarding');--> statement-breakpoint
CREATE TYPE "public"."candidate_status" AS ENUM('new', 'dismissed', 'added');--> statement-breakpoint
CREATE TYPE "public"."onboarding_session_stage" AS ENUM('started', 'input', 'profile', 'discover', 'monitoring', 'analysis_in_progress', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('new', 'reviewed', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."feedback_type" AS ENUM('bug', 'idea', 'other');--> statement-breakpoint
CREATE TYPE "public"."self_change_severity" AS ENUM('minor', 'major');--> statement-breakpoint
CREATE TYPE "public"."self_change_status" AS ENUM('pending', 'accepted', 'modified', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."sectoral_category" AS ENUM('feature_trend', 'hiring_trend', 'pricing_trend', 'positioning_shift', 'category_emergence');--> statement-breakpoint
CREATE TYPE "public"."feedback_reason" AS ENUM('irrelevant', 'incorrect', 'trivial', 'too_high_severity', 'too_low_severity', 'duplicate', 'outdated', 'other');--> statement-breakpoint
CREATE TYPE "public"."feedback_target_type" AS ENUM('signal', 'discovery_suggestion', 'battle_card', 'digest', 'severity_classification', 'nps');--> statement-breakpoint
CREATE TYPE "public"."feedback_verdict" AS ENUM('useful', 'not_useful', 'neutral');--> statement-breakpoint
CREATE TYPE "public"."channel_mode" AS ENUM('email_immediate', 'digest_daily', 'digest_weekly', 'in_app_only', 'muted');--> statement-breakpoint
CREATE TYPE "public"."alternative_status" AS ENUM('proposed', 'accepted', 'rejected', 'manual_data');--> statement-breakpoint
CREATE TYPE "public"."alternative_type" AS ENUM('different_url', 'manual_data_entry', 'pause_source', 'replace_competitor');--> statement-breakpoint
CREATE TYPE "public"."structural_change_status" AS ENUM('detected', 'confirmed', 'false_positive', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."structural_change_type" AS ENUM('pivot', 'site_dead', 'acquired', 'category_shift');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"org_id" text,
	"role" "role" DEFAULT 'member' NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"plan" "plan" DEFAULT 'free' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"plan_period" "billing_period",
	"slack_webhook_url" text,
	"webhook_url" text,
	"digest_email" text,
	"digest_enabled" boolean DEFAULT true NOT NULL,
	"alerts_enabled" boolean DEFAULT true NOT NULL,
	"product_url" text,
	"product_repo_url" text,
	"product_profile" jsonb,
	"detection_config" jsonb DEFAULT '{"minOverlap":65,"autoDetect":true,"cadence":"weekly","excludedDomains":[],"keywords":""}'::jsonb NOT NULL,
	"detection_last_run_at" timestamp,
	"onboarding_completed" boolean DEFAULT false NOT NULL,
	"project_stage" text,
	"onboarding_step" text,
	"onboarding_skipped" boolean DEFAULT false NOT NULL,
	"analysis_notified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"email" text NOT NULL,
	"name" text,
	"role" "role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"description" text,
	"overlap_score" real,
	"category" text,
	"metadata" jsonb,
	"type" text DEFAULT 'competitor' NOT NULL,
	"is_user_product" boolean DEFAULT false NOT NULL,
	"self_profile" jsonb,
	"ai_summary" text,
	"ai_summary_updated_at" timestamp,
	"pricing_status" text,
	"pricing_observed_region" text,
	"pricing_promotional" boolean DEFAULT false NOT NULL,
	"pricing_demo_url" text,
	"pricing_note" text,
	"pricing_manual_override" boolean DEFAULT false NOT NULL,
	"tech_stack_scraped_at" timestamp,
	"platform_profile" jsonb,
	"platform_detected_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"self_competitor_id" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"status" "product_status" DEFAULT 'active' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_competitors" (
	"product_id" text NOT NULL,
	"competitor_id" text NOT NULL,
	"is_specific" boolean DEFAULT false NOT NULL,
	"relevance_score" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_competitors_product_id_competitor_id_pk" PRIMARY KEY("product_id","competitor_id")
);
--> statement-breakpoint
CREATE TABLE "monitors" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"source_type" "source_type" NOT NULL,
	"frequency" "frequency" DEFAULT 'daily' NOT NULL,
	"config" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"requires_level" integer,
	"requires_level_since" timestamp,
	"requires_level_last_reprobe" timestamp,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"marked_unscrapable" boolean DEFAULT false NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"last_changed_at" timestamp,
	"scrape_started_at" timestamp,
	"last_failed_at" timestamp,
	"last_error" text,
	"last_failure_category" text,
	"last_failure_confidence" text,
	"last_failure_evidence" jsonb,
	"last_failure_diagnosed_at" timestamp,
	"api_capture_enabled" boolean DEFAULT false NOT NULL,
	"api_capture_endpoints" jsonb,
	"ai_summary" text,
	"ai_summary_updated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"monitor_id" text NOT NULL,
	"r2_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"status" "snapshot_status" DEFAULT 'success' NOT NULL,
	"scraped_at" timestamp DEFAULT now() NOT NULL,
	"etag" text,
	"last_modified" text,
	"resolved_url" text,
	"homepage_structure" jsonb,
	"screenshot_phash" text,
	"content_size" integer
);
--> statement-breakpoint
CREATE TABLE "changes" (
	"id" text PRIMARY KEY NOT NULL,
	"monitor_id" text NOT NULL,
	"snapshot_before_id" text,
	"snapshot_after_id" text NOT NULL,
	"diff_text" text,
	"diff_type" text,
	"raw_diff" jsonb,
	"structured_diff" jsonb,
	"relevance_score" real,
	"summary" text,
	"detected_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" text PRIMARY KEY NOT NULL,
	"change_id" text NOT NULL,
	"org_id" text NOT NULL,
	"competitor_id" text NOT NULL,
	"severity" "severity" NOT NULL,
	"category" "category" NOT NULL,
	"insight" text NOT NULL,
	"so_what" text,
	"recommended_action" text,
	"human_change_before" text,
	"human_change_after" text,
	"narrative" text,
	"hidden_for_user_at" timestamp,
	"severity_override" "severity",
	"severity_overridden_by" text,
	"relevance_score" real,
	"dispatched_channel" text,
	"filtered_reason" text,
	"filtered_at" timestamp,
	"batched_into_id" text,
	"daily_digest_sent_at" timestamp,
	"product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action_status" text,
	"action_note" text,
	"action_updated_at" timestamp,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"week_start" date NOT NULL,
	"week_end" date NOT NULL,
	"content" jsonb NOT NULL,
	"temperature" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"signal_id" text NOT NULL,
	"org_id" text NOT NULL,
	"channel" "alert_channel" NOT NULL,
	"sent_at" timestamp,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_postings" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"title" text NOT NULL,
	"department" text,
	"location" text,
	"url" text,
	"seniority" text,
	"posted_at" timestamp,
	"salary_min" integer,
	"salary_max" integer,
	"salary_currency" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"source" "review_source" NOT NULL,
	"score" real,
	"content" text,
	"author" text,
	"detected_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "battle_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"product_id" text,
	"org_id" text NOT NULL,
	"content" jsonb NOT NULL,
	"pdf_r2_key" text,
	"flagged_for_regeneration_at" timestamp,
	"based_on_user_update_at" timestamp,
	"based_on_competitor_signal_at" timestamp,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link_url" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"overlap_score" real,
	"reason" text,
	"status" "candidate_status" DEFAULT 'new' NOT NULL,
	"source" "candidate_source" DEFAULT 'detection' NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"last_discovery_at" timestamp DEFAULT now() NOT NULL,
	"based_on_profile_update_at" timestamp,
	"detect_count" integer DEFAULT 0 NOT NULL,
	"detect_count_month" text
);
--> statement-breakpoint
CREATE TABLE "onboarding_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text,
	"stage" "onboarding_session_stage" DEFAULT 'started' NOT NULL,
	"mode" text DEFAULT 'quick_start' NOT NULL,
	"product_url" text,
	"product_profile" jsonb,
	"discovery_suggestions" jsonb,
	"added_competitor_ids" jsonb,
	"timings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_activity_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"user_id" text,
	"type" "feedback_type" DEFAULT 'bug' NOT NULL,
	"message" text NOT NULL,
	"page_url" text,
	"console_errors" jsonb,
	"screenshot_r2_key" text,
	"user_agent" text,
	"status" "feedback_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "self_product_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"self_competitor_id" text NOT NULL,
	"change_id" text,
	"field_path" text NOT NULL,
	"previous_value" jsonb,
	"new_value" jsonb,
	"summary" text,
	"severity" "self_change_severity" NOT NULL,
	"status" "self_change_status" DEFAULT 'pending' NOT NULL,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	CONSTRAINT "self_product_changes_change_id_unique" UNIQUE("change_id")
);
--> statement-breakpoint
CREATE TABLE "sectoral_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"category" "sectoral_category" NOT NULL,
	"title" text NOT NULL,
	"insight" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"read_at" timestamp,
	"dismissed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_email" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "volatile_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"monitor_id" text NOT NULL,
	"pattern" text NOT NULL,
	"change_count" integer DEFAULT 0 NOT NULL,
	"stable_count" integer DEFAULT 0 NOT NULL,
	"is_volatile" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tech_stack_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"tech_id" text NOT NULL,
	"tech_name" text NOT NULL,
	"category" text NOT NULL,
	"importance" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"first_detected_at" timestamp DEFAULT now() NOT NULL,
	"last_detected_at" timestamp DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"target_type" "feedback_target_type" NOT NULL,
	"target_id" text NOT NULL,
	"verdict" "feedback_verdict" NOT NULL,
	"reason" "feedback_reason",
	"nps_score" integer,
	"free_text" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_quality_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"ai_task" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"org_id" text,
	"confidence" text,
	"citations" jsonb,
	"grounding_validation" jsonb,
	"grounding_score" double precision,
	"self_check_result" jsonb,
	"self_check_triggered_by" text,
	"flagged_for_human_review" boolean DEFAULT false NOT NULL,
	"flagged_at" timestamp,
	"reviewed_at" timestamp,
	"reviewed_by" text,
	"review_resolution" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_notification_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"channel_critical" "channel_mode" DEFAULT 'email_immediate' NOT NULL,
	"channel_high" "channel_mode" DEFAULT 'digest_daily' NOT NULL,
	"channel_medium" "channel_mode" DEFAULT 'digest_weekly' NOT NULL,
	"channel_low" "channel_mode" DEFAULT 'in_app_only' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"timezone_detected_at" timestamp,
	"quiet_hours_start" integer DEFAULT 22 NOT NULL,
	"quiet_hours_end" integer DEFAULT 8 NOT NULL,
	"weekend_off" boolean DEFAULT true NOT NULL,
	"daily_email_cap" integer DEFAULT 10 NOT NULL,
	"batching_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_notification_preferences_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE TABLE "org_relevance_threshold" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"threshold" real DEFAULT 0.5 NOT NULL,
	"source" text DEFAULT 'default' NOT NULL,
	"feedback_count_at_calc" integer DEFAULT 0,
	"last_recalculated_at" timestamp,
	CONSTRAINT "org_relevance_threshold_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE TABLE "signal_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"competitor_id" text NOT NULL,
	"signal_ids" jsonb NOT NULL,
	"category" text NOT NULL,
	"count" integer NOT NULL,
	"summary" text,
	"highest_severity" text NOT NULL,
	"window_start" timestamp NOT NULL,
	"window_end" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitor_alternatives" (
	"id" text PRIMARY KEY NOT NULL,
	"monitor_id" text NOT NULL,
	"type" "alternative_type" NOT NULL,
	"description" text NOT NULL,
	"suggested_url" text,
	"rationale" text,
	"status" "alternative_status" DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "structural_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"type" "structural_change_type" NOT NULL,
	"evidence" jsonb NOT NULL,
	"confidence" text NOT NULL,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"status" "structural_change_status" DEFAULT 'detected' NOT NULL,
	"resolved_at" timestamp,
	"resolution" text,
	"email_sent_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "manual_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"monitor_id" text NOT NULL,
	"user_id" text NOT NULL,
	"source_type" text NOT NULL,
	"data" jsonb NOT NULL,
	"evidence_url" text,
	"entered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forced_rescan_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"monitor_id" text NOT NULL,
	"task_id" text,
	"triggered_at" timestamp DEFAULT now() NOT NULL,
	"result_captured_at" timestamp,
	"had_new_signal" boolean
);
--> statement-breakpoint
CREATE TABLE "parser_extractors" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"source_type" "source_type" NOT NULL,
	"spec" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"heal_count" integer DEFAULT 0 NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_validated_at" timestamp,
	"last_heal_attempt_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_destinations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_pushed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "signal_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"signal_id" text NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"author_name" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"task" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"confidence" text DEFAULT '' NOT NULL,
	"self_check_passed" integer DEFAULT -1 NOT NULL,
	"grounding_score" double precision DEFAULT -1 NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extraction_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"source_type" text NOT NULL,
	"domain" text NOT NULL,
	"resolution" text NOT NULL,
	"extractor_version" integer DEFAULT 0 NOT NULL,
	"ai_used" integer DEFAULT 0 NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_counts" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"department" text NOT NULL,
	"count" integer NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "numeric_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"monitor_id" text NOT NULL,
	"pattern" text NOT NULL,
	"unit" text NOT NULL,
	"context" text NOT NULL,
	"value" double precision NOT NULL,
	"raw_text" text NOT NULL,
	"observed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_detection_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"domain" text NOT NULL,
	"stage" text NOT NULL,
	"framework" text DEFAULT '' NOT NULL,
	"cms" text DEFAULT '' NOT NULL,
	"ats" text DEFAULT '' NOT NULL,
	"pricing_widget" text DEFAULT '' NOT NULL,
	"status_page" text DEFAULT '' NOT NULL,
	"changelog" text DEFAULT '' NOT NULL,
	"techs_found" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_history" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"plan_name" text NOT NULL,
	"price" double precision NOT NULL,
	"currency" text NOT NULL,
	"billing_period" text NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"promotional" integer DEFAULT 0 NOT NULL,
	"observed_region" text DEFAULT 'FR' NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"source" text NOT NULL,
	"score" double precision NOT NULL,
	"review_count" integer NOT NULL,
	"sentiment_score" double precision NOT NULL,
	"sub_ease_of_use" double precision,
	"sub_support" double precision,
	"sub_features" double precision,
	"sub_value" double precision,
	"complaint_themes" jsonb,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"monitor_id" text NOT NULL,
	"competitor_id" text NOT NULL,
	"source_type" text NOT NULL,
	"status" text NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"failure_reason" text DEFAULT '' NOT NULL,
	"duration_ms" integer NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_feed" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"competitor_id" text NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tech_stack_history" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"tech_id" text NOT NULL,
	"event" text NOT NULL,
	"importance" text NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_self_competitor_id_competitors_id_fk" FOREIGN KEY ("self_competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_competitors" ADD CONSTRAINT "product_competitors_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_competitors" ADD CONSTRAINT "product_competitors_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_snapshot_before_id_snapshots_id_fk" FOREIGN KEY ("snapshot_before_id") REFERENCES "public"."snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_snapshot_after_id_snapshots_id_fk" FOREIGN KEY ("snapshot_after_id") REFERENCES "public"."snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_change_id_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_severity_overridden_by_users_id_fk" FOREIGN KEY ("severity_overridden_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_batched_into_id_signal_batches_id_fk" FOREIGN KEY ("batched_into_id") REFERENCES "public"."signal_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digests" ADD CONSTRAINT "digests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_cards" ADD CONSTRAINT "battle_cards_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_cards" ADD CONSTRAINT "battle_cards_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_cards" ADD CONSTRAINT "battle_cards_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_candidates" ADD CONSTRAINT "competitor_candidates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_sessions" ADD CONSTRAINT "onboarding_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_sessions" ADD CONSTRAINT "onboarding_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_product_changes" ADD CONSTRAINT "self_product_changes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_product_changes" ADD CONSTRAINT "self_product_changes_self_competitor_id_competitors_id_fk" FOREIGN KEY ("self_competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_product_changes" ADD CONSTRAINT "self_product_changes_change_id_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."changes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sectoral_signals" ADD CONSTRAINT "sectoral_signals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volatile_lines" ADD CONSTRAINT "volatile_lines_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_stack_entries" ADD CONSTRAINT "tech_stack_entries_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_feedback" ADD CONSTRAINT "quality_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_feedback" ADD CONSTRAINT "quality_feedback_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_quality_checks" ADD CONSTRAINT "ai_quality_checks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_quality_checks" ADD CONSTRAINT "ai_quality_checks_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_notification_preferences" ADD CONSTRAINT "org_notification_preferences_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_relevance_threshold" ADD CONSTRAINT "org_relevance_threshold_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_batches" ADD CONSTRAINT "signal_batches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_batches" ADD CONSTRAINT "signal_batches_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_alternatives" ADD CONSTRAINT "monitor_alternatives_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structural_changes" ADD CONSTRAINT "structural_changes_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_snapshots" ADD CONSTRAINT "manual_snapshots_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_snapshots" ADD CONSTRAINT "manual_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forced_rescan_log" ADD CONSTRAINT "forced_rescan_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forced_rescan_log" ADD CONSTRAINT "forced_rescan_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forced_rescan_log" ADD CONSTRAINT "forced_rescan_log_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_destinations" ADD CONSTRAINT "crm_destinations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_comments" ADD CONSTRAINT "signal_comments_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_comments" ADD CONSTRAINT "signal_comments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_comments" ADD CONSTRAINT "signal_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_org_idx" ON "products" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_self_competitor_uq" ON "products" USING btree ("self_competitor_id");--> statement-breakpoint
CREATE INDEX "product_competitors_competitor_idx" ON "product_competitors" USING btree ("competitor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "battle_cards_product_competitor_uq" ON "battle_cards" USING btree ("product_id","competitor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "volatile_lines_monitor_pattern_idx" ON "volatile_lines" USING btree ("monitor_id","pattern");--> statement-breakpoint
CREATE UNIQUE INDEX "tech_stack_entries_competitor_tech_uq" ON "tech_stack_entries" USING btree ("competitor_id","tech_id");--> statement-breakpoint
CREATE INDEX "quality_feedback_user_target_idx" ON "quality_feedback" USING btree ("user_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "quality_feedback_org_type_idx" ON "quality_feedback" USING btree ("org_id","target_type","created_at");--> statement-breakpoint
CREATE INDEX "ai_quality_checks_target_idx" ON "ai_quality_checks" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "ai_quality_checks_flagged_idx" ON "ai_quality_checks" USING btree ("flagged_for_human_review","created_at");--> statement-breakpoint
CREATE INDEX "ai_quality_checks_task_idx" ON "ai_quality_checks" USING btree ("ai_task","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "parser_extractors_domain_source_idx" ON "parser_extractors" USING btree ("domain","source_type");--> statement-breakpoint
CREATE INDEX "saved_views_org_idx" ON "saved_views" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "crm_destinations_org_idx" ON "crm_destinations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "signal_comments_signal_idx" ON "signal_comments" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "ai_runs_recorded_idx" ON "ai_runs" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "extraction_runs_recorded_idx" ON "extraction_runs" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "job_counts_competitor_recorded_idx" ON "job_counts" USING btree ("competitor_id","recorded_at");--> statement-breakpoint
CREATE INDEX "numeric_claims_competitor_observed_idx" ON "numeric_claims" USING btree ("competitor_id","observed_at");--> statement-breakpoint
CREATE INDEX "platform_detection_runs_recorded_idx" ON "platform_detection_runs" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "pricing_history_competitor_recorded_idx" ON "pricing_history" USING btree ("competitor_id","recorded_at");--> statement-breakpoint
CREATE INDEX "review_scores_competitor_recorded_idx" ON "review_scores" USING btree ("competitor_id","recorded_at");--> statement-breakpoint
CREATE INDEX "scrape_runs_recorded_idx" ON "scrape_runs" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "scrape_runs_monitor_recorded_idx" ON "scrape_runs" USING btree ("monitor_id","recorded_at");--> statement-breakpoint
CREATE INDEX "signal_feed_org_recorded_idx" ON "signal_feed" USING btree ("org_id","recorded_at");--> statement-breakpoint
CREATE INDEX "signal_feed_recorded_idx" ON "signal_feed" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "tech_stack_history_competitor_recorded_idx" ON "tech_stack_history" USING btree ("competitor_id","recorded_at");