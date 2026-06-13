# Optimization audit — Outrival (2026-06-13)

Cross-domain optimization audit: cost (AI/scrape/infra), perceived web
performance, AI pipeline quality, scrape/API robustness. Each finding pairs a
**best-practice** (with a real source) against **what Outrival actually does**,
then a recommendation rated by **ROI** and **risk/effort**.

Method: web research on 2025/2026 best practices per domain (vendor docs,
web.dev, engineering blogs, papers), then a code read of the real hot paths
(`packages/scrapers/src/lib`, `packages/ai/src`, `apps/workers` scrape job,
`apps/web`, `apps/api`, `packages/db`).

Legend — ROI: 🟢 high · 🟡 medium · ⚪ low. Risk/effort: ✅ low · ⚠️ medium · 🛑 high.

---

## Executive summary

Outrival is already well-optimized on the structurally expensive paths:
conditional `304` pre-flight before scraping, a learned per-monitor cascade
level with re-probe, content-hash dedup, the staged extraction pipeline
(structured-first → parser cache → self-heal → AI floor), best-effort analytics,
an AI provider pool with circuit breakers, and grounding/self-check for
hallucinations. The audit is therefore about **closing specific leaks**, not
re-architecting.

Highest-leverage gaps found:

1. **AI model routing is dead** — every task runs on the provider's single
   (70B-class) model, including the cheap classify/overlap tasks designed for an
   8B model. This is the biggest recurring cost leak. → **F1**
2. **Browser scrapes load every resource and always take a full-page
   screenshot**, even for non-visual sources (pricing/jobs/reviews) where the
   screenshot is never used — wasted residential GB (pay-per-GB) + Trigger
   machine CPU. → **F4 / F5**
3. **Prompt caching is left on the table** — Groq/Cerebras cache common prefixes
   automatically and for free, but prompts concatenate static+variable into one
   user message, so the cacheable prefix is short. → **F2**
4. **No client code-splitting** — `recharts` (heavy) is imported statically; no
   `next/dynamic` anywhere. → **F7**

---

## Domain 1 — AI pipeline (cost + quality)

### F1 — Model routing collapsed: everything runs on the 70B model 🟢 / ⚠️

