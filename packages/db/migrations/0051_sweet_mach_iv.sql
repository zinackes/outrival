ALTER TABLE "competitor_candidates" ADD COLUMN "snippet" text;--> statement-breakpoint
ALTER TABLE "competitor_candidates" ADD COLUMN "competitor_id" text;--> statement-breakpoint
ALTER TABLE "competitor_candidates" ADD CONSTRAINT "competitor_candidates_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE set null ON UPDATE no action;