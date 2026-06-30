ALTER TYPE "public"."source_type" ADD VALUE 'ai_visibility';--> statement-breakpoint
CREATE TABLE "ai_visibility_prompts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"prompt" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"origin" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_visibility_results" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"prompt_id" text NOT NULL,
	"competitor_id" text NOT NULL,
	"engine" text NOT NULL,
	"mentioned" integer DEFAULT 0 NOT NULL,
	"rank" integer,
	"cited" integer,
	"sentiment_score" double precision,
	"answer_excerpt" text,
	"run_id" text NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_visibility_prompts" ADD CONSTRAINT "ai_visibility_prompts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_visibility_prompts_org_idx" ON "ai_visibility_prompts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "ai_visibility_results_org_recorded_idx" ON "ai_visibility_results" USING btree ("org_id","recorded_at");--> statement-breakpoint
CREATE INDEX "ai_visibility_results_competitor_recorded_idx" ON "ai_visibility_results" USING btree ("competitor_id","recorded_at");