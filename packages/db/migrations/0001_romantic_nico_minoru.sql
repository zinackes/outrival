CREATE INDEX "competitors_org_idx" ON "competitors" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "monitors_next_run_idx" ON "monitors" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "monitors_competitor_idx" ON "monitors" USING btree ("competitor_id");--> statement-breakpoint
CREATE INDEX "snapshots_monitor_scraped_idx" ON "snapshots" USING btree ("monitor_id","scraped_at");--> statement-breakpoint
CREATE INDEX "changes_monitor_detected_idx" ON "changes" USING btree ("monitor_id","detected_at");--> statement-breakpoint
CREATE INDEX "signals_org_created_idx" ON "signals" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "signals_competitor_created_idx" ON "signals" USING btree ("competitor_id","created_at");--> statement-breakpoint
CREATE INDEX "alerts_signal_idx" ON "alerts" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "job_postings_competitor_active_idx" ON "job_postings" USING btree ("competitor_id","is_active");--> statement-breakpoint
CREATE INDEX "reviews_competitor_detected_idx" ON "reviews" USING btree ("competitor_id","detected_at");--> statement-breakpoint
CREATE INDEX "notifications_org_created_idx" ON "notifications" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "forced_rescan_log_user_triggered_idx" ON "forced_rescan_log" USING btree ("user_id","triggered_at");