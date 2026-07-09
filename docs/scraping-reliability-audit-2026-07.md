# Scraping & AI-Pipeline Reliability Audit — 2026-07

Read-only audit of scraper reliability and the AI extraction/insight pipeline.
Based on `main` (the `main..feat/dashboard-ui-batch` diff only touches AI-visibility,
so this analysis holds for `main`). Every claim is grounded with `file:line`.
**No code was changed** — this is the report; implementation is validated wave by wave.

Method: 4 grounded code sweeps (cascade/failure · homepage/pricing · jobs/reviews/platform ·
AI layer) cross-checked against a 2026 state-of-the-art web review.

## TL;DR — the root cause

The pipeline has **no notion of an "incomplete capture." Success is binary**
(`snapshots.status` is only ever written `success`, never `partial`), and **no
completeness/confidence score is attached to any extraction.** Everything else —
false facts, silent misses, jobs closed by mistake, pricing overwritten by garbage —
follows from that. The single highest-leverage fix (R1) is to introduce a
per-snapshot completeness score + a `partial` status.

The second concentrated deficit: **grounding is disabled exactly where the user
looks** (insight / so_what / recommended_action / narrative are generated with no
citation check by default).

---

## 1. Scraper reliability diagnosis

### 1.0 Cross-cutting — the cascade accepts degraded captures as success

| # | Problem | Root cause (file:line) |
|---|---------|------------------------|
| T1 | A SPA/CSR shell is accepted at L0, never rendered | `scrape-direct.ts:53-60` — "≥ 500 chars" gate. It strips `script/style/noscript/svg`+JSON-LD (good) but counts all **static chrome** (nav, footer, marketing copy, cookie). A page whose data (prices, jobs) is JS-injected but whose hero is static clears 500 → accepted at L0 → `progressiveScroll` (browser-only) never runs. |
| T2 | 100–600-char partial-render dead-band stored as success | Only rendered-page soft-block gate: `scrape-patchright.ts:237` `text.length < 100 && isContentCollapsed(...)`. An empty `<main>` + header/footer (~300 chars) passes → `ok:true`. |
| T3 | Degraded capture stored `status:"success"`, becomes the diff baseline | `scrape-monitor.job.ts:694-709` hardcodes `status:"success"`; the success path resets `consecutiveFailures:0, markedUnscrapable:false` and advances `contentHash`+`nextRunAt`. A partial render is indistinguishable from a full one → on recovery, a phantom "everything added" diff; if it stays partial, real underlying changes are masked. |
| T4 | A transient failure can kill a monitor | The anti-void/collapse guards **throw** (`scrape-monitor.job.ts:625-627,656-658`). 3 consecutive flaky renders (slow hydration, transient soft-block, thin CDN shell) = 3 failed runs → `markedUnscrapable + isActive:false` (`:1293-1296`). Re-arm lives only in the external scheduler (`UNSCRAPABLE_REARM_DAYS`). |
| T5 | Redirect to a locale/geo variant is silently followed on success | `scrape-direct.ts:14` `redirect:"follow"`; `resolvedUrl` stored as-is (`:683`). `diagnoseFailure` detects cross-root/geo/consent redirects **only on the failure path** (`diagnose-failure.ts:86-97,186-190`). A 200 redirect to `/fr` or a geo/consent page is captured "as the page." |
| T6 | Anti-void false-positive on a genuine content reduction | `anti-void.ts:51-71` — a page genuinely gutted (~2000→~300 chars) trips `below_historical_median` → throw instead of recording the change; 3× → unscrapable. The real "page gutted" signal is never captured. |

### 1.1 Homepage
**Strategy**: cheerio structure parse (`homepage-structure.ts`) + structured diff.
**Why it fails**:
- **Hero = first literal `<h1>`** (`:319`); **sections = only `<h2>/<h3>`** (`:270`). A home built from styled `<div>` / `role="heading"` / canvas/WebGL/SVG hero (stripped `:662,671`) → **hero `null` + 0 sections** → `isIncompleteRender` (`:740-743`, very lax: "no hero AND ≤1 section") classes it *broken capture* → **never diffed → monitoring silently stops.**
- Logos/testimonials **keyword-bound**: utility-class logo walls with no aria/known heading ("Powering teams at", "As seen in"), logos in `<footer>` (excluded via chrome selector `:433-434`), testimonials in `<div class="review-card">`/`<figure>` without a "testimonial/quote" class (`:494`), quotes < 30 chars (`:599`) → invisible.
- cheerio has no layout engine → glued lines (`isBlockish` `:176-182` only knows literal Tailwind tokens).

