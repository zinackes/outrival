import { pgTable, text, timestamp, boolean, jsonb, integer, pgEnum, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { competitors } from "./competitors";

export const sourceTypeEnum = pgEnum("source_type", [
  "homepage", "pricing", "blog", "changelog", "jobs",
  // App Store customer reviews via Apple's public RSS JSON feed (kept in sync with
  // shared SOURCE_TYPES). The one review platform read directly.
  "appstore_reviews",
  // Trustpilot public surface (Reviews v2) — score/count/distribution/trend via the
  // OFFICIAL Trustpilot API, never scraped verbatims. Kept in sync with SOURCE_TYPES.
  "trustpilot_public",
  // RETIRED for legal reasons (Reviews v2, migration below). Aggregators whose ToS
  // forbid scraping + commercial use and who license the data as a product. Enum
  // values KEPT (never dropped) so existing rows stay valid — the migration marks
  // those monitors marked_unscrapable + refusal_reason='source_retired_legal' instead
  // of cascade-deleting history. No scraper, ungated, not user-selectable. Kept in
  // sync with shared SOURCE_TYPES + reviewSourceEnum.
  "g2_reviews", "capterra_reviews",
  "trustpilot_reviews", "trustradius_reviews", "gartner_reviews", "playstore_reviews",
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
  // News / funding (company-level events). Internal source (like sitemap) — never
  // user-selectable. Seeded weekly at creation, isActive=true, enqueued by
  // schedule-scraping and scraped via getScraper (Google News RSS by brand); the
  // diff of its sorted snapshot surfaces new events, classified funding/product.
  "news",
  // AI Visibility / "Share of Model" (docs/ai-visibility.md). Infra-only anchor
  // source (like tech_stack): never user-selectable, excluded from plan gating —
  // it exists solely to anchor the snapshot → change → signal FK chain when the
  // visibility picture shifts (a competitor overtakes you in an engine's answers).
  // The capability is gated by the org-level features.aiVisibility plan flag, not
  // by allowedSources; the actual data lives in ai_visibility_prompts/_results.
  "ai_visibility",
  // Subdomains via Certificate Transparency (crt.sh). Internal source (like
  // sitemap/news) — never user-selectable. Seeded daily at creation, isActive=true,
  // enqueued by schedule-scraping and scraped via getScraper; the diff of its sorted
  // live-subdomain snapshot surfaces brand-new subdomains (expansion / pre-launch).
  "subdomains",
  // YouTube channel videos (official videos.xml RSS). Internal source (like
  // sitemap/news) — never user-selectable. Seeded weekly at creation; the scraper
  // resolves the competitor's channel from a homepage link and diffs its sorted
  // video list so a brand-new upload surfaces as a content signal.
  "youtube",
  // Review complaint-theme shifts. Infra-only anchor source (like tech_stack /
  // ai_visibility): never scraped, never user-selectable, excluded from gating —
  // it exists solely to anchor the snapshot → change → signal FK chain when a
  // recurring complaint theme inflects upward over the review_scores time-series.
  // Always isActive=false; the detect-review-theme-shifts job owns it.
  "review_shift",
  // Hiring velocity inflections (hiring-velocity feature). Infra-only anchor source
  // (like review_shift / tech_stack): never scraped, never user-selectable, excluded
  // from gating — it exists solely to anchor the snapshot → change → signal FK chain
  // when a department's open-role count inflects up over hiring_metrics. Always
  // isActive=false; the detect-hiring-velocity-shifts job owns it.
  "hiring_shift",
  // Hacker News mention + Show HN tracking. Internal source (like news/youtube) —
  // never user-selectable. Seeded weekly at creation, isActive=true, enqueued by
  // schedule-scraping and scraped via getScraper (HN Algolia by brand); the
  // scrape-monitor hackernews branch diffs objectID sets across snapshots and forces
  // the signal severity (Show HN → product/high, traction → content/medium).
  "hackernews",
  // Well-known / public domain fingerprint. Internal source (like sitemap/news) —
  // never user-selectable. Seeded weekly, isActive=true, scraped via getScraper
  // (/.well-known/* + /llms.txt at L0); the scrape-monitor wellknown branch diffs the
  // fingerprint to emit mobile-app-launch (product) / llms.txt (api_developer) signals.
  "wellknown",
  // Comparison-page anchor (sitemap v2). Internal, never seeded/scraped/user-
  // selectable — anchors the deterministic change→signal chain when the sitemap branch
  // finds a new competitor comparison page. Dedicated source_type so applySeverityGuard
  // can allow its deterministic critical. isActive=false; lazy-created by the branch.
  "comparison_page",
  // Developer documentation (user-selectable, pro+). Structured-first: an OpenAPI /
  // Swagger spec becomes a canonical sorted operation+schema listing (so the generic
  // lexical diff reads as a structural diff), else the docs sitemap's page list plus
  // capped per-page content hashes. Scraped via getScraper, diffed by the generic
  // path — no scrape-monitor branch. Kept in sync with shared SOURCE_TYPES.
  "docs",
  // Custom page (user-selectable via the dedicated "Watch a custom page" flow, not
  // the standard enable list). Watches an arbitrary page on the competitor's own
  // registrable domain via the generic snapshot → lexical diff → classify pipeline;
  // config = { url, label, hint }. Several customs coexist per competitor (quota'd
  // by PLAN_LIMITS.customMonitorsPerCompetitor, not the (competitor,sourceType)
  // uniqueness). Kept in sync with shared SOURCE_TYPES.
  "custom",
]);

export const frequencyEnum = pgEnum("frequency", ["realtime", "daily", "weekly"]);

export const monitors = pgTable("monitors", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  competitorId: text("competitor_id").notNull().references(() => competitors.id, { onDelete: "cascade" }),
  sourceType: sourceTypeEnum("source_type").notNull(),
  frequency: frequencyEnum("frequency").notNull().default("daily"),
  config: jsonb("config"),
  isActive: boolean("is_active").notNull().default(true),
  // Scraping cascade level this monitor needs: 0 (direct fetch) / 1 (browser
  // render) / 2 (browser render via datacenter egress). null = not yet learned →
  // start the cascade at L0. The former upper levels — L3 (IP-reputation proxy)
  // and L4 (anti-fingerprint browser) — were retired with the collection doctrine.
  requiresLevel: integer("requires_level"),
  // Egress IP chosen UPSTREAM (stability / geolocation), NEVER learned from a
  // block: "direct" (server IP) or "datacenter" (configured proxy). Reacting to a
  // block by switching IPs is circumvention, which the doctrine forbids — so this
  // is deliberate config, not learned cascade state.
  egressTier: text("egress_tier").notNull().default("direct"),
  // When a site explicitly refused us (block / challenge / robots Disallow) and we
  // stopped — distinct from a transient failure. Drives the honest "refused" UI and
  // is never overwritten by escalation (there is none).
  refusedAt: timestamp("refused_at"),
  refusalReason: text("refusal_reason"),
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
}, (t) => [
  // Hourly scheduler scan: isActive && (nextRunAt null || <= now). Partial on
  // is_active so the index only holds the rows the scheduler actually considers
  // (paused / tech_stack / inactive monitors are excluded), keeping it small and
  // the predicate index-only at scale.
  index("monitors_due_idx").on(t.nextRunAt).where(sql`is_active = true`),
  // Competitor detail / provisioning: all monitors of one competitor.
  index("monitors_competitor_idx").on(t.competitorId),
]);
