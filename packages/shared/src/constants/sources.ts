export const SOURCE_TYPES = [
  "homepage", "pricing", "blog", "changelog", "jobs",
  // App Store customer reviews via Apple's official public RSS JSON feed (Cas B
  // "propre" — competitor data, keyless, no scraping). The one review platform we
  // read directly. See appstore-reviews.scraper.ts.
  "appstore_reviews",
  // Shopify App Store merchant reviews (2026-08-04). The second review platform read
  // directly, and the first one that is a WEB PAGE rather than a feed: the listing
  // server-renders its reviews (no JS, no anti-bot), and `apps.shopify.com/robots.txt`
  // declares no `User-agent: *` group at all, so OutrivalBot is allowed by the same
  // isAllowed() every other L0 capture goes through. No exception to the collection
  // doctrine, and unlike G2/Capterra Shopify does not license this data as a product.
  // Score + total come from the page's own JSON-LD AggregateRating, never from the
  // mean of the recent sample. See shopify-reviews.scraper.ts.
  "shopify_reviews",
  // Trustpilot public SURFACE (Reviews v2, 2026-07-15): score, review count, star
  // distribution, trend via Trustpilot's OFFICIAL API (TRUSTPILOT_API_KEY) — never
  // third-party verbatims, never scraped (their ToS targets screen scrapers). The
  // useful "score of X slips 4.4 → 4.2" signal survives without the verbatims.
  "trustpilot_public",
  // RETIRED for legal reasons (Reviews v2, 2026-07-15 — "⚖️ Collection doctrine").
  // These review aggregators forbid scraping AND commercial use in their ToS, and
  // license their data as a product (G2 sells review syndication; Crayon/Klue pay
  // for it). Scraping them is unfair competition + a sui-generis DB right breach.
  // The enum values are KEPT (never dropped) so existing monitor rows stay valid and
  // are marked `marked_unscrapable` + refusal_reason='source_retired_legal' by the
  // migration rather than cascade-deleted (history preserved). No scraper, not in any
  // plan's allowedSources, not user-selectable. `g2_reviews` may return LATER via the
  // customer's own connected G2 vendor account (deferred, pending its ToS review) —
  // never via scraping. `trustpilot_reviews` is superseded by `trustpilot_public`.
  "g2_reviews", "capterra_reviews",
  "trustpilot_reviews", "trustradius_reviews", "gartner_reviews", "playstore_reviews",
  "linkedin", "twitter", "github_repo",
  // patch-18: infra-only anchor source for tech-stack signals. Never user-
  // selectable (excluded from plan gating, monitor creation routes, and the
  // competitor source tabs); kept in sync with the DB source_type enum so
  // monitor.sourceType stays assignable to SourceType across the pipeline.
  "tech_stack",
  // patch-31: competitor status page (Statuspage/Instatus JSON summary). Enabled
  // on demand (starter+) when platform detection found a statusPage. Kept in sync
  // with the DB source_type enum.
  "status",
  // patch-32: sitemap discovery anchor. Like tech_stack, an INTERNAL source — never
  // user-selectable (excluded from plan gating, the enable route, and the source
  // tabs). Seeded weekly at competitor creation; the scraper emits the sorted URL
  // list so the generic diff surfaces brand-new pages. Kept in sync with the DB
  // source_type enum.
  "sitemap",
  // News / funding (company-level events). Like sitemap, an INTERNAL source —
  // never user-selectable (excluded from plan gating, the enable route, and the
  // source tabs). Seeded weekly at creation; the scraper queries Google News RSS
  // by brand and emits a sorted snapshot → the generic diff surfaces new events
  // (classify tags funding/product/hiring). Kept in sync with the DB enum.
  "news",
  // AI Visibility / "Share of Model" (docs/ai-visibility.md). Like tech_stack, an
  // INTERNAL anchor source — never user-selectable (excluded from plan gating, the
  // enable route, and the source tabs). It only anchors the synthetic visibility
  // signal's snapshot→change chain; the capability is gated by features.aiVisibility,
  // and the data lives in ai_visibility_prompts/_results. Kept in sync with the DB enum.
  "ai_visibility",
  // Subdomains via Certificate Transparency (crt.sh). Like sitemap/news, an
  // INTERNAL source — never user-selectable (excluded from plan gating, the enable
  // route, and the source tabs). Seeded daily at creation; the scraper emits the
  // sorted list of LIVE subdomains → the generic diff surfaces a brand-new one
  // (beta./ai./{product}.) as an expansion / pre-announcement product signal.
  // Kept in sync with the DB source_type enum.
  "subdomains",
  // YouTube channel videos (official videos.xml RSS). Like sitemap/news, an
  // INTERNAL source — never user-selectable (excluded from plan gating, the enable
  // route, and the source tabs). Seeded weekly at creation; the scraper resolves the
  // channel from a homepage link and emits a sorted video list → the generic diff
  // surfaces a brand-new upload as a content signal. Kept in sync with the DB enum.
  "youtube",
  // Review complaint-theme shifts. Like tech_stack / ai_visibility, an INTERNAL
  // anchor source — never user-selectable (excluded from plan gating, the enable
  // route, and the source tabs). It only anchors the synthetic snapshot→change
  // chain when a recurring complaint theme inflects upward over the review_scores
  // time-series (detect-review-theme-shifts). Kept in sync with the DB enum.
  "review_shift",
  // Hiring velocity inflections (hiring-velocity feature). Like review_shift /
  // tech_stack, an INTERNAL anchor source — never user-selectable (excluded from
  // plan gating, the enable route, and the source tabs). It only anchors the
  // synthetic snapshot→change chain when a department's open-role count inflects up
  // over hiring_metrics (detect-hiring-velocity-shifts). Kept in sync with the DB enum.
  "hiring_shift",
  // Job-description facts (Hiring Intelligence v2 P1). Like hiring_shift, an
  // INTERNAL anchor source — never seeded, never scraped, never user-selectable. It
  // only anchors the synthetic snapshot → change chain for the two signals mined out
  // of job descriptions: a technology cited across ≥2 postings (corroborates the
  // tech-stack scraper) and an unannounced initiative described in one. Its own
  // anchor rather than hiring_shift's, whose snapshot chain owns the velocity
  // detector's dedup hash. Kept in sync with the DB enum.
  "job_facts",
  // Hiring footprint (Hiring Intelligence v2 P2). Like job_facts, an INTERNAL anchor
  // source — never seeded, never scraped, never user-selectable. It anchors the
  // chain for the three deterministic footprint signals: a country that has never
  // appeared in the competitor's hiring history, a department bucket that has never
  // appeared, and a board that has emptied out (a hiring freeze). Its own anchor
  // rather than hiring_shift's, whose snapshot chain owns the velocity detector's
  // dedup hash. Kept in sync with the DB enum.
  "hiring_footprint",
  // Salary bands (Hiring Intelligence v2 P3). Like hiring_footprint, an INTERNAL
  // anchor source — never seeded, never scraped, never user-selectable. It anchors
  // the chain for the two salary signals: a department's median pay moving ±15%
  // against its own trailing weeks (same currency only — nothing is ever converted),
  // and a competitor that has started publishing pay at all, which the EU pay
  // transparency directive is about to make a common event. Its own anchor rather
  // than hiring_shift's, whose snapshot chain owns the velocity detector's dedup
  // hash. Kept in sync with the DB enum.
  "hiring_salary",
  // Hacker News mention + Show HN tracking. Like sitemap/news/youtube, an INTERNAL
  // source — never user-selectable (excluded from plan gating, the enable route, and
  // the source tabs). Seeded weekly at creation; the scraper queries HN's public
  // Algolia search by brand, applies a strict anti-homonym guard (domain-in-url), and
  // the scrape-monitor hackernews branch diffs objectID sets to emit a Show HN launch
  // (product/high) or a traction mention (content/medium) with a forced severity.
  // Kept in sync with the DB source_type enum.
  "hackernews",
  // Well-known / public domain fingerprint. Like sitemap/news, an INTERNAL source —
  // never user-selectable. Seeded weekly at creation; the scraper GETs the root
  // domain's /.well-known/apple-app-site-association + /assetlinks.json (mobile-app
  // launch tells) + /llms.txt (AI/devtools positioning) at L0, filters identity-
  // provider bundles, and the scrape-monitor wellknown branch diffs the fingerprint
  // to emit a mobile-app-launch (product) or an llms.txt (api_developer) signal.
  "wellknown",
  // Comparison-page anchor (sitemap v2). INTERNAL, never seeded/scraped/user-
  // selectable — it exists solely to anchor the deterministic snapshot → change →
  // signal FK chain when the sitemap branch detects a new competitor comparison page
  // (/vs/, /alternatives/, *-alternative). A dedicated source_type (not "sitemap") so
  // applySeverityGuard can allow its deterministic "critical" (a competitor attacking
  // the user by name) without opening critical for AI-classified sitemap changes.
  "comparison_page",
  // Calculator-probe anchor (Pricing Intelligence P4). INTERNAL, never seeded /
  // scraped / user-selectable — it exists solely to anchor the snapshot → change →
  // signal chain when the cost a competitor's own pricing calculator quotes at a
  // fixed volume moves between two probes. Kept off the real `pricing` monitor so
  // probe snapshots never enter the chain its content-hash dedup diffs against.
  "pricing_probe",
  // Shipping-velocity anchor (Content Intelligence v2 P1). INTERNAL, never seeded /
  // scraped / user-selectable — it anchors the snapshot → change → signal chain when
  // a competitor's release cadence, counted off the content_items rows their
  // changelog feed writes, moves against its own trailing months. Kept off the real
  // `changelog` monitor so velocity snapshots never enter the chain its content-hash
  // dedup diffs against. Kept in sync with the DB source_type enum.
  "shipping_velocity",
  // Customer-proof anchor (Content Intelligence v2 P3). INTERNAL, never seeded /
  // scraped / user-selectable — it anchors the snapshot → change → signal chain for
  // the two customer signals: a case study a competitor just published, and a
  // customer name we have never seen them claim before. Kept off the `sitemap` and
  // `blog` monitors, whose snapshot chains carry their own dedup. Kept in sync with
  // the DB source_type enum.
  "customer_proof",
  // Editorial-shift anchor (Content Intelligence v2 P4). INTERNAL, never seeded /
  // scraped / user-selectable — it anchors the snapshot → change → signal chain
  // when the mix of subjects a competitor's blog covers over 90 days diverges from
  // the 90 before it. Kept off the `blog` monitor, whose snapshot chain carries its
  // own dedup and whose changes already belong to the lexical classifier. Kept in
  // sync with the DB source_type enum.
  "editorial_shift",
  // Roadmap-shift anchor (Content Intelligence v2 P5). INTERNAL, never seeded /
  // scraped / user-selectable — it anchors the snapshot → change → signal chain for
  // `top_request_planned` (one of the portal's most-voted requests moved into
  // planned / in progress) when the roadmap capture produced no change row of its
  // own to carry it. Kept off the `roadmap` monitor, whose snapshot chain carries
  // its own dedup. Kept in sync with the DB source_type enum.
  "roadmap_shift",
  // Integration-catalog anchor (Content Intelligence v2 P5). INTERNAL, never seeded
  // / scraped / user-selectable — it anchors the change → signal chain for
  // `integration_published`, the names a competitor's /integrations catalog lists
  // that we had never seen it claim. Kept off the `sitemap` monitor, whose snapshot
  // chain carries its own dedup. Kept in sync with the DB source_type enum.
  "integration_catalog",
  // Audience-page anchor (Positioning Intelligence v2 P3). INTERNAL, never seeded /
  // scraped / user-selectable — it anchors the change → signal chain for
  // `new_persona_page`, the persona (/for/…), industry (/industries/…) and use-case
  // (/use-cases/…, /solutions/…) pages a competitor publishes that we had never seen.
  // Kept off the `sitemap` monitor, whose snapshot chain carries its own dedup and
  // whose change row already belongs to the lexical classifier. Kept in sync with the
  // DB source_type enum.
  "audience_page",
  // Developer documentation — the competitor's technical roadmap surface. USER-
  // SELECTABLE (pro+), enabled through the standard enable route with an optional
  // URL override. Structured-first, two modes: (1) an OpenAPI/Swagger spec is found
  // → the snapshot is the canonical sorted operation + schema listing, so the
  // generic lexical diff IS a structural diff (endpoint added/removed, field newly
  // deprecated) with zero AI; (2) no spec → the docs sitemap's page list (a new page
  // = a newly documented feature) plus a capped per-page content hash. No
  // scrape-monitor branch: it rides the generic snapshot → diff → classify chain.
  // Kept in sync with the DB source_type enum.
  "docs",
  // Custom page. User-selectable, but via a DEDICATED flow ("Watch a custom page")
  // — NOT the standard enable list (rejected on POST /:id/monitors). Watches ANY
  // page on the competitor's own registrable domain (/about, ToS, /security,
  // /enterprise, a docs page) through the full snapshot → lexical diff → classify →
  // signal pipeline. config = { url, label, hint }; the hint (legal|team|product|
  // security|docs|other) grounds classify. Per-competitor quota
  // (PLAN_LIMITS.customMonitorsPerCompetitor), NOT the single (competitor,sourceType)
  // uniqueness — several customs coexist per competitor. Kept in sync with the DB enum.
  "custom",
  // Public roadmap / feedback portal — what the competitor has committed to build,
  // and which requests their own customers are voting up. USER-SELECTABLE (pro+),
  // enabled through the standard enable route with an optional URL override (the
  // portal lives off-domain, so `roadmap` gets a brand exception in
  // validateMonitorUrl, like `jobs` does for ATS hosts).
  //
  // Two vendor adapters, both pure L0 fetch and zero AI: (1) Canny — the board /
  // roadmap page server-renders a `window.__data` state island carrying every post's
  // id, title, status and vote score, plus `boards.*.settings.access` which says
  // outright whether the board is public; (2) ProductBoard — the portal page itself
  // is an empty SPA shell, but its own frontend reads one unauthenticated endpoint
  // (`/api/portal/all` with an `x-portal-path` header) returning the cards, their
  // vote counts, and the tabs that ARE the statuses.
  //
  // The snapshot is a listing sorted by STABLE ENTRY ID (never by votes or status),
  // so a status move produces exactly one -/+ line pair in place. Vote counts are
  // written as a BAND (see voteBand) rather than a raw number: raw counts drift every
  // week on every row, which would diff the whole list; a band only moves on a real
  // surge. No scrape-monitor branch — it rides the generic snapshot → diff → classify
  // chain. Kept in sync with the DB source_type enum.
  "roadmap",
  // Page-variance anchor (Véracité Intelligence v2 P2). Like pricing_probe, an
  // INTERNAL anchor source — never seeded, never scraped, never user-selectable. It
  // anchors the chain for `ab_test_suspected`: a page that served a delta and then
  // its exact inverse twice inside fourteen days is a competitor running a test, not
  // a competitor changing its mind. Kept in sync with the DB source_type enum.
  "page_variance",
] as const;

