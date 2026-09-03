# AI provider pool: capacity model and free-tier candidates

Written 2026-09-03, after Cerebras removed its free tier on 2026-08-17 (the pool's
priority-1 provider now answers 402). Pre-beta, no paying user. Goal: stay on free
tiers as long as possible and know exactly when that stops working.

Revision 2 (same day): one-time credits and request-capped free tiers are no longer
proposed as pool members (they do not move the recurring capacity); startup programs
and a root-cause / action plan for the failing pool were added.

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
terms, or flagged as assumed risk. Two filters added in revision 2: (6) the free
volume must **recur** (a one-time credit does not raise the daily ceiling, it only
delays the same wall); (7) the free volume must be **material** against the fleet's
311 calls and 924k tokens per day. Already in the pool or already discarded in the
repo (cerebras, groq, cloudflare, mistral, hyperbolic) are not re-proposed as new.
Prices per million tokens; "mix" = 0.915 × input + 0.085 × output.

### 2.1 Verdict: no new recurring free volume exists that is worth a pool slot

Every vendor with an OpenAI-compatible endpoint and a public free tier was checked
(pricing and limits pages, 2026-09-03). After filters (6) and (7), the recurring free
market for gpt-oss-class models under a no-training policy is exactly what the pool
already has (Groq, Cloudflare, Mistral) plus one unproven model on Vercel.

| Provider | What is free | Filter that fails | Source |
|---|---|---|---|
| OVHcloud AI Endpoints | US$200 credit, first project, one month, payment method required | (6) one-time | `vendor-doc` 2026-09-03 |
| Scaleway Generative APIs | first 1,000,000 tokens, then billed | (6) one-time (≈ 1 day of the fleet) | `vendor-doc` 2026-09-03 |
| Cerebras | $5 trial credit, 30 days | (6) one-time; this is why p1 answers 402 | `vendor-doc` 2026-09-03 |
| Fireworks, Nebius, Novita, Alibaba Model Studio, NVIDIA build, Ollama Cloud, Google Cloud / Azure trials | signup credits ($1 to $300, or 1M tokens per model) | (6) one-time | `vendor-doc` 2026-09-03 (amounts on each page) |
| SambaNova Cloud Free | 20 RPM, **20 requests/day**, 200k tokens/day | (7): 20 requests = 6% of the fleet's daily calls; the pool has no requests-per-day counter, so request 21 gets a 429 and parks the provider | `vendor-doc` rate-limits 2026-09-03 |
| OpenRouter `:free` | 20 RPM, 50 requests/day (1,000/day after a one-time $10 purchase) | (7): 50 requests = 16% of daily calls; no explicit no-training guarantee on free routes (4) | `vendor-doc` 2026-09-03 |
| Cohere trial keys | 1,000 API calls per month | (7): ≈ 33 calls/day | `vendor-doc` 2026-09-03 |
| Hugging Face Inference Providers | $0.10 per month | (7) | `vendor-doc` 2026-09-03 |
| Google AI Studio free tier | unlimited-ish | (4): unpaid usage "used to improve" products, human review, no opt-out | `vendor-doc` terms 2026-04-28 |
| GitHub Models | retired 2026-07-30 | gone | `vendor-doc` 2026-09-03 |
| OpenAI complimentary tokens | data-sharing program | (4) by construction | program definition |
| Z.ai GLM-4.7-Flash, AkashML, Together "Ternary Bonsai" $0 | $0 models | (4) no data-usage statement found; AkashML docs unreachable | vendor pages 2026-09-03 |
| Vercel AI Gateway free tier | a subset of $0 models, per-model limits unpublished, "monthly free credit" that stops at the first purchase (amount: `tiers` $5) | passes (6); (7) unknown until measured; only `inclusionai/ling-3.0-flash-fin(-free)` is flagged `no_training: all` (the minimax and laguna free models are `no_training: none`) | `vendor-doc` catalog API and pricing doc 2026-08-23, fetched 2026-09-03 |
| Modal Starter ($30/month free compute, self-hosted vLLM) | recurring, but 7.6 H100-hours per month; 311 calls spread over 24 h would spend most of it on cold starts | (7) unless calls are batched into a few windows; 2 to 3 days of work; parked | `vendor-doc` modal.com/pricing 2026-09-03 |

