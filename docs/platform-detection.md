# Patch-31 — Platform auto-detection

Detect, for every competitor, the platforms a site runs **and extract their
identifiers**, persist a cached **platform profile**, and use it to route each
source to a structured connector. This is the "front door" that maximises the
patch-30 *structured-first* path: the more we know a site runs Greenhouse / a
Stripe pricing table / a Statuspage / an RSS changelog, the more often we skip
the browser **and** the LLM. Detection is **pure pattern-matching — zero AI**.

> Roadmap item: Notion "Patch — Détection auto de plateforme" (🎯 Roadmap, High).
> Builds on patch-18 (tech-stack catalog), patch-23 (SPA runtime API capture +
> failure diagnosis), patch-30 (staged extraction).

---

## 1. What already exists (reuse, do NOT rebuild)

The repo already implements most of the primitives the Notion brief describes.
The patch is mostly **unification + routing + persistence**, not green-field.

| Brief item | Existing code | Reuse decision |
|---|---|---|
| ATS detect + token extract + public API | `packages/scrapers/src/jobs/ats.ts` — Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee, Workable. `detectAtsBoard()` returns `{provider, token, boardUrl}`, `fetchAtsJobs()` hits the public API. | **Reuse as-is.** Feed its result into the profile; keep `jobs.scraper.ts` working. |
| Generic fingerprint base (headers/scripts/DOM/footer) | `packages/scrapers/src/tech-stack/{catalog,detector}.ts` (patch-18). `detectTechStack()` matches a hand-curated 25-entry catalog. | **Keep for the tech-stack veille feature.** The new engine (Wappalyzer dataset) is broader; the two coexist (see §3.3). |
| Runtime network capture (step B) | `packages/scrapers/src/spa/{api-capture,filter}.ts` (patch-23). `scrapeWithApiCapture()` observes XHR/fetch JSON; `filterRelevantApiCalls()` keeps content calls. Wired in `scrape-monitor` via `monitor.apiCaptureEnabled`, triggered on the `spa_empty` unscrapable transition. | **Reuse the capture; add a detection-time trigger** (today it's failure-triggered only). |
| Structured-first + parser cache + self-heal | patch-30: `structured-data/`, `cached-extractor.ts`, `staged-extract.ts`, `parser_extractors`. | **The routing target.** A detected platform picks/biases the structured path. |
| Per-competitor scrape cadence anchor | `competitors.techStackScrapedAt` + `schedule-tech-stack.job.ts`. | **Mirror the pattern** for re-detection cadence. |

**Hard constraint:** every line we add must trace to "profile, routing, or the
new business signatures (status/changelog/pricing-widget/CMS) + the Wappalyzer
engine." We do not touch the scraping cascade, the diff pipeline, or patch-30's
floor behaviour.

---

## 2. The platform profile

### 2.1 Type (`packages/shared/src/platform/profile.ts`)

```ts
export type PlatformConfidence = "high" | "medium" | "low";

export interface PlatformField<T> {
  value: T;
  confidence: PlatformConfidence;
  /** which signal(s) proved it: "header:server=vercel", "script:js.stripe.com", "cname:*.statuspage.io" */
  evidence: string[];
}

export interface PlatformProfile {
  framework?: PlatformField<string>;          // next, nuxt, remix, sveltekit…
  cms?: PlatformField<string>;                // webflow, wordpress, framer, ghost…
  hosting?: PlatformField<string>;            // vercel, netlify…
  cdn?: PlatformField<string>;                // cloudflare, fastly, cloudfront…
  /** "<provider>:<token>", e.g. "greenhouse:airbnb" — the routing key for jobs */
  ats?: PlatformField<string>;
  /** "stripe" | "paddle" | "chargebee" — the pricing widget, NOT the payment processor */
  pricingWidget?: PlatformField<string>;
  /** "statuspage:<page_id>" | "instatus:<slug>" — routes to the JSON status endpoint */
  statusPage?: PlatformField<string>;
  /** "canny" | "headway" | "beamer" | "rss:<feed_url>" — routes the changelog source */
  changelog?: PlatformField<string>;
  analytics?: PlatformField<string>[];        // posthog, segment, ga…
  detectedAt: string;                         // ISO — last full detection
  /** schema version so a future shape change can re-detect old profiles */
  v: number;
}
```

`PlatformProfileSchema` (zod) lives next to it; the worker validates before
persisting (same discipline as `ExtractorSpecSchema` in patch-30).

### 2.2 Storage — `competitors.platform_profile jsonb` (decision: column, not table)

```ts
// packages/db/src/schema/competitors.ts  (+1 column)
platformProfile: jsonb("platform_profile").$type<PlatformProfile>(),
```

- 1:1 with the competitor, read on **every scrape** alongside the competitor row
  (no extra query), nullable (null = never detected → due immediately, mirrors
  `techStackScrapedAt`).
- `db:push` only (additive, nullable) — no migration risk. Same as patch-18's
  `techStackScrapedAt`.
- Re-detection cadence reads `platformProfile.detectedAt` (no extra column).

---

## 3. Detection engine (`packages/scrapers/src/platform/`)

Pure, cheerio/regex/DNS only, **AI-free**, exposed as `@outrival/scrapers/platform`.
Same dep posture as `tech-stack/` and `jobs/ats.ts`.

```
platform/
  wappalyzer/
    technologies.json      # vendored from enthec/webappanalyzer (see §3.1)
    categories.json
    engine.ts              # pure matcher over the dataset (the only new "framework" code)
  signatures.ts            # Outrival business signatures + ID extraction (§3.2)
  dns.ts                   # CNAME lookup (node:dns), behind a flag (§3.4)
  detect.ts                # detectPlatform(input) → PlatformProfile  (the orchestrator)
  index.ts
  __tests__/
```

### 3.1 Wappalyzer dataset (the "don't reinvent" base)

Vendor the fingerprint dataset from the community fork **`enthec/webappanalyzer`**
(~250+ technologies). We do **not** add a runtime npm dependency on a Wappalyzer
package — we copy `technologies/*.json` + `categories.json` into the package and
write a **minimal matcher** (`engine.ts`, ~120 lines) covering the field types we
actually use:

- `headers` (name → value regex), `cookies`, `html` (regex), `scriptSrc`,
  `meta`, `js` (global var presence — from the rendered page only), `dns`
  (CNAME), `implies` (transitive techs), `cats` (category mapping).
- Confidence parsing: Wappalyzer's `\\;confidence:50` / `\\;version:\\1` suffixes
  → map to our `high|medium|low`.

> **Risk / action:** confirm the fork's licence before vendoring (Wappalyzer's
> own data was MIT pre-2023; the fork must be MIT/CC-permissive to embed). If the
> licence is copyleft, fall back to extending the hand-curated `tech-stack`
> catalog for the generic layer and ship only the business signatures (§3.2).
> **This is the one true blocker — resolve it first.**

