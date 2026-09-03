# AI provider pool: capacity model and free-tier candidates

Written 2026-09-03, after Cerebras removed its free tier on 2026-08-17 (the pool's
priority-1 provider now answers 402). Pre-beta, no paying user. Goal: stay on free
tiers as long as possible and know exactly when that stops working.

Source labels used on every figure:

- `vendor-doc` = read on the vendor's own pricing, limits or terms page, date of the
  fetch or of the page's own validation date.
- `tiers` = third-party page only; treat as indicative.
- `console` = only visible in Mathys's vendor console; listed at the end under
  "à vérifier côté Mathys", never guessed.
- `measured` = read-only query on prod `ai_runs` / `monitors` / `organizations`.
- `code` = derived from the repository.
- `hypothesis` = usage assumption, not measured.

Nothing in `packages/ai` was modified for this document. No account was created, no
payment method added, no pay-as-you-go activated. All database access was read-only.

---

## 1. Capacity model

### 1.1 What the data can and cannot say

`ai_runs` has 18,681 rows from 2026-06-05 to 2026-09-03 (`measured`). Token columns
are only filled from late July: June 0 of 499 success rows carry tokens, July 2,373 of
3,798, August 5,953 of 6,014, September 913 of 932. Everything below therefore uses
the **healthy reference window 2026-08-02 to 2026-08-17** (16 days, four providers up,
at most 4 error rows per day, 98.9% of success rows carry tokens). June and July
volumes are not used.

Accounts (`measured`, 2026-09-03):

| Population | Count | How counted |
|---|---|---|
| Registered organizations | 48 | rows in `organizations` (44 onboarding completed; plans: free 34, pro 10, business 4). All belong to Mathys. |
| Live organizations | **44** | at least one active monitor on a non-deleted, non-paused competitor |
| Discarded as dormant (no monitor) | 4 | |
| Orgs with an `ai_run` in the last 7 / 30 days | 42 / 44 | |
| Users with a human session in the last 7 / 30 / 60 days | 7 / 8 / 14 (20 ever) | `session.updated_at` |

So **40 of 48 organizations have had no human in 30 days but still pay the automatic
fan-out**. Passive cost below is per live organization, never per registered row.
Manual actions are essentially absent from the data (see 1.3), so the measured
consumption is the passive floor, as expected.

Fleet behind those 44 orgs: 296 non-deleted competitor rows (248 active on live
orgs), 2,051 active monitors (weekly 1,592, daily 459), 5.6 competitors and 46.6
monitors per live org on average, max 332 monitors on one org.

### 1.2 Passive cost per live account (measured)

Fleet total over the window: **≈ 924k tokens/day, ≈ 311 successful AI calls/day,
≈ 3.0k tokens per call, 91.5% input / 8.5% output**. Per live org, tokens per day:

| Profile (what the org looks like) | Orgs | Competitors | Active monitors | Cadence | Tokens/day (median, range) |
|---|---|---|---|---|---|
| Free plan: 2 competitors, weekly | ≈ 30 | 2 | 6 to 19 | weekly | **2.85k** (0.27k to 6.1k) |
| Pro plan, 10 to 15 competitors, daily | 7 | 10 to 15 | 49 to 177 | daily | **80k** (16k to 148k: 148, 114, 109, 80, 77, 45, 16) |
| Pro plan, 2 to 5 competitors | 2 | 2 to 5 | 10 to 32 | daily | 7k to 28k |
| Business, 5 to 11 competitors | 2 | 5 to 11 | 17 to 38 | daily | 23k to 28k |
| Business, 30 competitors, 332 monitors | 1 | 30 | 332 | daily | 145k including its onboarding; **≈ 72k steady** once the 1.17M one-time onboarding is removed |

Unit costs derived from the same rows: **≈ 0.55k tokens per active daily monitor per
day** (0.2k to 1.0k across pro orgs, driven by how often the page actually changes)
and **≈ 6k tokens per competitor per day** at daily cadence with the default ~11
monitors per competitor. Weekly monitors cost about a quarter of that per day, not a
seventh, because per-org fixed work (digest, summaries) does not scale down.

Two big days from the brief are explained by onboarding, not by steady load
(`measured`, first 48 h after org creation):

| Org | Plan | Competitors | Onboarding tokens | Calls | Note |
|---|---|---|---|---|---|
| 72ae6f36 | pro | 15 | 571,891 | 319 | created 2026-07-31: this is the "740k on one provider" day |
| 340afeca | business | 30 | 1,171,639 | 317 | created 2026-08-03: this is the 2.08M day |
| a22415d6 | business | 29 | 571,072 | 425 | created 2026-08-31 on the degraded pool |
| four free orgs | free | 2 | 32,497 to 79,094 | 13 to 24 | |

**Onboarding ≈ 30k tokens per competitor, one-time** (20k to 40k). Mix: generate_extractor
46%, extract_pricing 11%, classify 10%, insight 6%, cosmetic_gate 6%, extract_jobs 5%,
extract_entitlements 5%, competitor_summary 4%. The discovery legs in
`apps/api/src/routes/onboarding.ts` (`nameKnownCompetitors`, `scoreOverlap`) are not
logged to `ai_runs`, so this is a floor (`code`).

