ALTER TYPE "public"."source_type" ADD VALUE 'page_variance';--> statement-breakpoint
CREATE TABLE "signal_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"change_id" text NOT NULL,
	"competitor_id" text NOT NULL,
	"monitor_id" text NOT NULL,
	"delta_fingerprint" text NOT NULL,
	"first_excerpt" text NOT NULL,
	"second_excerpt" text,
	"quick_check_at" timestamp,
	"independent_check_at" timestamp,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"emitted" integer DEFAULT 0 NOT NULL,
	"signal_id" text,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signal_verifications" ADD CONSTRAINT "signal_verifications_change_id_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."changes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_verifications" ADD CONSTRAINT "signal_verifications_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_verifications" ADD CONSTRAINT "signal_verifications_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_verifications" ADD CONSTRAINT "signal_verifications_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signal_verifications_change_id_uq" ON "signal_verifications" USING btree ("change_id");--> statement-breakpoint
CREATE INDEX "signal_verifications_monitor_recorded_idx" ON "signal_verifications" USING btree ("competitor_id","monitor_id","recorded_at");--> statement-breakpoint
CREATE INDEX "signal_verifications_fingerprint_recorded_idx" ON "signal_verifications" USING btree ("delta_fingerprint","recorded_at");