### 1.2 Pricing
**Strategy**: structured-first JSON-LD → cached parser → AI self-heal → **AI floor**; + L2 DOM harvest + L3 product-line aggregation.
**Why it fails**:
- **Good pricing overwritten by a bad batch (correctness risk #1)**: `pricing_history` is append-only, "current" = newest batch (`competitors.ts:1257-1286` `ORDER BY recorded_at DESC`). The only guard is `plausible` = `some price>0 && pricingRatiosPlausible` — and `pricingRatiosPlausible` is **inert** unless one plan name carries both monthly AND yearly (`validate-ratios.ts:42-43`). So a 5-tier page mis-parsed into **1 plan** (or a harvest band, or a promo "$99 value") inserts and **shadows** the 5-tier batch in *every* read (tab/compare/battle-card/Ask). **No count/coverage-vs-prior check.** Empty is safe (nothing inserted `:130-138`); **non-empty mis-parse is not.**
- Harvest = **4 symbols only** `€$£¥` (`harvest.ts:31-41`): no ISO codes ("USD 29", "29 CHF", `kr`, `zł`, `₹`, `R$`), `¥`=always JPY. `detectPeriod` defaults to `monthly` (`:210`).
- **Tables → price band**: `findLabel` finds no plan name in a `<table>` grid (prices in `<td>`, names in `<th>`) → collapses to "From/Up to" instead of per-tier rows (`:140-164,220-241`). Only the AI floor reads a table.
- Monthly/annual toggle = **browser-only** (`PRICING_TOGGLE_CAPTURE_ENABLED`); "$10/mo billed annually" read as plain monthly.
- **Region non-deterministic**: prices captured from the proxy egress IP (geo varies L2/L3) but `observed_region` hardcoded default `"FR"` (`extract-pricing.job.ts:51`).
- URL discovery (`discover-url.ts`) misses `/subscriptions`, `/membership`, `/upgrade`, `/pricing.html`, locales `/precios`/`/preise`/`/prezzi`, SPA `/#pricing`; link scope = nav/header/footer only; **HEAD** probe (a site that 404s HEAD but 200s GET is judged unreachable).

### 1.3 Jobs / hiring
**Strategy**: ATS detection (regex) → public ATS API → else careers-link + render + LLM.
**What works**: 8 ATS via public API (Greenhouse/Lever/Ashby/SmartRecruiters/Recruitee/Personio-XML/WTTJ-Algolia; `ats.ts:220-462`). Mass-close guard correct for the empty case: `[]` on the non-authoritative LLM path = "extraction failed" (skip), not "0 jobs" (`jobs-delta.ts:34`).
**Why it fails**:
- **Phantom close on partial extraction (worst)**: the skip only covers `length===0`. An LLM truncated at `slice(0,10000)` (`extract-jobs.ts:21`) returning 5 of 30 roles, or a flaky render, → `skip=false` → the 25 unseen land in `closedIds` and are **closed** (`jobs-delta.ts:51-53`). A non-authoritative path can mass-close as soon as it returns ≥1 job.
- **"Hiring stopped" undetectable**: `fetchAtsJobs` returns `null` when the list is empty (`ats.ts:573`) → non-authoritative → skip. A competitor dropping to 0 openings leaves all postings `isActive=true` forever.
- **Unsupported ATS**: Workday, iCIMS, Taleo, BambooHR, Jobvite, SuccessFactors, iframe embeds. Workable = link-follow only (no API). All fall to render+LLM 10k = the least reliable path.
- ATS token **never cross-checked** (`ats.ts:492-501`): a mis-detected token resolving to another company's board returns its jobs unverified.

### 1.4 Reviews
**Strategy**: numeric score structured-first (JSON-LD `AggregateRating`), qualitative always LLM.
**Why it fails**:
- **No check the fetched page is the real reviews page**: a bot-challenge/placeholder page at HTTP 200 → the LLM can **hallucinate an `average_score`** written to `review_scores` (`extract-reviews.job.ts:134-148`).
- **Zero pagination on G2/Capterra/Trustpilot**: single `scrapePage` (`extra-platforms.scraper.ts:20`) + 10k cap → praises/complaints from a tiny page-1 sample. (App Store paginates, MAX 3; Reddit limit 25.)
- **No widget/iframe handling**: reviews in a 3rd-party embed → HTML without the verbatims, no iframe traversal.
- Anti-bot = start-level only (G2/Capterra L2, Gartner L3); if all levels block → `markedUnscrapable`.

### 1.5 Staged extraction (cross-cutting pricing/jobs/reviews)
- **"Plausible-but-wrong" cached parser never heals (worst staged gap)**: if selectors still match elements and produce a schema-valid, plausible result (jobs: `length>0`; pricing: `price>0`), `stageOk` **passes**, `consecutiveFailures` resets to 0, self-heal never fires (`staged-extract.ts:113-121`). A price selector now grabbing a struck-through "was $X", or a jobs `list` selector matching nav/blog rows, is **trusted indefinitely**. Nothing re-validates a cached spec against ground truth.
- No threshold disables a chronically-failing cached parser (`consecutiveFailures` tracked but never read — `:122-125`).

### 1.6 "What happens on failure?"
- **Total failure** → clean: nothing stored, throw → Trigger retry, no orphan row (`crawler.ts:79`).
- **Degraded/partial** → **stored as success** (T2/T3), becomes baseline. This is the hole.
- **Per-extraction confidence/completeness signal** → **does not exist.** Binary success. The only "confidence" in the schema is on *failure diagnosis* (`monitors.lastFailureConfidence`), never on a successful capture.

---

## 2. Coverage extension

### 2.1 Unsupported / poorly-supported site types

| Type | State | What to add | Difficulty | CI value |
|------|-------|-------------|-----------|----------|
| Docs / API / dev release-notes | absent (generic changelog only) | crawl docs (sitemap) + diff endpoints/deprecations | M | **Very high** — changelogs move on 73% of monitors in 90d; docs reveal new endpoints before the PR |
| Heading-less / heavy-SPA homepages | broken (1.1) | layout-agnostic fallback (rendered DOM, `role=heading`, or LLM structuring when 0 sections) | M/L | High |
| ATS Workday/iCIMS/BambooHR | absent (1.3) | public-endpoint connectors (Workday has a JSON list endpoint) | M | High |
| Multi-page / widget-embed reviews | page-1 only (1.4) | pagination + iframe traversal | M | Med-high |
| E-commerce / catalogs | partial (product-lines L3) | already there, harden (currency, tables) | S | Medium |
| Status pages | supported (patch-31) | ok | — | Medium |

### 2.2 Widening detection on already-supported types (under-exploited structured sources)
- **JSON-LD beyond `AggregateRating`**: `Product/Offer/PriceSpecification` (pricing), `JobPosting`, `Organization` (claims) — extend structured-first mappers (0 AI).
- **ATS = public APIs, not scraping**: the whole ecosystem exposes no-auth public JSON — extending `PROVIDERS[]` is deterministic connector work, not AI.
- **Sitemaps** (seeded patch-32): under-used to discover unlinked pricing/docs/product variants.
- **RSS/Atom feeds** (changelog feed-first patch-32): extend to dev release-notes.
- **Widen the platform step-B gate** (`isThin` `platform-detect.ts:71`: `noStack && bodyText<500`) — too restrictive, starves browser detection of marketing SPAs → structured connector missed.
- **LLM structured fallback when heuristics return 0** — already for pricing/jobs, **add for homepage structure**.

---

## 3. AI-layer reliability & cost

### 3.1 Hallucination / grounding — the guardrail is near-absent where it matters
- **Grounding "informs, never rejects"** (`citations.ts:6`): a failed citation is logged then **the output is persisted anyway**. A model emitting no citations → accepted verbatim, `confidence:"medium"` (`grounded-call.ts:110-119`).
- **User-facing generations opt-OUT by default** (`grounded-call.ts:44-60`): `generate_signal` (insight / so_what / recommended_action **shown to the user**), `summarize_competitor`, `extract_features` (My Product profile) → **grounding false**. `narrate_change`: **neither grounding nor schema**, free prose parsed raw (`narrate-change.ts:63`).
- ⚠️ **Important nuance**: the carve-out exists *because* re-enabling the envelope broke the free providers (a reasoning model malforms the citation JSON → parse miss → null → empty profile "scan complete"). So "turn grounding back on" is the wrong fix. The right fix (§4): **native structured outputs / constrained decoding** (GA 2026) + a **deterministic post-hoc check** (does the cited number/name appear literally in the scraped text?) instead of an self-citation envelope that overruns `maxTokens`.

### 3.2 Schema validation + retry — validate yes, retry NO (poison-pill)
- Single Zod pass (`parse.ts`), no retry, returns `null`.
- **Backwards asymmetry** (`classify-change.job.ts:82-104`): a **provider error is rethrown → Trigger retry**, but a **parse miss → `null` → `AbortTaskRunError` (non-retriable)** → the signal is **permanently lost**, `change` orphaned, no future scrape recreates it. Parse misses on free providers are transient/documented → the worst case to make non-retriable.
- **Partial persisted as valid**: `classify-structured.ts:157` coerces a wrong-length array to `"minor"`; `extract-self-profile` persists an all-empty profile as success; bare-output accepted with no citations at `confidence:"medium"`.

### 3.3 Cost
- **✅ The dedup gate exists and is well-placed**: hash over *extracted* content (`scrape-monitor.job.ts:542-543`), short-circuits **before** any AI on an unchanged page (`:574-604`), + 304 pre-flight + idempotence window. An unchanged page never calls AI.
- **Residuals**:
  - **Extraction not gated on relevance**: `extract-pricing/jobs/reviews` + `extract-self-profile` fire on **any** hash change (`:1137-1179`) — a footer edit re-runs `extract-pricing`; a rotated testimonial re-runs `extract-self-profile`. classify is relevance-gated; extraction is not.
  - **`source_summary` runs on 70b** for a 1-2 sentence blurb `maxTokens:256`, on the per-changed-scrape hot path (`extract-*.job.ts`) → over-provisioned; the 8b `classificationFast` suffices.
  - **Free system-prefix cache used only by `classify`**: classify-structured/insight/extract/summarize send one combined user message → forgo the free Groq/Cerebras prefill cache their static rule/schema blocks would enable.
  - Contexts already capped everywhere (8k-12k), `gpt-oss` reasoning pinned `low` — no full-HTML blowups.

---

## 4. State of the art 2026 + prioritized plan

### 4.1 State-of-the-art synthesis (where it converges with our gaps)
- **Hybrid heuristics→LLM fallback**: deterministic selectors first, schema-driven LLM when they break — our staged architecture — but SOTA adds **confidence routing** and **HTML→Markdown** before the LLM (−70% tokens).
- **Structured outputs / constrained decoding**: JSON Schema compiled to an FSM, invalid tokens at −∞ → mathematical guarantee of valid JSON. GA at OpenAI/Gemini/Anthropic early 2026; XGrammar default backend vLLM/SGLang <40µs/token. PARSE-style refinement: valid JSON 82%→99%.
- **Field-level confidence scoring**: verifier-based per-field, field-level override vs instance rejection; **heuristic eval on 100% of traffic + LLM-judge on 5-10%** + drift detection.
- **Anti-bot 2026**: Cloudflare blocks AI scraping by default since Jul 2025; JA4/TLS + behavioral ML. Residential + patched stealth browser (Patchright/Camoufox = our cascade) stays the right base; the add = **behavioral simulation** (mouse/scroll/timing) for invisible Turnstile-style challenges.
- **LLM cost**: prompt caching −45-80%, semantic cache + budget-aware routing −47%, **confidence-gated cheap→frontier cascade = 95% of quality at −75-85% cost**, batch API −50%.

Sources: context.dev, bytetunnels.com, 47billion.com, letsdatascience.com, collinwilkins.com,
galileo.ai, confident-ai.com, scrapfly.io, nerdbot.com, maviklabs.com, wavect.io, visualping.io, apify.com.

### 4.2 Prioritized plan (reliability → coverage → cost)

**Wave 1 — Reduce silent misses & false facts (top priority)**

| # | Improvement | Effort | Gain | Regression risk |
|---|-------------|--------|------|-----------------|
| **R1** | **Per-snapshot completeness score + `partial` status.** Compute (text/median ratio, source-type expected anchors present, statusCode, render level reached vs expected); below threshold → `status:"partial"`: do NOT advance the diff baseline, do NOT close jobs, tag the extraction low-confidence. **Unblocks R4/R5.** | M | Very high — removes the binary-success root of T2/T3/1.1/1.3 | M (core snapshot pipeline) |
| **R2** | **Fix the classify poison-pill**: parse-fail → retriable (drop `AbortTaskRunError`, let Trigger retry / re-queue). | S | High — stops permanent signal loss | Low |
| **R3** | **Real grounding on user-facing** via native structured outputs + a **deterministic post-hoc check** (cited numbers/names present literally in scraped text → else abstain/flag), for `generate_signal`, `narrate_change` (+ give it a schema). NOT a naive envelope re-enable. | M | High — reduces user-visible false facts | M (depends on free-provider structured-output support; Claude fallback) |
| **R4** | **Pricing anti-overwrite guard**: reject/flag-low-confidence a batch that sharply regresses coverage (n tiers ≪ prior) or comes from a `partial` capture. | S/M | High — stops garbage shadowing good pricing | Low |
| **R5** | **Jobs partial-close guard**: only close postings on an authoritative ATS list OR high completeness; forbid a truncated LLM (≥1 job) closing the rest. | S | High | Low |
| **R6** | **Tighten soft-block + success assertions**: widen the detected soft-block band, assert `finalUrl≈intended`, detect geo/consent **on success** (not only failure). | M | Med-high | M (false positives → retries, calibrate) |
| **R7** | **Verify the reviews page is genuine** before writing `review_scores`. | S | Medium | Low |
| **R8** | **Periodic re-validation of cached parsers** (sampled AI spot-check vs floor) to catch "plausible-but-wrong". | M | Medium | Low |

**Wave 2 — Coverage**

| # | Improvement | Effort | Gain | Risk |
|---|-------------|--------|------|------|
| C1 | Layout-agnostic homepage (rendered DOM / `role=heading` / LLM structuring when 0 sections) | M/L | High | M |
| C2 | Widen harvest currency/format (ISO codes, symbols, "billed annually") + tables→rows | S | Medium | Low |
| C3 | Pricing URL discovery (+paths, ES/DE/IT locales, SPA hash, GET fallback) | S | Medium | Low |
| C4 | ATS connectors Workday/iCIMS/BambooHR (public endpoints) | M | High | Low |
| C5 | Widen platform step-B gate + JSON-LD mappers (Product/Offer/JobPosting) | S/M | Med-high | Low |
| C6 | Reviews pagination + widget/iframe | M | Medium | M |
| C7 | New type: docs/dev release-notes (sitemap + diff) | M | High | Low |

**Wave 3 — Cost**

| # | Improvement | Effort | Gain | Risk |
|---|-------------|--------|------|------|
| K1 | `source_summary` 70b → 8b `classificationFast` | S | Direct | Low |
| K2 | Gate extraction on change relevance (don't re-run extract-* if only chrome moved) | M | Direct | Low-M |
| K3 | Extend the cacheable system prefix (static rules/schema) to classify-structured/insight/extract | S/M | Medium | Low |
| K4 | Batch API for non-real-time tasks (digests, summaries) | M | Medium | Low |
| K5 | Confidence-gated model cascade (classify→insight) + semantic cache | L | High | M |

---

Foundations are sound (decoupled cascade, dedup-before-AI, pool failover, capped contexts).
The reliability deficit is concentrated in **the absence of a completeness notion** (R1, the
multiplier that unblocks the rest) and **grounding disabled where the user looks** (R3).

Suggested start: **R1 + R2** (R1 is the multiplier, R2 is an S quick-win).