### 1.3 Tokens per day by task and trigger (fleet, healthy window)

| Trigger | Tasks (tokens/day) | Tokens/day | Share | Kind |
|---|---|---|---|---|
| A. Hourly scrape fan-out, change pipeline | classify 130.8k, faithfulness_check 79.8k, insight 73.8k, cosmetic_gate 35.7k, classify_structured 16.6k, source_summary 16.5k, competitor_summary 6.9k, narrate_change 1.5k | **361.6k** | 39% | recurring, passive |
| B. Scrape fan-out, structured extraction and self-heal | generate_extractor 290.5k, extract_pricing 47.0k, extract_entitlements 36.3k, extract_jobs 33.1k, enrich_blog_posts 30.4k, mine_job_facts 27.2k, extract_case_studies 13.3k, generate_calculator_spec 9.5k, extract_reviews 6.9k, extract_self_profile 5.2k, others 5.4k | **504.8k** | 55% | recurring, passive, cache-driven |
| C. Daily digest cron | digest 30.1k (11 runs/day × 1.9k) | **30.1k** | 3% | recurring, passive |
| D. Manual UI actions | battle_card 11.7k, battle_card_revise 7.6k, battle_card_repair 2.1k, signals_brief 6.1k, ask 0.3k | **27.8k** | 3% | active |

Cost per call for the tasks that matter (`measured`, success rows):

| Task | Calls/day | Avg tokens | Avg prompt | p95 prompt | Max prompt |
|---|---|---|---|---|---|
| generate_extractor | 23.1 | 12,396 | 12,296 | 16,869 | 24,308 |
| faithfulness_check | 18.2 | 4,389 | 3,583 | 13,422 | 47,502 |
| classify | 61.9 | 2,114 | 1,899 | 3,186 | 4,406 |
| insight | 48.0 | 1,525 | 1,134 | 2,457 | 6,030 |
| extract_pricing | 13.1 | 3,577 | 3,422 | 4,789 | 14,002 |
| battle_card (+ revise, + repair) | 1.5 (+1.5, +0.4) | 7,776 (+5,079, +4,838) | 6,023 | 7,016 | 7,069 |
| signals_brief | 4.0 | 1,515 | 1,309 | 1,483 | 1,519 |
| ask | 0.3 | 1,363 | 1,235 | 1,801 | 1,809 |

`generate_extractor` alone is 31% of all tokens on 23 calls a day: it only runs on a
cache miss or when a cached extractor stops validating, and the cache is shared across
orgs by domain and source type (`code`, `packages/ai/src/tasks/generate-extractor.ts`).

### 1.4 Active cost (hypothesis, modeled from code)

Entry points that call the LLM from the UI (`code`): battle card generate / revise /
repair (`battleCardsPerDay` 1 / 10 / 50 / 100 by plan), Ask (`ask`), signals brief,
add competitor (runs the onboarding chain for that competitor), discovery
(`discoveriesPerMonth` 3 / 20 / 100 / 500, not logged). Hourly cap `aiActionsPerHour`
20 / 40 / 120 / 300 in `PLAN_LIMITS`; prod currently enforces a flat 10/h.

Measured cost per action: one battle card ≈ 15k (generate 7.8k + revise 5.1k, repair
4.8k on 3 of 10 cards), one Ask ≈ 1.4k, one brief ≈ 1.5k, one added competitor ≈ 30k.

| Hypothesis | Per day | Tokens/day |
|---|---|---|
| H1 typical active user | 1 battle card, 5 asks, 3 briefs, 1 new competitor per week | **≈ 31k** |
| H1-light (free plan, cap 1 card/day) | 0.3 card, 2 asks, 1 brief | ≈ 9k |
| H2 power pro user at plan caps | 10 cards, 20 asks, 10 briefs | ≈ 193k |
| Ceiling from the hourly cap | 10 actions/h × 24 h × 15k | 3.6M (theoretical) |

User-day cost used below: free passive 3k (12k with H1-light), **pro passive 80k
(111k with H1)**, business passive ≈ 90k (121k with H1).

### 1.5 How many users the current free pool carries

Pool as configured in `.env.example` versus what the vendors publish today:

| Provider | Prio | Pool quota/day | Vendor limit (source) | State post 2026-08-29 (`measured`) |
|---|---|---|---|---|
| cerebras | 1 | 1,000,000; TPM 30k | Free tier gone: "$5 in free credits after making an account", expiring 30 days after grant; 5 RPM, 30k TPM, 1M TPD; Developer from $10, 1k RPM, 1M TPM (`vendor-doc` cerebras.ai/pricing and rate-limits, 2026-09-03) | 100% error (402) |
| cloudflare | 2 | 280,000 | 10,000 Neurons/day; gpt-oss-120b 31,818 N/M in, 68,182 N/M out = **286k tokens/day** at the 91.5/8.5 mix; gpt-oss-20b 18,182 / 27,273 = 528k/day (`vendor-doc` 2026-08-28) | 254k to 270k/day, at cap |
| groq | 3 | 200,000; TPM 8k; max request 8k | Free: 30 RPM, 1k RPD, **8k TPM, 200k TPD** for gpt-oss-120b and 20b; cached tokens do not count toward limits (`vendor-doc` console.groq.com/docs/rate-limits, 2026-09-03) | 177k to 191k/day, heavy 429 |
| mistral | 4 | 30,000,000; 1 req/s | Two incompatible readings: legacy Experiment plan ≈ 1B tokens/month, 1 req/s (`tiers`); mistral.ai/pricing now shows a Free plan with "$10 /mo in API credits" (`vendor-doc` 2026-09-03). Which one this workspace is on is `console`. Training opt-out toggle exists in Admin → Privacy (`vendor-doc` help article 455207, 2026-09-03) | 234k to 720k/day |

