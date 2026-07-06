# Scraper audit — 2026-07-06

Full audit of every scraper in the project: inventory, per-axis findings
(speed, resources, algorithmic complexity, robustness, cost, maintainability),
and a comparison against the mid-2026 state of the art. Static code audit —
no production metrics were pulled (the read-only queries against
`scrape_runs` / `extraction_runs` / `ai_runs` are ready and can be run on
explicit approval to back latency/failure numbers with real data).

**Overall verdict: the architecture is sound.** The decoupled cascade
(escalation on block signals only, never on timeout), the staged extraction
pipeline, `requiresLevel` learning, and the two-lane queues are well designed
and — on two points — ahead of the publicly documented state of the art. The
problems are not structural: **two critical correctness bugs** (both verified
by direct code reading), a handful of high-leverage cost/RAM wastes, and a
testability debt on the hot path.

---

## 1. Inventory

### 1.1 Architecture

```
cron Trigger.dev (4 dispatchers + 4 standalone schedules)
        │
        ▼
schedule-scraping (hourly) ──batchTrigger──▶ scrape-monitor (queue "scrape-monitor" | "scrape-monitor-slow")
        │                                            │
        │                                            ▼
        │                              getScraper(sourceType) ─▶ packages/scrapers/src/*
        │                                            │
        │                              scrapePage() = L0→L4 cascade (lib/scrape-page.ts)
        │                                            │
        └── on-demand API routes ──tasks.trigger("scrape-monitor",{force:true})──┘
```

`@outrival/scrapers` registers one scraper per `SourceType`
(`packages/scrapers/src/index.ts:24-42`); each returns a uniform
`ScrapeOutcome` (`html`, `text`, `screenshotBuffer`, `metadata`, `level`,
`attempts`) that `scrape-monitor.job.ts` turns into
snapshot → diff → change → classify → signal.

### 1.2 Monitor-driven sources

| Source | File(s) | Target | Method | Cascade? | Default freq | Trigger path |
|---|---|---|---|---|---|---|
| homepage | `homepage/homepage.scraper.ts` | competitor homepage | browser, **floor L1** (screenshot for pHash), progressive scroll | yes | daily / weekly (self) | hourly cron + on-demand |
| pricing | `pricing/pricing.scraper.ts` (+ `discover-url.ts`) | pricing page (auto-discovered) | browser + billing-toggle capture | yes | daily / weekly | idem |
| blog | `blog/blog.scraper.ts` | `/blog`, `/changelog`, `/news`, … | **L0 fetch only, never escalates** | no | weekly | auto-seeded on creation |
| changelog | `changelog/changelog.scraper.ts` | `/changelog` page or RSS/Atom feed | L0 fetch + native feed fetch | no | weekly | auto-seeded by platform-detect only (never user-selectable) |
| jobs | `jobs/jobs.scraper.ts` + `ats.ts` + `careers-link.ts` | careers page / ATS board | **ATS API** when `platformProfile.ats` known; else L0 path probing + **floor L1** render (`JOBS_RENDER_ENABLED`) | partial | daily / weekly | opt-in starter+ |
| g2 / capterra / trustpilot / trustradius | `g2-reviews/`, `capterra-reviews/`, `reviews/extra-platforms.scraper.ts` | review product pages | browser, **floor L2** | yes | weekly | opt-in pro+ |
| gartner_reviews | `reviews/extra-platforms.scraper.ts:31` | Gartner Peer Insights | browser, **floor L3 residential** | yes | weekly | opt-in business |
| playstore_reviews | idem `:33` | Play Store | browser, floor L1 | yes | weekly | opt-in business |
| appstore_reviews | `appstore-reviews/appstore-reviews.scraper.ts` | Apple iTunes RSS JSON | **third-party API**, level 0 | no | weekly | opt-in business |
| reddit | `reddit/` | brand mentions | **OAuth API** (`oauth.reddit.com`, app-only) | no | weekly | opt-in pro+, global kill-switch off |
| github_repo | `github/github.scraper.ts` | repo description + release + commits | **GitHub REST API** ×3 | no | weekly | self-product only |
| status | `status/status.scraper.ts` | Statuspage/Instatus JSON | fetch, level 0 | no | weekly | auto-seeded by platform-detect, starter+ |
| sitemap | `sitemap/sitemap.scraper.ts` + `parse.ts` | `sitemap.xml` via robots.txt | XML fetch walk, level 0 | no | weekly | seeded on `POST /competitors` only |
| news | `news/news.scraper.ts` | Google News RSS per brand | feed fetch, level 0 | no | weekly | auto-seeded on all 3 creation paths |
| tech_stack | `tech-stack/` + `scrape-tech-stack.job.ts` | headers + script srcs + `/integrations` | native fetch + cheerio | no | monthly (own cron) | `cron-daily` → `schedule-tech-stack` |
| ai_visibility | `scrape-ai-visibility.job.ts` | AI-engine answers (Gemini/Perplexity) | LLM queries, no HTTP scraping | no | 7 days (own cron) | `cron-daily` → `schedule-ai-visibility` |
| linkedin / twitter | — | — | declared in `SOURCE_TYPES`, **not implemented** | — | — | — |