A `pnpm --filter @outrival/scrapers wappalyzer:sync` script (one-shot, committed
output) refreshes the vendored JSON; we never fetch it at runtime.

### 3.2 Business signatures + ID extraction (the high-value part)

`signatures.ts` — what Wappalyzer doesn't give us: **the identifier**, so we can
hit the API directly. Each signature returns `{ field, value, confidence, evidence }`.

- **ATS** → delegate to `detectAtsBoard()` (already done). Maps to
  `ats: "greenhouse:airbnb"`.
- **Stripe pricing table** → `<stripe-pricing-table …>` custom element or
  `js.stripe.com/v3/pricing-table.js` → `pricingWidget: "stripe"` (+ capture
  `pricing-table-id` / `publishable-key` attrs as evidence for the connector).
- **Statuspage** → `cdn.statuspage.io` script, `*.statuspage.io` CNAME, or a
  probe of `/api/v2/summary.json` returning a `page` object → `statusPage:
  "statuspage:<page_id>"`. Also Instatus (`*.instatus.com`).
- **Changelog** → Canny (`canny.io` widget), Headway (`headway.js`), Beamer
  (`beamer.js`), or `<link rel="alternate" type="application/rss+xml">` →
  `changelog: "headway" | "rss:<href>"`.
- **CMS** → Webflow (`.w-` classes, `wf-` meta), WordPress (`/wp-content/`),
  Framer (`framer.com` scripts), Ghost (`ghost` meta) → mostly covered by the
  Wappalyzer set; keep a thin override here for the ones we care to route on.

