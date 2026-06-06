import { pgTable, text, timestamp, boolean, jsonb, integer, pgEnum } from "drizzle-orm/pg-core";
import { competitors } from "./competitors";

export const sourceTypeEnum = pgEnum("source_type", [
  "homepage", "pricing", "blog", "changelog", "jobs",
  "g2_reviews", "capterra_reviews", "appstore_reviews",
  // patch-32: additional review platforms (enable-on-demand, pro+). Kept in sync
  // with shared SOURCE_TYPES + reviewSourceEnum.
  "trustpilot_reviews", "trustradius_reviews", "gartner_reviews", "playstore_reviews",
  // patch-32: Reddit mention tracking (brand search → sentiment/themes, no star score).
  "reddit",
  "linkedin", "twitter", "github_repo",
  // patch-18: anchor monitor for tech-stack signals only. Always isActive=false,
  // never enqueued by schedule-scraping / handled by getScraper — it exists solely
  // to satisfy the changes → snapshot FK chain when an important tech appears.
  "tech_stack",
  // patch-31: competitor status page (Statuspage/Instatus JSON summary). Enabled
  // on demand when platform detection found a statusPage; scraped via the pure
  // status connector (getScraper), diffed for incident changes like any source.
  "status",
  // patch-32: sitemap discovery anchor. Internal source (like tech_stack) — never
  // user-selectable. Seeded weekly at creation, isActive=true, enqueued by
  // schedule-scraping and scraped via getScraper; the diff of its sorted URL-list
  // snapshot surfaces brand-new pages.
  "sitemap",
]);

export const frequencyEnum = pgEnum("frequency", ["realtime", "daily", "weekly"]);

export const monitors = pgTable("monitors", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  competitorId: text("competitor_id").notNull().references(() => competitors.id, { onDelete: "cascade" }),
  sourceType: sourceTypeEnum("source_type").notNull(),
  frequency: frequencyEnum("frequency").notNull().default("daily"),
  config: jsonb("config"),
  isActive: boolean("is_active").notNull().default(true),
  // Scraping cascade level this monitor needs (patch-20): 0/1 free (direct /
  // Patchright no-proxy), 2 datacenter, 3 residential, 4 Camoufox. null = not yet
  // learned / free → start the cascade at L0. Only paid levels (>=2) are pinned.
  requiresLevel: integer("requires_level"),
  // When requiresLevel was last (re)confirmed — set when the learned level moves.
  requiresLevelSince: timestamp("requires_level_since"),
  // Last time we re-probed a pinned (>=2) monitor from the bottom of the cascade,
  // so a site that stopped blocking us drops back down instead of paying forever.
  requiresLevelLastReprobe: timestamp("requires_level_last_reprobe"),
  // Consecutive run failures; after the threshold the source is marked
  // unscrapable so the UI can show a clear "temporarily unavailable" state.
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  markedUnscrapable: boolean("marked_unscrapable").notNull().default(false),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  lastChangedAt: timestamp("last_changed_at"),
  scrapeStartedAt: timestamp("scrape_started_at"),
  lastFailedAt: timestamp("last_failed_at"),
  lastError: text("last_error"),
  // Fine-grained failure diagnosis (patch-23): the last scrape failure's category
  // (anti_bot|site_dead|site_redirected|login_required|spa_empty|geo_blocked|unknown),
  // its confidence, the evidence trail (string[]), and when it was diagnosed.
  // Drives user-facing alternatives and the ops edge-cases dashboard.
  lastFailureCategory: text("last_failure_category"),
  lastFailureConfidence: text("last_failure_confidence"),
  lastFailureEvidence: jsonb("last_failure_evidence"),
  lastFailureDiagnosedAt: timestamp("last_failure_diagnosed_at"),
  // SPA runtime API capture (patch-23): once a pure SPA is detected and capture
  // discovers useful JSON endpoints, capture is enabled and the endpoints are
  // remembered so subsequent scrapes parse the API instead of the volatile DOM.
  apiCaptureEnabled: boolean("api_capture_enabled").notNull().default(false),
  apiCaptureEndpoints: jsonb("api_capture_endpoints"),
  aiSummary: text("ai_summary"),
  aiSummaryUpdatedAt: timestamp("ai_summary_updated_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