> `tech_stack` and `ai_visibility` only get an inactive "anchor" monitor for
> the `changes`/`signals` FK chain — they never go through `schedule-scraping`
> or `getScraper`.

### 1.3 Support components (no monitor)

| Component | File(s) | Method | Trigger |
|---|---|---|---|
| Wayback backfill | `backfill/wayback.ts`, `backfill-history.job.ts` | plain fetch, ~1 req/s throttle | first capture of a `BACKFILL_SOURCES` monitor |
| Discovery (Exa) | `discovery/discover.ts` | `exa-js` SDK + liveness pings | weekly cron + `POST /candidates/detect` |
| Platform detection | `platform/` (+ `lib/platform-detect.ts`) | step A native fetch + DNS; step B Patchright (tier `direct`) | on creation, 30-day cadence, ATS drift |
| SPA api-capture | `spa/api-capture.ts` | Patchright, listens to XHR/fetch JSON | `apiCaptureEnabled` monitors, spa_empty recovery, platform step B |
| Alternatives | `alternatives/generate.ts` | light path probing | on the unscrapable transition |

### 1.4 Cascade (L0-L4)

| Level | Impl | Cost | Escalates on |
|---|---|---|---|
| L0 | `scrape-direct.ts` — native fetch | free | `blocked_403/503`, `cloudflare_challenge` → proxies; `needs_render` → L1. Other `http_error` = fail-fast |
| L1 | `scrape-patchright.ts` — stealth Chromium, no proxy | compute only | `ESCALATING_FAILURES` |
| L2 | Patchright + ProxyScrape datacenter | flat monthly | idem |
| L3 | Patchright + ProxyScrape residential | pay-per-GB | idem |
| L4 | `scrape-camoufox.ts` — Camoufox + residential | last resort, 60s timeout | none — final `fail()` |

Entry level = `max(requiresLevel ?? 0, (screenshot || render) ? 1 : 0)`.
`requiresLevel` is persisted only when ≥ 2, re-probed from L0 every 14 days.
Review scrapers pin their own floors (G2/Capterra/Trustpilot/TrustRadius L2,
Gartner L3, Play Store L1).

### 1.5 Crons, queues, machines

- **Dispatchers** (10-schedule cap → 8/10 used): `cron-6h` (`0 */6 * * *`) →
  signal-batching, ops-health-check · `cron-daily` (`0 4 * * *`) →
  platform-detection, purge-retention, tech-stack, silent-monitors,
  ai-visibility · `cron-weekly-mon` (`0 6 * * 1`) → structural-changes,
  sectoral, feedback-patterns · `cron-weekly-sun` (`0 3 * * 0`) →
  relevance-recalc, detect-new-competitors.
- **Standalone**: `schedule-scraping` (`0 * * * *`), `ai-capacity-check`
  (`*/30`), daily/weekly digests.
- **Queues**: `scrape-monitor` (concurrency 5) / `scrape-monitor-slow` (2,
  `requiresLevel >= 3` routed at enqueue) / `groq-ai` (1) / `backfill` (2).
  No `concurrencyKey` anywhere (deliberate — avoids per-key proxy bursts).