### 3.3 Relationship to patch-18 tech-stack

They stay **separate** with one shared input shape:

- patch-18 `tech-stack` → **veille** of third-party tools a competitor *adopts*
  (Salesforce appearing = a strategic signal). Monthly job, emits signals,
  persists `tech_stack_entries`. **Untouched.**
- patch-31 `platform` → **routing** of *our* scrapers. Detected on competitor
  add + on connector failure, persists `competitors.platform_profile`. Emits no
  signal by itself.

Both consume `{ url, html, responseHeaders, scriptUrls }`. We extract a shared
`TechEvidenceInput` builder so the scraper assembles it once. (Optional cleanup,
not required for correctness.)

### 3.4 The 6 signals (step A) + DNS

`detectPlatform(input)` matches all signals on **already-fetched** evidence:

1. HTTP headers (`Server`, `X-Powered-By`, `Set-Cookie`)
2. HTML (meta, comments, DOM classes/structure)
3. Script paths / URLs (`/_next/`, `/wp-content/`, vendor CDNs)
4. Cookie names
5. JS globals (`__NEXT_DATA__`, `__NUXT__`) — from rendered HTML only
6. **CNAME DNS** (`node:dns/promises`, `dns.ts`, behind `PLATFORM_DNS_ENABLED`,
   8 s timeout, best-effort) — the one new I/O. Used mainly for hosted status
   pages where the page itself hides the provider.

CDN-masking guard: never depend on a single signal. `Server`/`X-Powered-By` are
stripped by Cloudflare/Fastly → cross-reference cookies + JS globals + scripts.
Each field carries `evidence[]` of every signal that matched.

---

## 4. Detection pipeline (cheap → expensive)

```
detectPlatformForCompetitor(competitorId)   // packages/workers/src/lib/platform-detect.ts
  ├─ fetch homepage once (native fetch + cheerio — reuse tech-stack's fetch, NOT the cascade)
  ├─ STEP A — detectPlatform({headers, html, scriptUrls}) + optional CNAME
  │     → most sites resolve here
  ├─ STEP B — only if A is inconclusive AND the page is a near-empty SPA:
  │     reuse scrapeWithApiCapture(url) (patch-23) → inspect runtime requests/globals
  │     → recoups the API-capture work already paid for
  ├─ merge → PlatformProfile (per-field confidence)
  ├─ persist competitors.platform_profile + log platform_detection_runs (CH, best-effort)
  └─ NEVER throws — detection is an optimisation, never a blocker
```

`platform_detect` is a **library function**, not a job, called from:

- `detect-platform.job.ts` (new) — batch, scheduled (§6).
- competitor-add path (`candidates.ts` / `POST /api/competitors`) — fire-and-forget.
- `scrape-monitor` `onFailure` — re-detect on the connector-failure trigger (§6).

---

## 5. Routing (profile → connector)

The profile **biases** existing routing; the patch-30 floor still guarantees a
result. No source is ever blocked.

| Source | Today | With profile |
|---|---|---|
| `jobs` | `jobs.scraper.ts` calls `detectAtsBoard(html)` every scrape | Read `profile.ats` first → build the board + `fetchAtsJobs()` **without** rendering the careers page. Fall back to today's inline detect if absent. |
| `pricing` | `analyzePricingHtml` + staged-extract (JSON-LD → cache → heal → AI) | `profile.pricingWidget="stripe"` biases staged-extract toward the widget/structured path; widget content still needs render (step B) → noted, not free. |
| `changelog` | scrape the page, lexical diff | `profile.changelog="rss:<href>"` → fetch + parse the feed (pure XML, no browser). `headway/canny/beamer` → their public JSON where available. |
| `status` (new) | — | `profile.statusPage="statuspage:<id>"` → `GET /api/v2/summary.json` → structured incident/component state. |