Recurring free volume per day, depending on the Mistral reading:

| Mistral reading | Mistral tokens/day | Pool total/day |
|---|---|---|
| $10/month credits on `mistral-medium-2604` (Medium 3.5, $1.5/$7.5, assumed id mapping; $2.01 per M at the mix) | ≈ 166k | **≈ 652k** |
| $10/month credits on `mistral-small-2603` (Small 4, $0.15/$0.60; $0.188 per M) | ≈ 1.77M | ≈ 2.26M |
| Experiment plan, 1B tokens/month | ≈ 33M | ≈ 33.8M |

**Users supported, passive only (pro-equivalent = 80k/day and ≈ 27 calls/day;
free-equivalent = 3k/day and ≈ 1 call/day):**

| Scenario | Daily-quota wall | Burst wall (first to break) |
|---|---|---|
| As-is (Cerebras dead at p1, Mistral plan unknown) | already short: fleet needs 924k/day, verified recurring supply is 652k to 2.26M | **already broken**: 45% to 65% of AI task runs fail every day since 2026-08-29 with only the 44 test orgs |
| Cerebras removed, Mistral = $10 credits on medium | **8 pro-eq**, or ≈ 200 free-eq | n/a, quota binds first |
| Cerebras removed, Mistral = Experiment | 420 pro-eq, or ≈ 11,000 free-eq | **≈ 15 pro-eq per onboarding hour slot** (Mistral 1 req/s, no regulator); ≈ 150 if users onboard across 10 office hours; the daily quota never binds |
| Same, active per H1 (111k/day per pro) | multiply the quota figures by 0.72 | same burst figures; interactive calls fail visibly during the burst |

**Answer to "how many users today": with the current configuration, none beyond the
present test fleet; the pool is past the wall at ≈ 6 pro-equivalents of load. The
binding constraint is the per-minute burst at the top of each hour (Groq 8k TPM,
Mistral 1 req/s with no regulator, Cloudflare's daily budget burned inside the
morning peak), not the daily quota.** Whether the daily quota is the next wall
depends entirely on which Mistral plan the workspace is on (console check #1).

Why the wall moves with concentration (`measured` + `code`):

- The hourly cron enqueues every due monitor at :00 in one batch. `computeNextRun`
  (`packages/shared/src/scheduling.ts`) returns `now + interval`, so a monitor stays
  at the hour it was onboarded; interval doubles after 14 stable days, triples after
  45, quadruples after 90 (capped at 5 days for daily, 30 for weekly).
- Post 2026-08-29, **67% of AI calls land in minutes :00 to :04** of the hour (2,300
  of 3,441), and 48% of those fail; the deferral wave at :05 to :14 fails at 86%.
- Peak minute observed: 12 to 22 calls and up to 123k tokens in one minute, against a
  day-long average of 640 tokens/minute (190×). Peak hour: 126 calls, 520k tokens.
  08:00 to 10:00 UTC carry 27% of the day.
- Provider TPM and RPS caps are per minute, so capacity is set by the peak minute,
  not the daily average. Spreading the batch over the hour multiplies per-minute
  headroom by up to 12.

Request-size wall: Groq's 8k TPM excludes every prompt above 8k (`_MAX_REQUEST_TOKENS`
8000), so `generate_extractor` (12.3k average) and the large `faithfulness_check`
prompts can only go to Cloudflare or Mistral today. Cloudflare's gpt-oss-120b context
is 128k, so size itself is not a wall there, but those big requests burn its Neuron
budget fastest.

### 1.6 What happens when the wall breaks

Pool behavior (`code`, `packages/ai/src/provider/provider-pool.ts`):

- 429: provider parked for the `retry-after` value, fallback 30 s, max 120 s.
  401 / 402 / 403 / 404: parked 10 minutes (per-provider breaker). 5xx: breaker after
  5 failures in 10 minutes. 400: no failover, fails fast.
- Daily quota at 95%: provider skipped for the rest of the UTC day. Request above
  `_MAX_REQUEST_TOKENS`: skipped. TPM window full: skipped (interactive calls keep a
  20% reserve, `AI_INTERACTIVE_RESERVE_FRACTION`).
- No provider left: `AIUnavailableError` (transient, out_of_credit, too_large,
  misconfigured, empty_replies). Only the last provider gets SDK retries.
- Global breaker: 5 failed tasks in 10 minutes pause the pool for 10 minutes and post
  to Slack.