- **Machines**: only `scrape-monitor` and `detect-platform` run `medium-1x`
  (2 GB, Chromium), `generate-battle-card` `small-2x`. Everything else is the
  0.5 GB default. Global `maxDuration` 300s, retries ×3 factor 2 (backfill
  `maxAttempts: 1`, correct — non-idempotent inserts).

### 1.6 Inventory oddities

- `POST /candidates/:id/add` seeds homepage/pricing/blog/news but **not
  `sitemap`**, unlike `POST /competitors` — inconsistency.
- `GITHUB_TOKEN` is read by `github.scraper.ts:40` but documented nowhere
  (`.env.example`, `docs/architecture.md`).
- `.claude/rules/jobs.md` mandates per-domain `concurrencyKey`; the code
  deliberately rejects it (`scrape-queues.ts:14-17`). The rule is stale.

---

## 2. Findings

Severity = impact × probability. Effort S/M/L.

### 2.1 Critical (both verified by direct reading)

**C1 — An empty jobs extraction closes ALL postings → false signal**
`apps/workers/src/jobs/extract-jobs.job.ts:141-171`
`closedIds` = every active posting absent from `seenKeys`; when `jobs = []`
every posting gets `isActive:false` + `closedAt`, and the change path fires
(`jobs.length > 0 || closedIds.length > 0`). `jobs` can be `[]` without any
real closure: ATS API timeout (8s) → careers-page fallback renders an SPA
placeholder, or the AI floor returns `{jobs:[]}` — and the `plausible` gate
is **not applied to the AI fallback** (`staged-extract.ts:41-42`), so `[]`
passes the Zod schema. Failure scenario: one Lever hiccup → 40 postings
marked closed → `job_counts=0` → classify sees "massive hiring freeze" →
false signal to the user, hiring chart craters, then the inverse false signal
on the next scrape. **Effort M.** Fix: never mass-close on
`jobs.length === 0` without positive page evidence (`atsJobs !== null` OR a
valid-page threshold), and treat an empty AI-floor result as a no-op for the
jobs source.

**C2 — A transient outage kills a monitor permanently, no auto re-arm**
`apps/workers/src/jobs/scrape-monitor.job.ts:1268-1271` +
`schedule-scraping.job.ts:126`
At 3 consecutive failures (`UNSCRAPABLE_FAILURE_THRESHOLD`), `onFailure` sets
`markedUnscrapable:true` **and `isActive:false`**. The scheduler filters
`isActive = true` → the monitor is never enqueued again. The failure-backoff
`nextRunAt` (6h/12h/24h/72h) the comment sells as "self-healing re-probe" is
dead the moment `isActive` flips. The only un-mark paths are manual
(`monitor-alternatives.ts` resume/set-url/accept). Worse:
`detect-silent-monitors.job.ts:61` **excludes** `markedUnscrapable`, so a dead
monitor doesn't even show up in the silence sweep. Failure scenario: a
competitor's site is down ~42h → monitor silently disabled → site comes back
→ never scraped again. **Effort M.** Fix: a daily re-probe that flips
`isActive:true` once for `markedUnscrapable` monitors with
`lastFailedAt > N days`, or decouple "scheduler pause" from permanent death.

### 2.2 Medium — highest leverage first