**Routing seam:** pass the (already-loaded) `competitor.platformProfile` into the
scraper via `ScrapeOptions.platformProfile?` and into the extract jobs via their
payload. The scrapers stay pure; the worker owns the read.

### 5.1 Status as a monitored source — scope flag

Routing `status` end-to-end means a **new `source_type` enum value** (`status`),
which per project memory must resync `SOURCE_TYPES` in `@outrival/shared`, plan
gating, provisioning, and the Sources UI. That is a self-contained sub-feature.
**Phase it (Phase 4) so the core ships without it** — detection still populates
`profile.statusPage`; the connector + monitor source land behind that phase.

---

## 6. Cache + re-detection (self-heal)

Two triggers, mirroring patch-30's heal discipline:

- **Periodic** — `detect-platform.job.ts` (cron, daily) enqueues competitors due:
  `platform_profile IS NULL` OR `detectedAt < now - PLATFORM_REDETECT_INTERVAL_DAYS`
  (default 30), `url` non-null, `type != "self"`, not deleted. Mirrors
  `schedule-tech-stack`.
- **On connector failure** — when a structured connector that the profile
  promised starts failing (e.g. ATS API 404 after a Greenhouse→Lever migration),
  re-detect for that competitor. Hook into `scrape-monitor`'s existing failure
  path (`diagnoseAndPersistFailure` / `onFailure`) with a cooldown so a durably
  broken page doesn't re-detect every run (reuse the `EXTRACTOR_HEAL_COOLDOWN`
  pattern).

---

## 7. Schema & observability

```sql
-- Postgres (db:push, additive)
competitors  + platform_profile jsonb           -- §2.2

-- ClickHouse (ch:setup, best-effort ops metric)
platform_detection_runs
  competitor_id, domain,
  stage (a_static | b_browser),
  framework, cms, ats, pricing_widget, status_page, changelog,   -- detected? (string|'')
  techs_found UInt16, duration_ms, recorded_at
```

`platform_detection_runs` is the arbiter of "how often did detection succeed at
step A vs need a browser, and what did we route" — surfaced in `/admin/scraping`
next to patch-30's `extraction_runs`.

---

## 8. Env vars (`.env.example` + architecture.md)

```bash
PLATFORM_DETECTION_ENABLED=true          # kill-switch → routing falls back to today's behaviour exactly
PLATFORM_REDETECT_INTERVAL_DAYS=30       # periodic re-detection cadence
PLATFORM_DNS_ENABLED=true                # CNAME lookups (node:dns); false → skip signal 6
PLATFORM_DETECT_TIMEOUT_MS=8000          # per-fetch / per-DNS budget
PLATFORM_STEP_B_ENABLED=true             # allow the browser-capture fallback in detection
```

`PLATFORM_DETECTION_ENABLED=false` ⇒ no profile written, scrapers ignore the
column, routing = exactly today (the floor, same philosophy as
`STAGED_EXTRACTION_ENABLED`).

---

## 9. Package layout (dep-rules)

| Concern | Package | Why |
|---|---|---|
| `PlatformProfile` type + zod | `@outrival/shared` | shared by web/api/workers |
| detection engine, signatures, DNS, dataset | `@outrival/scrapers` (`/platform`) | pure, AI-free, cheerio/regex/dns |
| status/changelog connectors | `@outrival/scrapers` | pure fetch/XML |
| `platform_profile` column | `@outrival/db` | schema only |
| orchestration (when/persist/route), CH log | `@outrival/workers` | I/O + DB + triggers |
| profile read on scrape | `scrape-monitor` worker | already loads the competitor |

No new AI calls anywhere — detection is pattern-matching, so nothing lands in
`@outrival/ai`.

---

## 10. Implementation phases (each independently shippable + verifiable)