export type SourceType = typeof SOURCE_TYPES[number];

const CONDITIONAL_FETCH_SOURCES: readonly SourceType[] = ["blog", "changelog"];

/**
 * Server-rendered sources where an HTTP 304 reliably means "unchanged".
 * Excludes SPAs (homepage/pricing — stable initial HTML hides client-side
 * changes), protected review sources, and jobs (ATS pages are often SPAs and a
 * false 304 would hide job-closure detection).
 */
export function supportsConditionalFetch(sourceType: SourceType): boolean {
  return CONDITIONAL_FETCH_SOURCES.includes(sourceType);
}

export const MONITOR_FREQUENCIES = ["realtime", "daily", "weekly"] as const;
export type MonitorFrequency = typeof MONITOR_FREQUENCIES[number];

/**
 * Fastest → slowest, matching MONITOR_FREQUENCIES' own order. `realtime` is hourly,
 * not instant — see computeNextRun, where it is a 1h base interval capped at 12h.
 */
const FREQUENCY_RANK: Record<MonitorFrequency, number> = { realtime: 0, daily: 1, weekly: 2 };

/**
 * Whether `freq` runs no more often than `ceiling` — the comparison a per-source
 * cadence cap needs. Frequencies are an ordered scale, not a set, so a cap has to be
 * expressed as "at most this fast" rather than an allow-list that drifts whenever the
 * enum gains a value.
 */