| # | Finding | Location | Effort | Gain |
|---|---|---|---|---|
| M1 | `BLOCKED_RESOURCE_TYPES` = media+font only → images+stylesheets downloaded through **residential pay-per-GB** on data scrapes (jobs/pricing/reviews pass `blockResources:true` but still load all images) | `scrape-patchright.ts:61` | **S** | −30-70% proxy bandwidth, ~€5-15/mo |
| M2 | Browsers are never `close()`d — only contexts are. A full L1→L4 escalation keeps 3 Chromium + 1 Firefox resident until machine teardown; on a warm reused machine they leak across runs. **Blocking for the pg-boss migration** (long-lived worker processes) | `scrape-patchright.ts:66-74` | **S** | −400-800 MB peak on escalated scrapes |
| M3 | `source_summary` (70b) fires on **every** content-hash change with no materiality gate — review pages churn constantly | `extract-pricing.job.ts:148`, `extract-jobs.job.ts:193`, `extract-reviews.job.ts:150` | M | −1 AI call on most re-scrapes; AI-quota pressure + €5-20/mo |
| M4 | `block-detection` covers Cloudflare only — blind to Akamai ("Access Denied", "Reference #"), DataDome (`captcha-delivery.com`), PerimeterX (`px-captcha`), Imperva ("Pardon our interruption"), Kasada, hCaptcha. A 200 challenge page is accepted as content → rotten snapshot, diff/AI on garbage | `block-detection.ts:17-36` | **S** | fewer poisoned baselines / false diffs |
| M5 | App Store: `!res.ok` swallowed (`break`, no throw) → empty JSON stored as `"success"` baseline (`scrape-monitor` hardcodes `status:"success"` and never reads `result.statusCode`) → phantom "N new reviews" next run | `appstore-reviews.scraper.ts:31-53` | **S** | anti-false-signal |
| M6 | tech-stack: a 200 challenge page passes the `!home` guard → `detectTechStack` sees nothing → the whole active stack is marked disappeared (history churn) | `scrape-tech-stack.job.ts:60-113` | **S** | anti-churn |
| M7 | github: 3 sequential fetches with **no timeout / no AbortSignal**; 403 rate-limit (60/h unauthenticated) throws generic → hard failure → feeds C2. `GITHUB_TOKEN` undocumented | `github.scraper.ts:45-54` | **S** | avoids maxDuration hangs |
| M8 | api-capture uses `waitUntil:"networkidle"` + fixed 2000ms — the exact anti-pattern `nav-strategy.ts:3-11` bans (never reached on SPAs with polling → burns the 15s timeout **every run** on the monitors this path is meant to rescue) | `spa/api-capture.ts:70-71` | **S** | −up to 13s when triggered; stops re-kill of recovered SPAs |
| M9 | fullPage screenshot rendered+encoded on every homepage scrape, discarded on no-change (hash dedup at `scrape-monitor.job.ts:556`); a stable realtime homepage pays ~60 renders/mo for nothing | `homepage.scraper.ts:18` | S/M | −30% homepage compute; `HOMEPAGE_SCREENSHOT_ENABLED` kill-switch already exists |
| M10 | Fixed waits: 2 scroll passes (up to 22.5s cap each) + `waitForTimeout(2000)` + double `settleAfterNav` (2500ms each, systematically burned on pages with analytics/chat) ≈ **9-10s dead time per homepage scrape**, ~19s pricing | `scrape-patchright.ts:234-271` | M | −4-6s/homepage scrape |
| M11 | Careers probing: up to **12 sequential L0 probes** (`CAREERS_PATHS`) before fallback, then 1-3 sequential renders. Cheap and parallelizable | `jobs.scraper.ts:136`, `crawler.ts:137` | M | −5-15s/jobs scrape |
| M12 | sitemap: BFS truncation at 5000 URLs is order/timing-dependent → different 5000 across runs → phantom diffs; SmartRecruiters `limit=100` without pagination → false "postings removed" past 100 | `sitemap/parse.ts:99-129`, `ats.ts:291` | M | anti-false structural signals |
| M13 | ATS: `fetchAtsJobs` returns `null` for both "API failed" and "board legitimately empty" → the real →0 transition never takes the clean structured path (feeds C1) | `ats.ts:474-484` | M | correctness of the hiring feed |
| M14 | sitemap walk: up to 50 × 10s sequential fetches = 500s potential > `maxDuration` 300s → killed → false failure; multiple roots each re-walked | `sitemap.scraper.ts:93-97`, `parse.ts:106` | M | −10-60s + no false kills |

### 2.3 Low (selection)

- `Buffer.from(await page.screenshot())` copies an already-returned Buffer
  (5-30 MB PNG ×2 transient) and the buffer stays live through diff/DB/upload
  — `scrape-patchright.ts:209-211` (S, −20-40 MB/homepage scrape). Consider
  clipping height (~4000px): the 9×8 dHash doesn't need the full page.
- Same homepage HTML parsed 2-3× by cheerio (`extractContent` +
  `parseHomepageStructure` + `extractJsonLd` reloads raw HTML) —
  `scrape-monitor.job.ts:524,670`, `homepage-structure.ts:647` (M).