> **Status (2026-06-05):** Phase 0 ✅ (GPL-3.0 → house dataset) · Phase 1 ✅ · Phase 2 ✅
> (`db:push` applied) · Phase 3 ✅ (jobs ATS-direct; changelog/pricing deferred) ·
> Phase 5 ✅ · Phase 4 backend ✅ (enum/SOURCE_TYPES/gating starter+/connector/getScraper)
> — **remaining: prod enum `db:push` for `status` + the web Sources UI.** All packages
> typecheck; scrapers suite green. `ch:setup` (platform_detection_runs) still to run.

**Phase 0 — Licence gate.** Confirm `enthec/webappanalyzer` licence permits
vendoring. → verify: licence file quoted in the PR; if blocked, switch the
generic layer to the hand-curated catalog (rest of the plan unchanged).

**Phase 1 — Detection core (no behaviour change).**
`@outrival/scrapers/platform`: engine + signatures + `detectPlatform()`.
→ verify: unit tests — Greenhouse token extracted from a fixture, Stripe pricing
table detected, Statuspage `page_id` extracted, CDN-masked site still detects
framework via cookies/scripts, empty input → empty profile. `bun test src/platform`.

**Phase 2 — Profile persistence + periodic detection.**
`platform_profile` column (db:push), `platform-detect` lib, `detect-platform.job.ts`
(cron) + competitor-add hook, `platform_detection_runs` CH table.
→ verify: typecheck; add a competitor → row gets a profile; manual job run logs
to ClickHouse; re-run within 30 d is a no-op (cadence honoured).

**Phase 3 — Routing of existing sources (jobs / changelog / pricing bias).**
Thread `platformProfile` through `ScrapeOptions` + extract payloads; jobs uses
`profile.ats` to skip the careers render; changelog routes RSS; pricing biases
staged-extract.
→ verify: a competitor with `ats` set hits the API with **0** careers-page
renders (assert via `scrape_runs` level / logs); `extraction_runs` shows more
`structured`/`cache` resolutions; flag off ⇒ byte-identical to today.

**Phase 4 — Status source (optional, gated).** New `status` source_type
(resync `SOURCE_TYPES`, plan gating, provisioning, Sources UI) + statuspage JSON
connector.
→ verify: enabling status on a competitor with a detected `statusPage` pulls
`/api/v2/summary.json` into the normal snapshot→diff→classify pipeline.

**Phase 5 — Connector-failure re-detection.** Hook re-detect into the
`scrape-monitor` failure path with cooldown.
→ verify: simulate an ATS 404 → profile re-detected once, not every run.

---

## 11. Tests

- `platform/__tests__/detect.test.ts` — fixtures per provider (Greenhouse, Lever,
  Ashby, Stripe pricing table, Statuspage, Canny/Headway/RSS, Webflow, WordPress,
  Next.js), CDN-masking case, empty/garbage input.
- `engine.test.ts` — Wappalyzer field matching (headers/scripts/html/cookies/js),
  `implies` transitivity, confidence parsing.
- Routing: a unit test that `jobs.scraper` with a profile builds the board
  without calling `scrapePage`.
- Floor guarantee: `PLATFORM_DETECTION_ENABLED=false` ⇒ scrape-monitor output
  unchanged on a golden fixture.

---

## 12. Open risks / divergences from the brief

1. **Licence (Phase 0)** — the only hard blocker; everything else degrades to the
   hand-curated catalog.
2. **Stripe pricing table isn't free to extract** — the widget renders its prices
   client-side, so `pricingWidget="stripe"` is a *signal* that biases toward step
   B / the rendered structured path, not a zero-cost API like the ATS case. The
   brief implies "pricingWidget → structured parser"; in practice it still needs a
   render. Called out so we don't over-promise.
3. **`status` as a new source** touches plans/enum/UI (memory: source_type changes
   must resync `SOURCE_TYPES`) — phased (Phase 4) so the core isn't held hostage.
4. **patch-23 = two things** — the brief says "réutiliser la capture réseau du
   patch-23"; in code patch-23 is both the SPA API capture (`spa/`) *and* the
   structural/diagnose-failure work. We reuse `scrapeWithApiCapture` for step B;
   no new capture code needed.
5. **No double-detection cost** — detection fetches the homepage once; on
   competitor-add it should reuse the first homepage snapshot's HTML if one already
   exists rather than re-fetching.