export function frequencyWithin(freq: MonitorFrequency, ceiling: MonitorFrequency): boolean {
  return FREQUENCY_RANK[freq] >= FREQUENCY_RANK[ceiling];
}

export const SIGNAL_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type SignalSeverity = typeof SIGNAL_SEVERITIES[number];

export const SIGNAL_CATEGORIES = [
  "pricing", "product", "hiring", "reviews", "content", "funding",
  // Developer / AI-agent surface (sitemap v2 / wellknown card). Set ONLY
  // deterministically (an llms.txt manifest appearing on a competitor's domain) —
  // the AI classifier is never asked to emit it (kept out of the classify prompt),
  // so it never perturbs the model-chosen categories.
  "api_developer",
  // Taxonomy wave 2 (materiality). These five ARE model-chosen (unlike
  // api_developer): they carve company-level moves out of the "content" bucket,
  // where a partnership, an acquisition, a CISO hire and a SOC 2 badge all used to
  // land indistinguishably. They are detected on sources we ALREADY scrape
  // (blog / news / changelog) — no new source. Each carries a deterministic
  // severity floor, see packages/ai/src/tasks/materiality.ts.
  "partnerships",       // an alliance, integration or reseller/OEM deal
  "ma",                 // merger, acquisition, divestiture (severity floor: critical)
  "leadership",         // exec hires/departures/board changes
  "security_compliance",// SOC 2 / ISO / HIPAA / GDPR posture, breach disclosures
  "ads",                // paid-acquisition posture: campaigns, landing pages, offers
] as const;
export type SignalCategory = typeof SIGNAL_CATEGORIES[number];