- **TEMP DEBUG block shipped in the pricing hot path** — regex + object build
  + log on every extraction — `extract-pricing.job.ts:51-66` (S, delete).
- Potential AI loop: `refresh-competitor-summary` re-fires on every homepage
  scrape while `category` stays null, unbounded —
  `scrape-monitor.job.ts:410-416` (S, add cooldown/attempt cap).
- `job_counts` double-inserted on retry (insert before the crash point,
  append-only) — `extract-jobs.job.ts:178-185` (S).
- Unguarded `getFromR2` on the diff path fails a scrape whose snapshot is
  already uploaded+inserted → wasted retry + feeds `consecutiveFailures` —
  `scrape-monitor.job.ts:598,1022` (S).
- Tech-stack upserts in a sequential per-tech loop —
  `scrape-tech-stack.job.ts:117-140` (S, batch values).
- ~5 sequential DB queries per homepage change, two reading overlapping
  windows of `snapshots` (S/M, merge + `Promise.all`).
- `diffSections` is O(n²·tokens) with re-tokenization per pair (bounded at
  60×60) — `homepage-diff.ts:156-191` (S, precompute token sets).
- Exa `search()` has no explicit timeout — `discovery/discover.ts:215` (S).
- Sliding 30-day news window → articles aging out diff as "removed" (low,
  internal source).
- `parser_extractors.consecutiveFailures` is incremented but never consumed
  (no purge threshold) — `staged-extract.ts:122-125` (cosmetic).

### 2.4 Confirmed-good (do not touch)

- Escalation on block signals only; timeouts left to Trigger retries (no
  proxy budget burned on network flukes).
- `batchTrigger` in all schedulers; two bounded lanes instead of
  `concurrencyKey` explosion; `conditionalFetch` 304 pre-flight (fail-open);
  structured homepage diff reads the previous structure from jsonb (no
  re-parse); Wayback deliberately throttled (do **not** parallelize);
  discovery liveness pings already `Promise.all`.
- Anti-false-positive chain (collapse guard, anti-void median, relevance
  score, volatile-line learning, `isIncompleteRender`) is solid and layered.
- Best-effort swallows are correctly isolated (analytics logging, pHash,
  alternatives, drift redetect — each try/catch without masking the business
  error). Structured-data mappers genuinely never throw.
- Staged extraction (structured-first → cached parser → AI self-heal with
  12h cooldown → AI floor) — see §3, SOTA-confirmed.
- No Crawlee remnants; thin source wrappers (blog 18 lines, homepage 24) are
  justified config carriers.

### 2.5 Cost model

Cost drivers, in order:

1. **Trigger.dev runs** — 1 run on no-change, 2-4 runs per change
   (scrape-monitor → extract-* → classify → generate-signal). Realtime
   cadence floors at 12h via `computeNextRun` staleness backoff; a pro org
   (15 competitors × 2 browser sources realtime) ≈ 1 800-3 000 scrape
   runs/mo. At ~50 active orgs this crosses the Hobby 50k-runs cap → Pro
   €100/mo. **The in-flight pg-boss migration neutralizes this entire cost
   axis** — but makes M2 (browser leak) mandatory first.
2. **Residential GB (L3/L4)** — bounded to monitors that learned
   `requiresLevel ≥ 3` (Gartner floor + hard-blocked homepages), but inflated
   by M1 (images/CSS not blocked).
3. **AI quota** — €-cheap while Cerebras free tier (1M tok/day) holds, but
   the systematic `source_summary` calls (M3) and reviews' 2×70b per change
   are what trip the 80/90% capacity alerts.
4. R2 ≈ €1/mo, Exa pay-per-search, Gemini free tier — all fine.

Per-source: homepage (forced L1 render + screenshot) and pricing (2 full
renders: home + pricing page) dominate compute; reviews dominate AI; the
seven L0/API sources (blog, changelog, sitemap, news, status, appstore,
github, reddit) are near-free. `scrape-monitor` runs `medium-1x` even for
pure-L0 sources (structural over-allocation, marginal € impact today).

### 2.6 Maintainability