Workers (`code`, `apps/workers/src/queue/ai-deferral.ts`, `packages/queue/src/boss.ts`):
a transient `AIUnavailableError` re-sends the job after 75 to 105 s (`AI_DEFER_BASE_SEC`
75, jitter 0.4), at most 3 times (`QUEUE_MAX_DEFERRALS`), then the normal 1 to 10 s
retry policy, then the dead-letter queue. `too_large` and `misconfigured` skip the
deferral and go straight to retry then dead-letter. `staged-extract` pauses self-heal
process-wide (`healPausedUntil`) and falls back to `ai_fallback` or leaves the page
unextracted. A failed `classifyChange` means the change never becomes a signal, so
digests and emails get thinner with no error anywhere. Precedent OUT-237: 12 days of
Cerebras 402 without failover produced 3,909 failed `ai_runs` and 982 dead-lettered
changes.

What the user sees (`code`):

- Battle card: "AI generation is temporarily unavailable. Try again shortly — nothing
  was lost." or "The AI provider is rate-limited right now. Try again in a minute."
  (`apps/api/src/routes/battle-cards.ts`).
- Ask: "AI is temporarily unavailable. Please try again in a moment."
  (`apps/api/src/lib/ask/agent.ts`).
- Hourly cap: HTTP 429 `ai_rate_limit_exceeded`.
- Digest, insights, pricing changes: nothing. Signals simply do not appear.

What ops sees: `ai-capacity-check` (every 30 min) alerts at 80 / 90 / 100% of
`dailyTokenQuota` only. Nothing on parks, 429 share, deferrals or dead letters.

---

## 2. Candidate providers

Hard constraints: (1) OpenAI-compatible `/chat/completions` with base URL + key;
(2) accepts a 12,000-token prompt in one request; (3) one account per vendor;
(4) no training on inputs or a documented opt-out; (5) production allowed by the
terms, or flagged as assumed risk. Already in the pool or already discarded in the
repo (cerebras, groq, cloudflare, mistral, hyperbolic) are not re-proposed as new.
Prices per million tokens; "mix" = 0.915 × input + 0.085 × output.

### 2.1 Retained (pass all five), ranked

| # | Provider | Free volume/day | TPM | RPS / RPM | Max request | Training | Hosting | Overflow price (mix) | Sources |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **OVHcloud AI Endpoints** | US$200 credit on the first Public Cloud project, valid one month, requires a saved payment method: ≈ 1.8B tokens at the mix price, i.e. far more than the fleet uses; **one-time** | none documented (2 MB body) | 400 RPM per project and model (authenticated); 2 RPM anonymous | 131k context | "Your data will never be used to train or improve our AI models", zero data retention | Gravelines, FR | **€0.08 / €0.40 gpt-oss-120b (€0.107 mix)** | `vendor-doc` ovhcloud.com ai-endpoints page 2026-09-03; catalog page gpt-oss-120b published 2025-08-05; capabilities doc 2026-02-03 |
| 2 | **Scaleway Generative APIs** | "free tier on the first 1,000,000 tokens. You'll be charged from token number 1,000,001": **1M one-time** | 200k TPM and 300 RPM with a payment method validated; 400k to 2,000k TPM and 600 RPM with identity validated; 100 concurrent | gpt-oss-120b 128k context, 32k output, structured output | no training on inputs | Paris | €0.15 / €0.60 gpt-oss-120b (€0.188 mix); mistral-small-3.2-24b €0.15 / €0.35; Batch API −50% | `vendor-doc` pricing page 2026-09-03; quotas doc validated 2025-10-29; models doc validated 2026-08-14; privacy doc validated 2025-10-03; quickstart (base URL `https://api.scaleway.ai/v1`) validated 2026-04-16 |
| 3 | **Vercel AI Gateway** (as paid aggregator) | Free tier = a subset of $0 models with unpublished per-model limits; "monthly free credit" stops at the first purchase (`vendor-doc` 2026-08-23); the $5/month figure is `tiers`. The only $0 chat model flagged `no_training: all` is `inclusionai/ling-3.0-flash-fin(-free)` (256k ctx); quality unverified. gpt-oss-120b is **not** in the free tier | unpublished | unpublished | 131k context | gpt-oss-120b: `no_training: "all"`, `zdr: "all"` across its 8 upstreams (baseten, bedrock, cerebras, fireworks, groq, nebius, parasail, together) | US regions | zero markup; **$0.10 / $0.50 via baseten ($0.134 mix)** up to $0.35 / $0.75 via cerebras; one key, built-in failover | `vendor-doc` public catalog API `ai-gateway.vercel.sh/v1/models` 2026-09-03; pricing doc 2026-08-23; OpenAI-compat doc 2026-08-11 |
| 4 | **SambaNova Cloud Free** | 20 RPM, **20 requests/day**, 200,000 tokens/day on gpt-oss-120b: ≈ 200k/day only if every request is ≥ 10k tokens, ≈ 60k/day at the fleet's 3k average | not stated | 20 RPM | 128k context | Terms: Customer Content processed "solely to the extent necessary to provide the Service to you ... and for no other purposes"; usage data excludes Customer Content | US | Developer tier (card): 60 RPM, 12k RPD, 20M TPD; $0.22 / $0.59 ($0.251 mix) | `vendor-doc` rate-limits doc 2026-09-03; SambaCloud terms (undated, fetched 2026-09-03); base URL `https://api.sambanova.ai/v1` seen only in third-party docs (`tiers`) |
| 5 | **OpenRouter `:free` models** | 20 RPM; 50 requests/day, or 1,000/day after a one-time $10 credit purchase | n/a | 20 RPM | model-dependent | separate account setting for free versus paid endpoints; enabling "no training" shrinks the free set | mixed | list price of each upstream, +5.5% fee on purchases | `vendor-doc` limits and privacy docs, fetched 2026-09-03 (undated pages) |