Consequence for the plan: the capacity problem is solved on our side (section 4), not
by adding free vendors. The only candidate worth a trial slot is Vercel's Ling model,
and only after a quality check on classify and JSON extraction (section 3 has its
block).

### 2.2 Existing providers, re-verified

| Provider | Free limits today | Overflow price (mix) | Sources |
|---|---|---|---|
| Cloudflare Workers AI | 10,000 Neurons/day = 286k tokens (gpt-oss-120b) or 528k (gpt-oss-20b) | $0.011 per 1,000 Neurons: $0.35 / $0.75 for 120b ($0.384 mix), $0.20 / $0.30 for 20b | `vendor-doc` 2026-08-28 |
| Groq | 30 RPM, 1k RPD, 8k TPM, 200k TPD (120b and 20b); cached tokens exempt from limits | Developer: $0.15 / $0.60 ($0.188 mix), limits not public | `vendor-doc` rate-limits 2026-09-03; price via Vercel catalog 2026-09-03 and `tiers` |
| Mistral | Experiment ≈ 1B tokens/month, 1 req/s (`tiers`) or Free plan "$10 /mo in API credits" (`vendor-doc` 2026-09-03); opt-out toggle in Admin → Privacy (`vendor-doc` 2026-09-03) | Small 4 $0.15 / $0.60 ($0.188 mix); Medium 3.5 $1.5 / $7.5 ($2.01 mix); Large 3 $0.5 / $1.5 | `vendor-doc` docs.mistral.ai/inference/pricing 2026-09-03 |
| Cerebras | Free tier replaced by $5 trial credits (30 days), 5 RPM, 30k TPM, 1M TPD | Developer from $10: 1k RPM, 1M TPM; $0.35 / $0.75 ($0.384 mix, via Vercel catalog) | `vendor-doc` 2026-09-03 |

### 2.3 Startup programs: the one kind of one-time credit that is big enough

What they are: cloud vendors give early-stage companies a credit balance to spend on
any of their services, in exchange for an application (company registration, stage,
sometimes an investor or accelerator referral). They are free, no equity, no fee. The
credit is one-time and expires (6 to 24 months), so it fails filter (6) like the
$5 to $200 trials above, but it is two to four orders of magnitude larger, so it
covers the whole bill projection of section 5 for years rather than days.

| Program | Credit | Duration | Eligibility stated on the page | Covers the AI endpoint? | Source |
|---|---|---|---|---|---|
| **Scaleway Startup Program** | Founders: up to €1,000; Early Stage: €1,500/month × 6 = €9,000; Growth: €3,000/month × 12 = €36,000 | 6 or 12 months from activation | less than 5 years old, fewer than 50 employees, **not yet a Scaleway client**; weekly committee | Generative APIs not named on the page (`console`) | `vendor-doc` scaleway.com/en/startup-program 2026-09-03 |
| **OVHcloud Startup Program** | Start: €10,000; Scale: up to €100,000 | 12 months | not stated on the page | "cloud credits", AI Endpoints not named (`console`) | `vendor-doc` startup.ovhcloud.com 2026-09-03 |
| **AWS Activate** | Founders (self-funded): $1,000 initially, up to $5,000; Portfolio: up to $200,000 with an Activate Provider org ID | not stated on the page | founded in the last 10 years, pre-Series B, AWS account on the paid tier (payment method), answer in 5 to 10 business days | Bedrock hosts gpt-oss-120b at $0.15 / $0.60 (`vendor-doc` via Vercel catalog 2026-09-03) | `vendor-doc` aws.amazon.com/startups/credits 2026-09-03 |
| Microsoft for Startups | "up to $150,000 in credits" | not stated | levels and conditions not on the public page | Azure AI Foundry hosts gpt-oss (price not verified) | `vendor-doc` microsoft.com/startups 2026-09-03 |
| Google for Startups Cloud Program | page unreadable (truncated), apply page requires login | | | Vertex AI paid tier does not train | not verified |

What the credit buys at the prices of section 2.4 (fleet today ≈ 28M tokens/month;
1,000 blended users ≈ 1.25B/month):

| Credit | Tokens | Covers |
|---|---|---|
| Scaleway Founders €1,000 at €0.188/M | 5.3B | 4 months of 1,000 users, or 15 years of today's fleet |
| Scaleway Early Stage €9,000 | 48B | 3 years of 1,000 users |
| OVH Start €10,000 at €0.107/M | 93B | 6 years of 1,000 users |
| AWS Activate Founders $1,000 at $0.188/M (Bedrock) | 5.3B | 4 months of 1,000 users |