- **`scrape-monitor.job.ts` = 1293-line god function, zero tests** — and
  `apps/workers` has zero `.test.ts` overall (all 44 test files live in
  `packages/scrapers`). The ~270-line homepage-enrichment block
  (`:748-1020`) should move to `lib/homepage-enrichments.ts` to become
  testable.
- **Adding a source costs ~12-15 touch points** (shared `SOURCE_TYPES` + DB
  enum + migration + scraper file + `getScraper` map + routing switch
  `scrape-monitor.job.ts:1119-1154` + plan gating + `isReviewSource` +
  `CONDITIONAL_FETCH_SOURCES` + web labels/components + API routes). A
  per-source registry (`{ scraper, extractJob, gating, label }`) pays for
  itself at the first Phase-9 source (LinkedIn/Twitter).
- **Duplication**: `g2-reviews` and `capterra-reviews` are near-identical
  files while `extra-platforms.scraper.ts` already ships the
  `reviewScraper(source, minLevel)` factory that generalizes them; 4 copies
  of `escapeHtml` (changelog/sitemap/github/status scrapers); 4
  near-identical fetch-with-timeout helpers.
- Hardcoded grow-by-observation lists (careers paths/keywords, pricing paths,
  skip-hosts, 25-entry tech catalog, hand-maintained Wappalyzer dataset) —
  acceptable by design but need periodic recalibration; magic numbers
  inconsistently env-ified (`CLAIM_VARIATION_THRESHOLD` hardcoded while its
  patch-17 siblings are env vars).
- Scrapers with zero tests: homepage, blog, changelog, g2, capterra,
  appstore, extra-platforms, github.

---

## 3. State of the art (mid-2026)

Web research verified against primary sources (npm registry, GitHub, official
pricing pages) on 2026-07-06.

| Stack element | Verdict | Notes |
|---|---|---|
| 5-level cascade (escalate on block signal) | **Still current** | mirrors Crawlee's AdaptivePlaywrightCrawler philosophy; 2026 practitioner consensus |
| Patchright (L1-L3) | **Still current** | v1.61.1 (2026-06-23), lock-step with Playwright, near-weekly cadence; strong Cloudflare results in independent benchmarks |
| Camoufox (L4) | **Current, watch** | creator stepped down 2026-01-10 after a 10-month release gap; taken over by Clover Labs, active again (v152 alpha 2026-07-06). Document a fallback plan |
| L0 native fetch | **Identified gap** | JA3/JA4 + HTTP/2 fingerprinting flags a non-impersonated client before any JS challenge. Cheapest fix: a TLS-impersonation rung (`got-scraping` 4.2.1 or Apify `impit` 0.14.2 — both Node-native, verified) between L0 and L1 |
| cheerio | Still current | no credible TS-native challenger |
| Structured-first (JSON-LD/OG) | Still current | validated by the 2026 "per-page AI tax" cost argument (Kadoa) |
| Cached CSS-selector parsers + AI self-heal (patch-30) | **SOTA-confirmed** | near-identical to the pattern Browserbase/Stagehand documents as its competitive edge (Feb 2026). Optional hardening: validate cached selectors with a light structural fingerprint (Stagehand-style) to catch silent drift, not just hard failure |
| Structured diff + relevance_score | **Ahead of public SOTA** | changedetection.io (v0.55.7) only does LLM-judge filtering, no feedback-learned threshold; no public embeddings-based relevance pattern found |
| pHash visual pre-filter | Still current | recommended practice (pHash prefilter, pixel-diff only on flagged pages) |
| AI pool (Cerebras→Groq→Hyperbolic) | **Optimizable** | Cerebras **paid** tier is more expensive than Groq for gpt-oss-120b ($0.35/$0.75 vs $0.15/$0.60 per M) — its priority-1 slot is justified by the free tier only. Gemini 2.5 Flash ($0.30/$2.50) / Flash-Lite (~$0.10/$0.40) are pool candidates; the key already exists (AI Visibility) |
| Not using Crawlee | **Decision validated** | Crawlee (v3.17.0, no v4) still broken on Bun (open issue since 2025-04) |
| curl-impersonate / rebrowser-patches | Dead / stalled | last pushes 2024-07 and 2025-05 — avoid if ever evaluated |