Notes on the ranking. OVH and Scaleway win on stability (published quotas, EU, cheap
overflow) but their free volume is one-time and both need a payment method on file
for the documented limits, which is Mathys's decision, not a config change. Vercel is
the strongest paid overflow (one key, eight no-training upstreams, cheapest gpt-oss-120b
route) but its free tier is a different model whose quality on classification and JSON
extraction has not been evaluated. SambaNova and OpenRouter pass but are small, and
both are request-capped in a way the pool cannot express (no RPD counter).

### 2.2 Existing providers, re-verified

| Provider | Free limits today | Overflow price (mix) | Sources |
|---|---|---|---|
| Cloudflare Workers AI | 10,000 Neurons/day = 286k tokens (gpt-oss-120b) or 528k (gpt-oss-20b) | $0.011 per 1,000 Neurons: $0.35 / $0.75 for 120b ($0.384 mix), $0.20 / $0.30 for 20b | `vendor-doc` 2026-08-28 |
| Groq | 30 RPM, 1k RPD, 8k TPM, 200k TPD (120b and 20b); cached tokens exempt from limits | Developer: $0.15 / $0.60 ($0.188 mix), limits not public | `vendor-doc` rate-limits 2026-09-03; price via Vercel catalog 2026-09-03 and `tiers` |
| Mistral | Experiment ≈ 1B tokens/month, 1 req/s (`tiers`) or Free plan "$10 /mo in API credits" (`vendor-doc` 2026-09-03); opt-out toggle in Admin → Privacy (`vendor-doc` 2026-09-03) | Small 4 $0.15 / $0.60 ($0.188 mix); Medium 3.5 $1.5 / $7.5 ($2.01 mix); Large 3 $0.5 / $1.5 | `vendor-doc` docs.mistral.ai/inference/pricing 2026-09-03 |
| Cerebras | Free tier replaced by $5 trial credits (30 days), 5 RPM, 30k TPM, 1M TPD | Developer from $10: 1k RPM, 1M TPM; $0.35 / $0.75 ($0.384 mix, via Vercel catalog) | `vendor-doc` 2026-09-03 |

### 2.3 Eliminated or parked, with the failing constraint

| Provider | Why | Source |
|---|---|---|
| Google AI Studio free tier | C4: unpaid services "used to improve" products, human review, no opt-out | `vendor-doc` terms 2026-04-28 |
| GitHub Models | "fully retired" as of 2026-07-30 | `vendor-doc` 2026-09-03 |
| NVIDIA build.nvidia.com | C5: not for production; ~1,000 one-time credits, 40 RPM | `tiers` |
| Cohere trial keys | volume: 1,000 API calls per month | `vendor-doc` 2026-09-03 |
| Hugging Face Inference Providers | volume: $0.10 per month for free users | `vendor-doc` 2026-09-03 |
| OpenAI complimentary tokens for data sharing | C4 by construction (training is the deal); page returned 403 | program definition |
| Alibaba Model Studio | 1M tokens per model, one-time, 90 days, Singapore only; no data-usage statement found (C4 unverified) | `vendor-doc` 2026-09-03 |
| Z.ai GLM-4.7-Flash / GLM-4.5-Flash | $0 but 1 concurrency (`tiers`); no data-usage statement found (C4 unverified) | `vendor-doc` pricing 2026-09-03 |
| Ollama Cloud Free | "starter usage credits" unspecified, 1 concurrent; no-training statement OK; cloud OpenAI base URL not confirmed | `vendor-doc` ollama.com/cloud 2026-09-03 |
| AkashML | $0.03 / $0.17 (cheapest seen) but docs domain unreachable, no privacy statement found (C4 unverified), free credits unspecified | vendor page 2026-09-03 |
| Together "Ternary Bonsai 27B" $0 | limits and quality unknown | `vendor-doc` 2026-09-03 |
| Vercel free-tier models other than Ling | `minimax-m2.7-free`, `minimax-m3-free`, `laguna-s-2.1-free`: `no_training: none` (C4) | `vendor-doc` catalog API 2026-09-03 |

### 2.4 Paid options kept for section 5

| Provider | gpt-oss-120b price | Mix per M | Region | Data | Source |
|---|---|---|---|---|---|
| DeepInfra | $0.037 / $0.17 | **$0.048** | US | zero retention, no training (vendor data page, seen via search summary only) | `vendor-doc` 2026-09-03 |
| OVHcloud | €0.08 / €0.40 | **€0.107** | FR | no training, zero retention | `vendor-doc` 2026-09-03 |
| Vercel via baseten | $0.10 / $0.50 | $0.134 | US | no training, ZDR | `vendor-doc` 2026-09-03 |
| Scaleway | €0.15 / €0.60 | €0.188 | FR | no training | `vendor-doc` 2026-09-03 |
| Groq Developer, Fireworks, Together, Nebius | $0.15 / $0.60 | $0.188 | US (Nebius: Finland/France, zero-retention mode) | see each | `vendor-doc` 2026-09-03 (Nebius price via Vercel catalog) |
| IONOS AI Model Hub | €0.15 / €0.65 | €0.193 | DE | data-handling page not fetched | `vendor-doc` price list v2026-08-27 |
| Cloudflare, Cerebras | $0.35 / $0.75 | $0.384 | US | | `vendor-doc` |
| Mistral Medium 3.5 | $1.5 / $7.5 | $2.01 | FR | opt-out | `vendor-doc` 2026-09-03 |

