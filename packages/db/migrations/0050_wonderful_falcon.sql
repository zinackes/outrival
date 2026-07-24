ALTER TABLE "signal_comments" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "signal_comments" ADD COLUMN "edited_at" timestamp;--> statement-breakpoint
ALTER TABLE "signal_comments" ADD CONSTRAINT "signal_comments_parent_id_signal_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."signal_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signal_comments_parent_idx" ON "signal_comments" USING btree ("parent_id");