Landscape notes:
- **Cloudflare** taxonomy (Search/Agent/Training) rolls out to all plans; from
  **2026-09-15** new domains default-block Training+Agent on ad-monetized
  pages. Competitive intelligence is classified under a separate "Data
  Collection" bucket (outside the AI taxonomy), but standard Bot Management
  (JA4, behavioral scoring) stays fully active — verify our traffic doesn't
  get misclassified as "Agent".
- Residential proxy market 2026: $1.75-6/GB (Bright Data $2.50-4, Oxylabs
  $2.50-6, ProxyScrape ~$3.55, IPRoyal from $1.75) — current ProxyScrape setup
  is at the low end.
- `Bun.WebView` (Bun 1.3.12, 2026-04) — native headless automation with
  `isTrusted:true` inputs; too young for stealth prod, watch.
- Raw-CDP automation (nodriver-style, zero blocks in the cited benchmark) is
  the emerging frontier for the hardest targets, but remains Python-only —
  watch, not actionable in Node/TS yet.

---

## 4. Prioritized remediation plan

### P0 — Correctness (before anything else)

1. **C1** — anti-mass-close guard in `extract-jobs` (require positive page
   evidence; empty AI-floor result = no-op). Effort M.
2. **C2** — auto re-arm of `markedUnscrapable` monitors (daily re-probe or
   decouple scheduler-pause from permanent death; include them in
   `detect-silent-monitors`). Effort M.

### P1 — Quick wins (all S, ~1 day total)

3. **M1** — add `image` (+`stylesheet`) to `BLOCKED_RESOURCE_TYPES` for
   non-screenshot scrapes → immediate residential savings.
4. **M2** — close the previous tier's browser on escalation (+ teardown
   `finally`) → **prerequisite for pg-boss long-lived workers**.
5. **M4** — extend `CHALLENGE_MARKERS` to Akamai/DataDome/PerimeterX/Imperva/
   Kasada/hCaptcha.
6. **M5** — throw on App Store `!res.ok` (align with reddit/news/status).
7. **M7** — `AbortSignal.timeout(8000)` on github + handle 403 rate-limit as
   retriable skip + document `GITHUB_TOKEN`.
8. **M8** — `domcontentloaded` + `settleAfterNav` in api-capture.
9. **M6** — challenge guard before the tech-stack diff.
10. Remove the TEMP DEBUG block in `extract-pricing.job.ts:51-66`; cooldown on
    `refresh-competitor-summary`; drop the `Buffer.from` screenshot copy;
    guard the R2 read on the diff path; unify g2/capterra via `reviewScraper`;
    factor `escapeHtml` / `fetchWithTimeout`.

### P2 — Waste & latency (M)

11. **M3** — gate `source_summary` on material change of the extracted
    structured data.
12. **M9/M10** — conditional homepage screenshot; 1 scroll pass, lazy wait
    2000→1000, drop the post-scroll settle.
13. **M11** — parallelize careers probes (and pricing `DIRECT_PATHS` HEADs).
14. **M12/M13/M14** — deterministic sitemap truncation + bounded-parallel
    walk + single root; SmartRecruiters pagination; ATS `[]` vs `null`.
15. Single cheerio parse per homepage scrape; merge/parallelize the
    per-change DB queries; batch tech-stack upserts.

### P3 — Structural (L, plan separately)

16. Extract homepage enrichments from `scrape-monitor` into a testable lib +
    first worker tests on the hot path.
17. Per-source registry (before LinkedIn/Twitter).
18. Evaluate an HTTP-impersonation rung "L0.5" (`got-scraping` / `impit`).
19. Add Gemini Flash/Flash-Lite to the AI provider pool.
20. Watch list: Camoufox maintenance cadence (3-6 months), Cloudflare
    2026-09-15 taxonomy, embeddings pre-filter before classify-change
    (differentiation opportunity — nobody does embeddings+LLM-judge pairing
    publicly), structural-fingerprint validation for cached extractors.

---

*Method: 5 parallel audit passes (inventory, performance/resources,
robustness, cost/maintainability, web SOTA research with primary-source
verification), findings cross-deduplicated; both critical findings verified
by direct code reading. No code was modified.*
