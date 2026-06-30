DROP INDEX "monitors_next_run_idx";--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "monitors_due_idx" ON "monitors" USING btree ("next_run_at") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "changes_snapshot_after_idx" ON "changes" USING btree ("snapshot_after_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signals_change_id_uq" ON "signals" USING btree ("change_id");--> statement-breakpoint
CREATE INDEX "digests_org_week_idx" ON "digests" USING btree ("org_id","week_start");--> statement-breakpoint
CREATE INDEX "alerts_org_idx" ON "alerts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "battle_cards_org_idx" ON "battle_cards" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "battle_cards_competitor_idx" ON "battle_cards" USING btree ("competitor_id");--> statement-breakpoint
CREATE INDEX "competitor_candidates_org_idx" ON "competitor_candidates" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "onboarding_sessions_user_idx" ON "onboarding_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "self_product_changes_org_idx" ON "self_product_changes" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "sectoral_signals_org_idx" ON "sectoral_signals" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "signal_batches_org_competitor_idx" ON "signal_batches" USING btree ("org_id","competitor_id");--> statement-breakpoint
CREATE INDEX "monitor_alternatives_monitor_idx" ON "monitor_alternatives" USING btree ("monitor_id");--> statement-breakpoint
CREATE INDEX "structural_changes_competitor_idx" ON "structural_changes" USING btree ("competitor_id");