Order of application, if Mathys goes this way: Scaleway first, because "not yet a
Scaleway client" means the application must precede any account; then OVH Start (EU,
cheapest per token, already the prod host); AWS Activate Founders as a US fallback.
Each is a `console` item: what the credit covers and its expiry are only visible
after acceptance.

### 2.4 Paid options kept for section 5

| Provider | gpt-oss-120b price | Mix per M | Region | Data | Source |
|---|---|---|---|---|---|
| DeepInfra | $0.037 / $0.17 | **$0.048** | US | zero retention, no training (vendor data page, seen via search summary only) | `vendor-doc` 2026-09-03 |
| OVHcloud | €0.08 / €0.40 | **€0.107** | FR | no training, zero retention | `vendor-doc` 2026-09-03 |
| Vercel via baseten | $0.10 / $0.50 | $0.134 | US | `no_training: all`, `zdr: all` on all 8 upstreams | `vendor-doc` catalog API 2026-09-03 |
| Scaleway | €0.15 / €0.60 | €0.188 | FR | no training | `vendor-doc` 2026-09-03 |
| Groq Developer, Fireworks, Together, Nebius, AWS Bedrock | $0.15 / $0.60 | $0.188 | US (Nebius: Finland/France, zero-retention mode) | see each | `vendor-doc` 2026-09-03 (Nebius and Bedrock prices via Vercel catalog) |
| IONOS AI Model Hub | €0.15 / €0.65 | €0.193 | DE | data-handling page not fetched | `vendor-doc` price list v2026-08-27 |
| Cloudflare, Cerebras | $0.35 / $0.75 | $0.384 | US | | `vendor-doc` |
| Mistral Medium 3.5 | $1.5 / $7.5 | $2.01 | FR | opt-out | `vendor-doc` 2026-09-03 |

---

## 3. Paste-ready provider blocks

Variable names follow `.env.example` (`AI_PROVIDER_N_{ID,BASE_URL,API_KEY,MODEL,
FAST_MODEL,TIER,DAILY_TOKEN_QUOTA,MAX_REQUEST_TOKENS,TPM_LIMIT,PRIORITY}`). The pool
skips a provider at 95% of `_DAILY_TOKEN_QUOTA`, so quotas are set at the vendor cap
and the 5% margin is the pool's. No new free provider passed section 2, so there are
four blocks: two fixes to the existing pool and two paid overflow options for the day
Mathys decides to pay (or gets a startup credit).

**Fix 1: remove Cerebras.** Delete the `AI_PROVIDER_1_*` block, or, if a $10 Developer
top-up is made, set `AI_PROVIDER_1_TIER=paid`, `AI_PROVIDER_1_TPM_LIMIT=1000000`,
`AI_PROVIDER_1_DAILY_TOKEN_QUOTA` to the daily spend you accept (1M ≈ $0.38/day).
Then renumber so Groq is priority 1 (small requests, fast), Cloudflare 2, Mistral 3.

