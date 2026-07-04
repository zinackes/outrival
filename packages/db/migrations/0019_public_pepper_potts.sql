ALTER TABLE "user" ADD COLUMN "email_canonical" text;--> statement-breakpoint
CREATE INDEX "user_email_canonical_idx" ON "user" USING btree ("email_canonical");