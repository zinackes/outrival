DROP INDEX "user_email_canonical_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_canonical_idx" ON "user" USING btree ("email_canonical");