**Fix 2: Mistral quota, re-derived from the plan the workspace is actually on**
(console check #1):

```bash
# Experiment plan (≈ 1B tokens/month): keep 30000000.
# Free plan with $10/month credits on mistral-medium-2604 ($2.01 per M at the mix):
AI_PROVIDER_4_DAILY_TOKEN_QUOTA=160000
# Same credits on mistral-small-2603 ($0.188 per M): 1700000, and set
# AI_PROVIDER_4_MODEL=mistral-small-2603 for the smart tier too.
```

**Paid overflow A: OVHcloud AI Endpoints** (EU, cheapest EU per token, also where a
Startup Program credit would be spent). Not free: every token is billed from the
first one, unless a credit is on the account.

```bash
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
# Spend cap, not a vendor limit: 3M/day ≈ €0.32/day (≈ €10/month) at €0.107 per M.
AI_PROVIDER_5_DAILY_TOKEN_QUOTA=3000000
AI_PROVIDER_5_PRIORITY=9
```

**Paid overflow B: Vercel AI Gateway** (one key, 8 no-training upstreams with built-in
failover, cheapest gpt-oss-120b route at $0.134 per M; US only). Free-tier variant on
the last line, for a quality trial only.

```bash
AI_PROVIDER_6_ID=vercel
AI_PROVIDER_6_BASE_URL=https://ai-gateway.vercel.sh/v1
AI_PROVIDER_6_API_KEY=
AI_PROVIDER_6_MODEL=openai/gpt-oss-120b
AI_PROVIDER_6_FAST_MODEL=openai/gpt-oss-20b
AI_PROVIDER_6_TIER=paid
AI_PROVIDER_6_MAX_REQUEST_TOKENS=120000
# Per-model limits unpublished; cap by spend instead: 2M/day ≈ $0.27 to $0.38/day.
AI_PROVIDER_6_TPM_LIMIT=500000
AI_PROVIDER_6_DAILY_TOKEN_QUOTA=2000000
AI_PROVIDER_6_PRIORITY=9
# Free-tier trial (quality unverified, limits unpublished, tier=free, quota 500000):
# AI_PROVIDER_6_MODEL=inclusionai/ling-3.0-flash-fin-free
```

---

## 4. Why the pool fails today, and the action plan

### 4.1 Root causes, in the order they bite (`measured` + `code`)

1. **Cerebras is dead at priority 1.** Every call tries it first, gets a 402, parks it
   for 10 minutes, and the next call after the park pays the same failed round trip
   again: ≈ 144 wasted attempts per day per worker process, 100% of Cerebras rows in
   error since 2026-08-29. It does not by itself sink the pool (failover works), but it
   adds latency to every task and noise to every metric.
2. **The :00 burst.** `schedule-scraping` enqueues every due monitor at the top of the
   hour; 67% of AI calls land in minutes :00 to :04. The pool then sees 12 to 22 calls
   and up to 123k tokens in one minute against a 640 tokens/minute average.
3. **Groq's free tier is minute-shaped.** 8k TPM and an 8k request cap mean one small
   call per minute during the burst, and none of the 12k `generate_extractor` prompts.
   Everything above 8k goes straight to Cloudflare or Mistral.
4. **Mistral's 1 request/second has no regulator in the pool.** Parallel jobs fire
   several calls in the same second, Mistral answers 429, the pool parks it for the
   `retry-after` (30 to 120 s). With Groq and Cloudflare already skipped, the pool is
   empty: `AIUnavailableError`, deferral, and the deferral wave at :05 to :14 lands on
   providers that are still parked (86% failure in those minutes).
5. **Cloudflare's 286k/day is gone by late morning.** 08:00 to 10:00 UTC carry 27% of
   the day, so afternoon calls have only Groq (8k TPM) and Mistral (1 req/s) left, and
   the big prompts have only Mistral.

Net effect: 45% to 65% of AI task runs fail each day, changes never become signals,
digests thin out silently, and battle cards show "temporarily unavailable" at :00.

### 4.2 Action plan (each step has its effect and its check)

| Step | What | Where | Effort | Effect | Check |
|---|---|---|---|---|---|
| 1 | Remove the Cerebras block; reorder Groq p1, Cloudflare p2, Mistral p3; set the Mistral quota from the verified plan; confirm the training opt-out toggle | prod `.env` (api + workers) | 10 min + console | No more wasted first attempt on every call; the daily quota view becomes true | `ai_runs` rows with provider cerebras drop to 0 |
| 2 | **Spread the fan-out over the hour**: in `runScheduleScraping`, enqueue with `startAfter = random(0, 55 min)`, or add a 0 to 59 min jitter in `computeNextRun` | `apps/workers/src/core/schedule-scraping.ts` or `packages/shared/src/scheduling.ts` | half a day with tests | Peak minute ÷ 10 to 12; at today's load the pool stays under Mistral's 60 calls/min and Groq's 8k TPM most minutes; the burst wall moves to the daily-quota wall | minute-of-hour histogram of `ai_runs.recorded_at` flat; error share under 5% |
| 3 | **Per-provider request-rate limiter** (per-second and per-day token bucket next to the TPM window), so a rate limit becomes a skip, not a park; same place as `reserveTpm` | `packages/ai/src/provider/provider-pool.ts` (recommendation only, not touched here) | 1 day | Ends the 429 → park → empty-pool cascade; makes request-capped tiers usable if ever wanted | 429 share per provider under 2% |
| 4 | **Prune the two fat prompts**: cap the HTML excerpt in `generate_extractor` at ≈ 6k tokens (avg 12.3k, p95 16.9k, max 24.3k) and the evidence in `faithfulness_check` at 8k (p95 13.4k, max 47.5k) | `packages/ai/src/tasks/generate-extractor.ts`, `apps/workers/src/lib/faithfulness-gate.ts` | 2 to 3 h | −14% and −3 to −4% of fleet tokens (≈ −165k/day); `generate_extractor` fits under Groq's 8k request cap (its output is ≈ 100 tokens) | avg prompt of both tasks in `ai_runs` |
| 5 | **Paid overflow or startup credit** at the end of the pool with a daily cap (OVH block, 3M/day ≈ €10/month), and the Scaleway / OVH / AWS applications of 2.3 | `.env` + Mathys's decision | 20 min + application | Removes the per-minute walls entirely for the price of a coffee; interactive calls stop failing at :00 | zero `AIUnavailableError` in worker logs over a week |

Steps 1 and 2 alone should bring the fleet back to the healthy-window failure rate
(≤ 4 errors/day). Step 3 is what lets the pool grow past ≈ 15 pro-equivalents per
onboarding hour without step 5. Step 4 is pure savings. Step 5 is the only one that
costs money.

### 4.3 Token and request optimization, ranked by gain per effort

Already done (`code`): the classify chain (classify, cosmetic_gate, faithfulness
claims, extract_pricing, extract_jobs, extract_reviews, alert matching, standing
queries, overlap scoring, the Ask planner) runs on `AI_CONFIG.classificationFast`,
i.e. the provider's small model (gpt-oss-20b on Groq and Cloudflare,
`mistral-small-2603` on Mistral); prefix caching (`system:`) is wired on 6 tasks;
extractors are cached per domain and source type across orgs.