---

## 3. Paste-ready provider blocks

Variable names follow `.env.example` (`AI_PROVIDER_N_{ID,BASE_URL,API_KEY,MODEL,
FAST_MODEL,TIER,DAILY_TOKEN_QUOTA,MAX_REQUEST_TOKENS,TPM_LIMIT,PRIORITY}`). The pool
skips a provider at 95% of `_DAILY_TOKEN_QUOTA`, so quotas below are set at the
vendor cap and the 5% margin is the pool's. Suggested order: Groq first (fast, cheap,
small requests only), Cloudflare second (fixed daily budget), then the EU providers,
Mistral last among the free ones. Remove the Cerebras block or move it to a paid tier.

```bash
# --- OVHcloud AI Endpoints (EU, credit month then pay-as-you-go) --------------
# Per-model endpoint from the catalog page; a unified endpoint may exist: console.
AI_PROVIDER_5_ID=ovh
AI_PROVIDER_5_BASE_URL=https://gpt-oss-120b.endpoints.kepler.ai.cloud.ovh.net/api/openai_compat/v1
AI_PROVIDER_5_API_KEY=
AI_PROVIDER_5_MODEL=gpt-oss-120b
AI_PROVIDER_5_TIER=paid
# 131k context (vendor catalog page); leave headroom for max_tokens.
AI_PROVIDER_5_MAX_REQUEST_TOKENS=120000
# No token limit documented, only 400 RPM. 400 × 3k average = 1.2M; cap lower.
AI_PROVIDER_5_TPM_LIMIT=1000000
# Spend cap, not a vendor limit: 6M/day ≈ €0.64/day at €0.107 per M, covered by the
# US$200 credit for its month; drop to 3,000,000 (≈ €10/month) once the credit ends.
AI_PROVIDER_5_DAILY_TOKEN_QUOTA=6000000
AI_PROVIDER_5_PRIORITY=3

# --- Scaleway Generative APIs (EU, 1M free once, then pay-as-you-go) -----------
AI_PROVIDER_6_ID=scaleway
AI_PROVIDER_6_BASE_URL=https://api.scaleway.ai/v1
AI_PROVIDER_6_API_KEY=
AI_PROVIDER_6_MODEL=gpt-oss-120b
# Fast tier candidate on the same account (€0.15/€0.35): mistral-small-3.2-24b-instruct-2506
AI_PROVIDER_6_FAST_MODEL=mistral-small-3.2-24b-instruct-2506
AI_PROVIDER_6_TIER=paid
AI_PROVIDER_6_MAX_REQUEST_TOKENS=120000
# 200,000 TPM with a payment method validated (vendor quotas doc 2025-10-29).
AI_PROVIDER_6_TPM_LIMIT=200000
# Free allowance is 1,000,000 tokens total, one-time. Set to 1000000 for day one,
# then to a spend cap: 2,000,000/day ≈ €0.38/day.
AI_PROVIDER_6_DAILY_TOKEN_QUOTA=1000000
AI_PROVIDER_6_PRIORITY=4

# --- SambaNova Cloud Free (US, small; 20 requests/day is the real cap) -----------
# The pool has no requests-per-day counter: after 20 requests it will take 429s and
# park for 30 to 120 s. Only worth adding once an RPD cap exists in the pool.
AI_PROVIDER_7_ID=sambanova
AI_PROVIDER_7_BASE_URL=https://api.sambanova.ai/v1
AI_PROVIDER_7_API_KEY=
AI_PROVIDER_7_MODEL=gpt-oss-120b
AI_PROVIDER_7_TIER=free
AI_PROVIDER_7_MAX_REQUEST_TOKENS=120000
# 20 RPM × 3k average; vendor states no TPM.
AI_PROVIDER_7_TPM_LIMIT=60000
# Vendor: 200,000 tokens per day.
AI_PROVIDER_7_DAILY_TOKEN_QUOTA=200000
AI_PROVIDER_7_PRIORITY=6

# --- Vercel AI Gateway (paid overflow; one key, 8 no-training upstreams) ---------
AI_PROVIDER_8_ID=vercel
AI_PROVIDER_8_BASE_URL=https://ai-gateway.vercel.sh/v1
AI_PROVIDER_8_API_KEY=
AI_PROVIDER_8_MODEL=openai/gpt-oss-120b
AI_PROVIDER_8_FAST_MODEL=openai/gpt-oss-20b
AI_PROVIDER_8_TIER=paid
AI_PROVIDER_8_MAX_REQUEST_TOKENS=120000
# Per-model limits unpublished; cap by spend instead: 2M/day ≈ $0.27 to $0.38/day.
AI_PROVIDER_8_TPM_LIMIT=500000
AI_PROVIDER_8_DAILY_TOKEN_QUOTA=2000000
AI_PROVIDER_8_PRIORITY=8
# Free-tier variant (quality unverified): AI_PROVIDER_8_MODEL=inclusionai/ling-3.0-flash-fin-free
```