**Best practice.** Route each request by difficulty: cheap model for routine
tasks, expensive model only for hard ones. Model routing alone typically saves
**40–70%** of LLM spend, because 60–80% of requests are routine.
([GMI Cloud](https://www.gmicloud.ai/en/blog/llm-inference-cost-optimization-caching-batching-routing),
[Morph](https://www.morphllm.com/llm-cost-optimization))

**What we do.** `AI_CONFIG` still declares the split — `classificationFast`
(`llama-3.1-8b-instant`) vs `classification`/`insights`/`digest` (70B). But
`packages/ai/src/provider.ts::dispatch()` routes every `provider="groq"` call
through `callLLM(options)`, which **ignores `config.model`** and always uses
`provider.model` (one model per pool provider). The code comment is explicit:
"the per-task 8b/70b split collapses into each provider's single model."

So `classify-change` (runs on **every** detected change), `score-overlap` (every
discovery candidate), and the significance filter — all designed for the cheap
8B — execute on the 70B. On Groq, `8b-instant` is ~10× cheaper and markedly
faster than `70b-versatile`; these are the highest-volume calls in the pipeline.

**Recommendation.** Re-introduce a tier signal end-to-end: let each pool provider
declare an optional `AI_PROVIDER_N_FAST_MODEL`, pass the task tier
(`fast`|`smart`) from `dispatch` into `callLLM`, and pick `fastModel ?? model`.
No behavior change when a provider has no fast model (degrades to today). Both
Groq and Cerebras expose an 8B-class model on the same endpoint.
**→ implemented below.**

### F2 — Prompt caching unused (free on Groq/Cerebras) 🟡 / ✅

**Best practice.** Prefix caching cuts prefill cost dramatically (Anthropic ~90%,
OpenAI 50% automatic). **Groq and Cerebras cache common prefixes automatically,
with zero setup and no extra fee** — you benefit when requests share a common
prefix. Structure prompts static-first, variable-last.
([Groq prompt caching](https://console.groq.com/docs/prompt-caching),
[Cerebras prompt caching](https://inference-docs.cerebras.ai/capabilities/prompt-caching),
[Introl](https://introl.com/blog/prompt-caching-infrastructure-llm-cost-latency-reduction-guide-2025))

**What we do.** `callLLM` sends `messages: [{ role: "user", content: prompt }]` —
a single message where each prompt builder concatenates instructions + JSON
schema + few-shot + the variable payload. If the static block isn't strictly the
prefix, the shared prefix across calls is short and auto-caching barely fires.
The Claude fallback uses no `cache_control` either.

**Caveat sourced.** Do **not** add `prompt_cache_key` — it's rejected by Groq's
and Cerebras' OpenAI-compatible endpoints.
([zed#36215](https://github.com/zed-industries/zed/issues/36215))

**Recommendation.** Audit prompt builders so the static part (role, rules,
schema, examples) is the literal prefix and only the payload varies at the tail.
Move per-task system text into a `system` message kept byte-identical across
calls. For the Claude fallback, mark the static system block with
`cache_control: { type: "ephemeral" }`. Low risk, mechanical, recurring savings
on the hottest tasks. (Doc-level here; safe to land incrementally per prompt.)

### F3 — JSON output token overhead ⚪ / (info)

**Best practice.** JSON can use ~2× the tokens of TSV/TOON for tabular data;
TOON claims ~40% fewer tokens but is immature (late-2025).
([Gilbertson](https://david-gilbertson.medium.com/llm-output-formats-why-json-costs-more-than-tsv-ebaf590bd541),
[TokenMix](https://tokenmix.ai/blog/structured-output-json-guide))

**What we do.** Zod-validated JSON everywhere — correct: structured output drops
parse-failure from 8–15% to <0.1%
([letsdatascience](https://letsdatascience.com/blog/structured-outputs-making-llms-return-reliable-json)).
**Keep it.** Output volumes are small (a classification, a few plans); reliability
> token savings. Noted only so it isn't "fixed" later.

### AI — already good

Provider pool free→paid with per-provider + global circuit breakers, token-quota
tracking in Redis, bounded in-call failover (`provider.ts`), grounding +
self-check for hallucinations (patch-24), `ai_runs` logging. These match the
2025 guidance on routing/resilience and on
[hallucination mitigation](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2025.1622292/full).

---

## Domain 2 — Scraping (cost + robustness)

### F4 — Browser scrapes load every resource (residential is pay-per-GB) 🟢 / ⚠️

**Best practice.** Block images/fonts/media/stylesheets you don't need. Measured
impact: **1.9 MB → 8.7 KB bandwidth (−99.5%) and −87% load time** by blocking
images/CSS/fonts/media.
([ScrapeHero](https://www.scrapehero.com/block-specific-resources-in-playwright/),
[ScrapingBee](https://www.scrapingbee.com/blog/playwright-web-scraping/))

**What we do.** `scrapeWithPatchright`/`capturePage` (`scrape-patchright.ts`)
never route/abort requests — every image, font, video and stylesheet downloads
on L1–L4. **L3/L4 use residential ProxyScrape billed per GB**, so this is a
direct line-item cost, plus slower scrapes = more Trigger machine-seconds.

**Risk to respect.** Aggressive blocking (especially CSS/images) can itself be an
anti-bot signal, and CSS/images affect the homepage screenshot used for the
pHash visual-redesign detector (patch-17) — blocking fonts/images there would
produce false `visual_redesign`. So scope it: always-safe to block **media**
(video/audio) and, on non-screenshot scrapes, **fonts**; keep images/CSS on the
homepage screenshot path.

**Recommendation.** Add an opt-in `blockResources` to the Patchright path
(`media`+`font` baseline), enabled for data sources (pricing/jobs/reviews/
changelog/blog) and disabled where the screenshot is needed. **→ implemented
below (conservative subset).**

### F5 — Full-page screenshot taken on every browser scrape 🟡 / ✅

**What we do.** `capturePage` always calls `page.screenshot({ fullPage: true })`.
Only the **homepage** scraper consumes the screenshot (pHash, patch-17). For
pricing/jobs/reviews/changelog/blog the PNG is captured, buffered, and discarded
— pure CPU on the Trigger machine and it forces a full visual render (pulling all
images). The `fullPage` option exists but the screenshot itself is unconditional.

**Recommendation.** Make the screenshot opt-in (`options.screenshot`, default
off; homepage opts in). Pairs with F4: no screenshot ⇒ also safe to block
images. **→ implemented below.**

### F6 — `waitUntil: "networkidle"` is fragile and slow 🟡 / ✅

**Best practice.** `networkidle` is discouraged for scraping — it waits for 500ms
of network silence, which never arrives on sites with analytics/polling/ads, so
it burns the full timeout. Prefer `domcontentloaded` + an explicit
`waitForSelector` for the content you need.
([ScraperAPI](https://www.scraperapi.com/web-scraping/playwright/),
[ScrapingBee](https://www.scrapingbee.com/blog/playwright-web-scraping/))

**What we do.** `page.goto(url, { waitUntil: "networkidle", timeout: 30000 })`.
Our own memory already notes "Playwright capture hangs on networkidle for
analytics sites." Every such hang spends up to 30s of machine time before failing.

**Recommendation.** Switch to `domcontentloaded` and rely on the existing
`waitForSelector`/`progressiveScroll` (homepage) for late content; keep a shorter
explicit settle wait. Medium risk (could miss lazy content on some sources), so
validate per source before flipping globally — not auto-applied here.

**Implemented.** `packages/scrapers/src/lib/nav-strategy.ts` (`navWaitUntil` +
bounded `settleAfterNav`), wired into `scrapeWithPatchright` (L1–L3) and
`scrapeWithCamoufox` (L4) via the shared `capturePage`. Default is
`domcontentloaded` + a bounded `networkidle` settle capped at `SCRAPE_SETTLE_MS`
(2.5 s) — it captures late content when a page settles quickly but can never hang.
The settle runs only after the 403/503 guards, so a hard block never pays the wait.
Kill-switch `SCRAPE_WAIT_NETWORKIDLE=true` restores the legacy behavior exactly.
**`api-capture.ts` (patch-23 SPA capture) deliberately keeps `networkidle`** — its
whole job is to observe runtime XHR/fetch, so it needs to wait for network
activity. Covered by `nav-strategy.test.ts`.

### Scrape — already good

Conditional `304` pre-flight before any browser (`conditional-fetch.ts`, wired in
`scrape-monitor.job.ts:379`) — exactly the
[ETag/If-None-Match](https://webscraping.ai/faq/http/how-can-http-conditional-requests-be-leveraged-in-web-scraping-to-save-bandwidth)
cost lever (≈30% savings). Learned per-monitor cascade level + 14-day re-probe,
content-hash dedup, R2-before-DB, staged extraction (AI off the hot path). The
decoupled fingerprint/IP cascade is the right model.

---

## Domain 3 — Web / perceived performance

### F7 — No client code-splitting; `recharts` imported statically 🟡 / ✅

**Best practice.** Lazy-load non-critical / heavy components (charts, modals,
PDF, settings) with dynamic `import()` / `next/dynamic`. Server Components for
the rest; routes with First-Load JS > 150 KB have room, > 300 KB have an import
problem.
([Next.js 16](https://nextjs.org/blog/next-16),
[dev.to](https://dev.to/hamzakhan/reducing-javascript-bundle-size-with-code-splitting-in-2025-3927))

**What we do.** Zero `next/dynamic` in `apps/web`. `recharts@3.8.1` (heavy,
client-only) is imported directly by the chart pages (Trends/Overview/sector),
landing on the first-load bundle of those routes.

**Recommendation.** `next/dynamic(() => import(...), { ssr: false, loading })`
for the recharts wrappers and any other heavy client widget (calendar, PDF
preview). Confined to a few files, no behavior change. Quick win.

### F8 — Next 16 PPR / `cacheComponents` not enabled 🟢 / 🛑

**Best practice.** Partial Prerendering streams a static shell instantly and
fills dynamic islands via Suspense — "instant" pages with live content. Next 16's
Cache Components (`use cache` + PPR) is the modern model.
([Next.js 16](https://nextjs.org/blog/next-16),
[PPR explainer](https://medium.com/@sureshdotariya/unlocking-the-future-of-web-performance-partial-prerendering-in-next-js-f3dc0b16bf34))

**What we do.** `next.config.ts` enables neither. The dashboard mixes a static
shell (sidebar/topbar) with dynamic data — a textbook PPR fit.

**Recommendation.** High potential LCP/INP win but invasive (boundaries, cache
semantics, Next 16 still stabilizing). Pilot on 1–2 routes (overview) behind the
flag, measure, then expand. **Not** a quick win — tracked, not applied.

### Web — already good

Server-Components-by-default policy (CLAUDE.md), Turbopack default in 16, the
existing design-token discipline. Target CWV: LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1
([web.dev via Makers' Den](https://makersden.io/blog/optimize-web-vitals-in-nextjs-2025))
— worth wiring Speed Insights to confirm real numbers before deeper work.

---

## Domain 4 — API / DB / realtime (robustness + cost)

### F9 — SSE notifications poll the DB every 3s per connection 🟡 / ⚠️

**Best practice.** SSE scales on a single HTTP connection, but a per-connection DB
poll is O(connections). For real fan-out, push via Postgres `LISTEN/NOTIFY` or
Redis pub/sub instead of polling, and use sticky sessions / stateless broadcast
behind a load balancer.
([Medium SSE 2025](https://medium.com/@ShantKhayalian/server-sent-events-sse-vs-websockets-vs-long-polling-whats-best-in-2025-1cfb036cbf94),
[SurveySparrow Eng](https://engineering.surveysparrow.com/scaling-real-time-applications-with-server-sent-events-sse-abd91f70a5c9))

**What we do.** `notifications.ts` SSE does `stream.sleep(3000)` + one query per
loop per connection. At ~1000 connections that's ~333 queries/s purely for
notification polling. Acceptable today (architecture says SSE/poll is fine to
~1000 conns); a scaling ceiling, already acknowledged.

**Recommendation.** Move to `LISTEN/NOTIFY` (one listener fans out in-process)
when connection count grows. Architectural, not a quick win — tracked.

### F10 — `postgres-js` prepared statements on the pooled endpoint ⚠️ / investigate

**Best practice.** Transaction-mode poolers historically break session-level
prepared statements; PgBouncer ≥ 1.21 supports protocol-level prepared statements
with `max_prepared_statements` configured, otherwise disable them client-side.
([Crunchy Data](https://www.crunchydata.com/blog/prepared-statements-in-transaction-mode-for-pgbouncer),
[pganalyze](https://pganalyze.com/blog/5mins-postgres-pgbouncer-prepared-statements-transaction-mode))

**What we do.** `packages/db/src/client.ts` uses `postgres-js` with `max: 10` and
**no `prepare` setting** (defaults to prepared statements). Architecture mandates
the Neon **pooled** endpoint (`-pooler`). Depending on the pooler mode this can
either silently work (Neon supports protocol-level prepared statements) or throw
"prepared statement already exists / does not exist" under connection churn, and
Neon docs warn the pooled URL breaks prepared statements for some workloads
([Neon/Drizzle](https://orm.drizzle.team/docs/connect-neon),
[Seedfast](https://seedfa.st/blog/seed-neon-database)).

**Recommendation.** Confirm whether `DATABASE_URL` is the pooled endpoint; if so,
load-test and consider `postgres(url, { prepare: false })` for the API/worker
client (or the Neon serverless driver). Do **not** flip blindly — if it works
today, disabling prepare can cost performance. Investigate + measure.

### F11 — Read-only analytics GETs have no `Cache-Control` ⚪ / ✅

**Best practice.** HTTP caching headers on read endpoints cut server load and
latency; Hono ships caching middleware/utilities.
([Hono caching](https://app.studyraid.com/en/read/11303/352726/caching-strategies-in-hono),
[Hono best practices](https://hono.dev/docs/guides/best-practices))

**What we do.** Almost no `Cache-Control` (only battle-cards/onboarding set it).
Overview/trends/sector analytics recompute on every request, and each hit can
wake a scaled-to-zero Neon branch (~500ms cold penalty
[Encore](https://encore.dev/articles/neon-serverless-postgres)).

**Recommendation.** Add `Cache-Control: private, max-age=30–60` (or a short
in-process TTL cache) on the heavy read-only analytics GETs. Low risk; trims Neon
wake-ups and repeat compute. Candidate quick win (per-route, after checking
freshness expectations).

### API/DB — already good

Indexes added (migration 0001), best-effort analytics read/write isolation so
logging never breaks a handler, N+1 fixed on overview, structured gating errors.

---

## Priority matrix

| # | Finding | Domain | ROI | Risk | Action |
|---|---------|--------|-----|------|--------|
| F1 | Re-enable fast-model routing | AI cost | 🟢 | ⚠️ | **implement** |
| F4 | Block heavy resources (media/font) | Scrape cost | 🟢 | ⚠️ | **implement (subset)** |
| F5 | Screenshot opt-in (homepage only) | Scrape cost | 🟡 | ✅ | **implement** |
| F2 | Prompt-caching prefix discipline | AI cost | 🟡 | ✅ | **implemented (started)** |
| F7 | `next/dynamic` for recharts | Web perf | 🟡 | ✅ | **implemented** |
| F11 | Cache-Control on read GETs | API cost | ⚪ | ✅ | **implemented** |
| F6 | Drop `networkidle` | Scrape robustness | 🟡 | ⚠️ | validate per source |
| F10 | `postgres-js` prepare on pooler | DB robustness | 🟡 | ⚠️ | investigate |
| F8 | Next 16 PPR pilot | Web perf | 🟢 | 🛑 | pilot |
| F9 | SSE LISTEN/NOTIFY | Realtime scale | 🟡 | ⚠️ | future |
| F3 | JSON output format | AI cost | ⚪ | — | keep as-is |

---

## Implemented in this pass

Verified: `@outrival/ai` + `@outrival/scrapers` + `@outrival/workers` typecheck;
260/260 scrapers tests pass.

- **F1 — fast/smart model routing restored** (`packages/ai`). `AITaskConfig.tier`
  (`fast`|`smart`); pool providers gain an optional `fastModel`
  (`AI_PROVIDER_N_FAST_MODEL`); `callLLM` routes `fast`-tier tasks (only
  `classify-change` + `score-overlap`, the two highest-volume calls) to the 8B
  model, everything else keeps the 70B. Degrades to today when no fast model is
  configured. `.env.example` documents the var.
- **F5 — screenshot is now opt-in** (`packages/scrapers`). New `ScrapeOptions.
  screenshot`; `capturePage` only screenshots when asked. Homepage opts in (pHash);
  pricing/jobs/g2/capterra/extra-review scrapers no longer render+upload a PNG nor
  compute an unused pHash. Pipeline already skipped `.png` upload on an empty
  buffer, so no job change needed.
- **F4 — heavy subresources blocked on data scrapes** (`packages/scrapers`). New
  `ScrapeOptions.blockResources` aborts `media`+`font` (conservative subset — CSS/
  images kept) on the Patchright context; enabled for the non-screenshot data
  sources, cutting residential pay-per-GB bandwidth + load time.

Second pass (2026-06-13), verified: `@outrival/web` + `@outrival/api` +
`@outrival/ai` + `@outrival/workers` typecheck; 44/44 ai + 260/260 scrapers tests.

- **F7 — recharts lazy-loaded** (`apps/web`). Each chart subtree extracted to its
  own client module, pulled in via `next/dynamic({ ssr:false, loading })` — recharts
  leaves every chart route's first-load bundle into a deferred chunk (shared across
  the pricing/reviews/hiring tabs). Web tsconfig switched off the root's NodeNext to
  `bundler` so extensionless dynamic `import()` type-checks (type-check only).
- **F11 — `Cache-Control` on heavy analytics read GETs** (`apps/api`). `private,
  max-age=60` on trends (summary+series), compare, sector feed and usage — data
  moves on the hourly+ scrape cadence, so a short cache trims repeat compute + Neon
  cold-wakes. Error paths stay uncached; signals/competitors lists stay fresh.
- **F2 — static prompt prefix cached (started)** (`packages/ai`). `CompletionOptions.
  system` end-to-end: `callLLM` sends a leading system message (free Groq/Cerebras
  prefix cache), the Claude fallback marks it `cache_control: ephemeral`,
  `groundedAiCall` threads it. `classify-change` (highest volume) converted —
  byte-identical instructions in `system`, only the diff in the user tail (content
  unchanged). Remaining prompts convert incrementally.

Recommended next (not auto-applied — see ratings above): F2 (convert the remaining
prompts — score-overlap, extract-*, etc.), F6 (drop `networkidle`), F10
(`prepare:false` investigation), F8 (PPR pilot), F9 (LISTEN/NOTIFY).