| # | Lever | Gain | Effort |
|---|---|---|---|
| 1 | Prompt pruning (step 4 above) | −17% fleet tokens | 2 to 3 h |
| 2 | Verify prefix-cache hits on the 6 `system:` tasks (Groq: cached tokens cost 50% and are exempt from rate limits; Fireworks $0.015 cached; Vercel implicit caching) | −8 to −12% of billable input where supported, and a higher effective Groq TPM | half a day of measurement |
| 3 | Move the remaining small smart-tier tasks to fast: source_summary 16.5k, classify_structured 16.6k, narrate_change 1.5k, type_content_items 2.5k | ≈ 4% of tokens at half price on Cloudflare (20b costs 54% of the Neurons of 120b) | 30 min |
| 4 | Cross-org dedup of classify / insight on the same change (cache keyed by change hash) | proportional to competitor overlap between users: 13.5% of competitor rows share a host today (linear.app in 5 orgs); up to −30% of group A in a niche-heavy user base | 2 to 3 days |
| 5 | Batch API for group B extraction (Scaleway and Groq: −50%, no rate limit) | up to −50% of the 55% that tolerates hours of latency; not for hourly change alerts | 3 to 5 days, later |

Digest is 3% of tokens: no lever needed. Insight (74k/day, 8%) stays on smart for
quality.

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
  Mistral on credits), i.e. **≈ 17 to 55 blended users, or 8 to 28 pro users**, and
  only once the burst is spread (step 2) and a regulator exists (step 3).
- If Mistral is on the Experiment plan, quota supports ≈ 800 blended users, but the
  burst wall arrives at ≈ 15 pro-equivalents per onboarding hour first.
- Because the bill is a few euros a month until several hundred users, the honest
  threshold is reliability, not money: the first paid tier removes the per-minute
  walls. A startup credit (2.3) makes even that free for one to two years.
  Recommendation: one pay-as-you-go EU provider at the end of the pool with a daily
  cap of 2 to 3M tokens (≈ €7 to €10/month at OVH prices, €0 with a credit) as soon
  as Mathys accepts a payment method on file.

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
5. **Vercel dashboard** (only if the Ling trial is wanted): which models the free tier
   allows, their rate limits, whether a monthly credit exists and its amount; set a
   budget before use.
6. **Startup programs**: Scaleway must be applied to before any Scaleway account
   exists ("not yet a Scaleway client"); confirm that the OVH and Scaleway credits
   cover AI Endpoints / Generative APIs; AWS Activate requires an AWS account on the
   paid tier; Google and Microsoft figures could not be read from their public pages.
7. **OVHcloud** (only if paid overflow A is chosen): the unified OpenAI endpoint versus
   the per-model URL, and that the gpt-oss-120b endpoint runs in Gravelines. A saved
   payment method is required: your call, not done here.