Mistral, re-derived from the plan the workspace is actually on (console check #1):

```bash
# Experiment plan (≈ 1B tokens/month): keep 30000000.
# Free plan with $10/month credits on mistral-medium-2604 ($2.01 per M at the mix):
AI_PROVIDER_4_DAILY_TOKEN_QUOTA=160000
# Same credits on mistral-small-2603 ($0.188 per M): 1700000, and set
# AI_PROVIDER_4_MODEL=mistral-small-2603 for the smart tier too.
```

---

## 4. Reduction levers, ranked by gain per effort

| # | Lever | Where | Gain (quantified) | Effort |
|---|---|---|---|---|
| 1 | Remove Cerebras from priority 1 (or move it to paid after a $10 top-up) | env only | Every task stops paying a guaranteed 402 attempt plus a 10-minute park cycle; the OUT-237 failure class disappears. Frees the top slot. | 5 min |
| 2 | Add OVH (credit) and Scaleway (1M) as configured in section 3 | env + console | +6M tokens/day of headroom versus a 924k/day fleet; the 12k+ prompts that Groq refuses get two more homes; failure rate at today's load returns to the healthy-window level (≤ 4 errors/day). | 20 min + payment method (Mathys) |
| 3 | Spread the hourly fan-out: jitter `nextRunAt` over 0 to 59 min in `computeNextRun`, or enqueue with a `startAfter` spread in `runScheduleScraping` | `packages/shared`, `apps/workers` | Peak minute ÷ 10 to 12 (67% of calls now land in 5 minutes). Moves the burst wall from ≈ 15 pro-equivalents per hour slot to the daily-quota wall (hundreds). Largest capacity gain of the list. | half a day with tests |
| 4 | Per-provider RPS / RPD token bucket in the pool (Mistral 1 req/s, Groq 30 RPM, SambaNova 20 RPD) | `packages/ai` (not touched here) | Ends the 429 → park 30 to 120 s → whole-pool outage cascade; lets SambaNova and OpenRouter be used at all. | 1 day |
| 5 | Cap the HTML excerpt in `generate_extractor` at ≈ 6k tokens | `packages/ai` prompt | Task is 31% of fleet tokens on 23 calls/day, average prompt 12.3k, p95 16.9k, max 24.3k. A 6k cap cuts the task ≈ 45%, so **≈ −14% fleet tokens (≈ 130k/day)** and the task fits Groq-sized limits. Cache is already shared across orgs by domain and source type: 13.5% of competitor rows already share a host (linear.app in 5 orgs), so the second org monitoring a competitor pays 0 for its extractors, and 46% of onboarding cost. | 1 to 2 h |
| 6 | Cap evidence in `faithfulness_check` at 8k tokens | `packages/ai` prompt | 8.6% of fleet tokens; p95 13.4k, max 47.5k. ≈ −3 to −4% fleet. | 1 h |
| 7 | Fast-tier routing for classify, cosmetic_gate, classify_structured everywhere (already fast on Groq and Cloudflare) | env (`_FAST_MODEL` on Mistral, Scaleway, Vercel) | Those tasks are 20% of tokens. On Cloudflare, 20b costs 54% of the Neurons of 120b, so the same daily budget serves up to 85% more of those calls. Keep insight and digest on smart. | 30 min |
| 8 | Verify prefix-cache hits on the 6 tasks that already send `system:` | measurement | Groq: cached tokens cost 50% and are exempt from rate limits; Fireworks $0.015 cached; Vercel implicit caching. Gain = system-prompt share of the group A prompts, plausibly 30 to 40% of their input, i.e. −8 to −12% of billable input where supported. | half a day |
| 9 | Cross-org dedup of classify / insight on the same change (cache keyed by change hash) | `apps/workers` | Proportional to competitor overlap between users: 13.5% today, unknown for real users; up to −30% of group A in a niche-heavy user base. | 2 to 3 days |
| 10 | Batch API for group B extraction (Scaleway and Groq: −50%, no rate limit) | new job flow | Up to −50% of the 55% that tolerates hours of latency; not for hourly change alerts. | 3 to 5 days, later |

Digest is 3% of tokens: no lever needed.

---

## 5. Paid cost projection

User mix (`hypothesis`): 70% free plan, 25% pro, 5% business; half of free users
active at H1-light, all pro and business users active at H1.

| Plan | Passive tokens/month | Active (H1) tokens/month | Onboarding one-time |
|---|---|---|---|
| free | 90k | +270k (H1-light, 50% of users) | 60k |
| pro | 2.4M | +0.93M | 450k |
| business | 2.7M | +1.8M (two cards/day) | 900k |

Blended: **≈ 1.25M tokens per user per month**, onboarding amortized over 12 months.
All-pro upper bound: 3.33M per user per month.

| Users | Tokens/month | DeepInfra ($0.048) | OVH (€0.107) | Scaleway / Groq-class (0.188) | Cloudflare ($0.384) |
|---|---|---|---|---|---|
| 10 | 12.5M | $0.60 | €1.34 | €2.35 | $4.80 |
| 50 | 62.5M | $3.02 | €6.70 | €11.75 | $24 |
| 250 | 312M | $15 | €33 | €59 | $120 |
| 1,000 | 1.25B | $60 | €134 | €235 | $480 |
| 1,000, all pro | 3.33B | $161 | €357 | €626 | $1,279 |

Price per user per month: **DeepInfra $0.06, OVH €0.13, Scaleway €0.24, Cloudflare
$0.48**; a pro user costs €0.36 (OVH) to $1.28 (Cloudflare) against a €79 plan, so
AI inference is under 2% of revenue on every provider except Mistral Medium 3.5
($6.70 per pro user per month at $2.01 per M).

When paying becomes inevitable:

- Recurring verified free supply is 652k to 2.26M tokens/day (Cloudflare + Groq +
  Mistral on credits), i.e. **≈ 17 to 55 blended users, or 8 to 28 pro users**. One-time
  credits (OVH ≈ 1.8B tokens, Scaleway 1M) push that by months, not by users.
- If Mistral is on the Experiment plan, quota supports ≈ 800 blended users, but the
  burst wall (lever 3) arrives at ≈ 15 pro-equivalents per onboarding hour first.
- Because the bill is a few dollars a month until several hundred users, the honest
  threshold is reliability, not money: the first paid tier removes the per-minute
  walls (Groq Developer, Cerebras Developer 1k RPM / 1M TPM, Scaleway 300 RPM / 200k
  TPM). Recommendation: one pay-as-you-go EU provider at the end of the pool with a
  daily cap of 2 to 3M tokens (≈ €7 to €10/month at OVH prices) as soon as Mathys
  accepts a payment method on file.

---

## 6. Instrumentation to see the wall before hitting it

1. **Per-provider outcome counters per minute** in Redis (`ai:stats:<provider>:<minute>`:
   success, 429, 5xx, 402/403, skipped-quota, skipped-tpm, skipped-size, parked).
   Alert when the 429 share exceeds 20% over 15 minutes. Today only daily tokens are
   counted.
2. **Task success rate per hour** from `ai_runs.status`, alert above 10% errors. This
   would have caught the 2026-08-17 outage in one hour instead of 12 days.
3. **Burst meter**: tokens and calls in the peak minute of each hour versus each
   provider's TPM and RPS, published as "headroom at :00". This is the number that
   predicts the first wall.
4. **Quota burn-rate projection**: the hour at which each provider is projected to
   reach 95% (Cloudflare reaches it before noon UTC on a normal day); alert when the
   projection lands before 18:00 UTC. `ai-capacity-check` only alerts after the fact.
5. **Deferral and dead-letter counters** from the queue in Slack, plus a count of
   changes unclassified for more than 2 hours: that is the user-facing damage.
6. **Log the onboarding discovery calls** (`scoreOverlap`, `nameKnownCompetitors`) to
   `ai_runs`, and track prompt-token p95 per task so prompt growth (the 47.5k
   faithfulness outlier) shows up before it hits a size wall.

---

## À vérifier côté Mathys

1. **Mistral Admin console → Billing**: is the workspace on the legacy Experiment plan
   (≈ 1B tokens/month) or on the Free plan with $10/month API credits? This decides
   whether the next wall is the daily quota (section 1.5). Also confirm the exact
   prices billed for `mistral-medium-2604` and `mistral-small-2603` (assumed Medium
   3.5 and Small 4), and that the Privacy toggle "allow API calls to be used for
   training" is off.
2. **Cerebras console**: confirm the 402 is exhausted trial credit; decide between
   removing the block and a $10 Developer top-up (1k RPM, 1M TPM).
3. **Cloudflare dashboard**: Neurons consumed per day against the 10,000 free.
4. **Groq console**: confirm the account tier and whether cached-token hits appear;
   Developer-tier limits are not public.
5. **Vercel dashboard**: which models the free tier actually allows, their rate
   limits, whether a monthly credit exists and its amount; set a budget before use.
6. **OVHcloud**: saving a payment method unlocks the US$200 credit (your call, not
   done here); confirm the unified OpenAI endpoint versus the per-model URL, and that
   the gpt-oss-120b endpoint runs in Gravelines.
7. **Scaleway**: whether the API answers at all without a payment method and at what
   quota (only the "payment method validated" tiers are documented); confirm the free
   1M is one-time.
8. **SambaNova**: confirm the base URL `https://api.sambanova.ai/v1` in the vendor
   docs (only third-party pages were readable) and whether 20 requests/day can be
   raised without a card.
9. **OpenRouter**: whether a one-time $10 purchase (1,000 free requests/day) is
   acceptable.
10. **Startup programs** (application required, none verifiable from docs): Scaleway
    Startup Program, OVHcloud Startup Program, Microsoft for Startups (Azure AI
    Foundry hosts gpt-oss), AWS Activate (Bedrock gpt-oss-120b at $0.15 / $0.60),
    Google for Startups (Vertex AI paid tier does not train).
