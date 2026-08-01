# AI Visibility: engine capacity plan

Companion to `docs/ai-visibility.md` (the feature) and `docs/ai-visibility-free.md`
(the near-zero-cost strategy). This doc answers one question: **why does the Gemini
engine run out after a handful of prompts, and what do we do about it?**

Written 2026-08-01 against production data. No code changed.

## 1. What production actually shows

Queried on prod (`ai_visibility_results`, `ai_visibility_prompts`, `ai_runs`,
`ai_visibility_teasers`):

| Fact | Value |
|---|---|
| Orgs on a plan with `features.aiVisibility` | 12 (10 pro + 2 business) |
| Orgs opted in (>= 1 active prompt) | 6, all pro |
| Products tracked | 11 |
| Active prompts | 110 (exactly 10 per product) |
| **Grounded calls a full weekly sweep needs** | **110** |
| Result rows ever written | 1130, engine `gemini` only, since 2026-07-04 |
| Best day ever, grounded calls answered | 24 (2026-07-07) |
| Teasers | 7 `ready`, 5 `unavailable` |

The decisive measurement is the per-run breakdown. `recorded_at` is stamped once at
run start, so it doubles as a start timestamp:

| Run start | Org | Prompts answered | Prompts it wanted |
|---|---|---|---|
| 2026-08-01 02:02:38.703 | 860f8a13 | 6 | 30 |
| 2026-08-01 02:02:38.192 | a2d9bcf0 | **1** | 10 |
| 2026-08-01 02:02:38.174 | b949a58a | **1** | 20 |
| 2026-08-01 02:02:38.097 | 4da70cf3 | 10 | 20 |
| 2026-08-01 02:02:37.818 | 5dffcf4c | **1** | 20 |
| 2026-08-01 02:02:32.780 | a86aeb06 | 2 | 10 |
| 2026-07-13 04:57:34 (alone) | b949a58a | 14 | 20 |
| 2026-07-08 17:17:55 (alone) | b949a58a | 13 | 20 |
| 2026-07-07 06:06:46 (alone) | 860f8a13 | 10 | 30 |

**Six runs started inside a six-second window and answered 21 prompts between them.
The same orgs, running alone, answer 10 to 14 each.** That is not a daily allowance
running dry. That is six runs colliding on a per-minute limit.

## 2. Root causes, ranked by evidence

### C1. The whole due set is fanned out at once, and the pacer is per-process and racy

`schedule-ai-visibility` calls `scrapeAiVisibility.enqueueMany(due.map(...))`
(`apps/workers/src/core/schedule-ai-visibility.ts:64`). pg-boss hands several of those
to the light worker at the same time (measured: 6 concurrent). The rate limiter is a
module-level map:

```ts
// apps/workers/src/lib/ai-visibility/engines.ts:48-62
const lastCallAt = new Map<Engine, number>();
async function pace(engine: Engine) {
  const last = lastCallAt.get(engine);
  const wait = last === undefined ? 0 : last + MIN_REQUEST_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt.set(engine, Date.now());
}
```

Two problems. It is read-then-sleep-then-write with no lock, so N concurrent callers
all read the same `last`, all sleep the same amount, and all fire together: the
effective rate is N requests per gap, not one. And it is in-process, so it would not
survive a second worker instance either. `MIN_REQUEST_GAP_MS` defaults to 13000, which
targets 4.6 requests per minute against a limit believed to be 5; six concurrent runs
turn that into roughly 28 per minute.

### C2. A per-minute 429 is converted into "allowance exhausted" and kills the run

`engineFetch` retries a 429 exactly once, and only if `retryAfterMs` returns a number:

```ts
// engines.ts:104-108
const wait = retried ? null : retryAfterMs(body, res.headers);
if (wait === null) throw new EngineQuotaError(engine, body.slice(0, 300));
```

`retryAfterMs` returns `null` when the hinted delay exceeds `MAX_RETRY_WAIT_MS`
(30 s). Google's free tier commonly answers a rate 429 with a delay in the tens of
seconds. So two ordinary rate-limit blips, or one blip with a 45 s hint, raise
`EngineQuotaError`. The caller then does:

```ts
// core/scrape-ai-visibility.ts:172-179
exhausted.add(engine);   // skipped for every remaining prompt of the run
```

One transient rate limit therefore costs the other nine prompts of that product and
every prompt of every later product in the same run. This is the mechanism that turns
"6 concurrent runs" into "1 answered prompt".

### C3. A starved run counts as this week's run

The scheduler decides who is due from `max(recorded_at)` per org
(`schedule-ai-visibility.ts:48-57`). A run that answered 1 prompt out of 20 still
writes rows, so that org is considered fresh and is not retried for
`AI_VISIBILITY_INTERVAL_DAYS` (7). The failure is not just a lost run, it is a lost
week. It also poisons the board: `AI_VISIBILITY_MIN_PROMPTS_FOR_SIGNAL` (4) correctly
suppresses signals from those runs, but the run is still the newest one.

### C4. Secondary spenders share the same project quota

- `ai-visibility-teaser` spends up to `AI_VISIBILITY_TEASER_MAX_PROMPTS` (3) grounded
  calls per **new signup**, on any plan, ungated, with `retryLimit: 0`.
- `POST /api/ai-visibility/run` ("Run now") enqueues a full sweep on demand.

Neither is coordinated with the weekly sweep, and both draw on the same per-project
Gemini limits.

### C5. The wall is the MODEL request cap, not the grounding allowance (measured 2026-08-01)

AI Studio, project `Default Gemini Project`, free tier, 28-day peak versus limit:

| Row | RPM | TPM | RPD |
|---|---|---|---|
| Gemini 2.5 Flash | 8 / **5** | 196 / 250K | 27 / **20** |
| Gemini 2.5 Flash Lite | 11 / **10** | 338.59K / 250K | 50 / **20** |
| Gemini 3.6 Flash | 1 / 5 | 1 / 250K | 1 / **20** |
| **Tools: Gemini 2.5, search grounding** | n/a | n/a | **27 / 1.5K** |

**Grounding was never the constraint.** The grounded-request allowance is 1,500 per
day and our 28-day peak is 27, so we use 1.8% of it. What stops the runs is the plain
model request cap: **20 requests per day and 5 per minute** on the free tier, shared by
every model in the project.

Two consequences:

- The published free-tier figures (250 RPD for 2.5 Flash, 1,000 for Flash-Lite) do not
  apply to this project. 20 RPD is what is enforced, on every model including 3.6.
- A full weekly sweep is 110 calls, or about 16 per day if spread perfectly. That fits
  under 20 RPD with no margin at all, before the teaser (3 per signup) and any
  on-demand "Run now". Phase 1 alone therefore cannot make this feature reliable.

### C6. Outrival's production key shares a quota bucket with personal usage

The key lives on `Default Gemini Project`, the same project whose rate-limit page shows
`Antigravity` (agent category, 0/100 RPD) and Gemini 3.6 Flash traffic. Every request
the owner makes from an IDE, an agent or AI Studio on that project eats into the same
20 RPD the production worker needs. Production should not share a bucket with a
developer's tools, independently of which tier we end up on.

## 3. How much capacity do we actually need

- Today: 110 grounded calls per week = **16 per day**, plus roughly 3 per new signup
  for the teaser, plus on-demand runs.
- If all 12 eligible orgs opt in at the same 10 prompts per product: about 220 per
  week = **31 per day**.
- At 10x the current paying base (120 pro orgs, 1 product each): 1200 per week =
  **171 per day**.

Even the 10x case sits an order of magnitude under Gemini's 1,500 grounded requests
per day, which is the allowance we are measured at 27 against. **This feature does not
need a big engine budget. It needs a correct scheduler and a model request cap above
about 50 per day, which the free tier does not provide (20).**

## 4. Option space

### A. Fix pacing, backoff and scheduling (cost: 0)

Serialize engine calls across the whole fleet, stop treating a rate limit as an
allowance, and stop counting a starved run as done.

- Global gate instead of an in-process map: a Postgres advisory lock or a
  `next_call_allowed_at` row, so the gap holds across concurrent runs and across
  worker instances.
- Or, cheaper to reason about: give `scrape-ai-visibility` `concurrency: 1` and have
  the scheduler enqueue with staggered `startAfter` (pg-boss supports it) so the six
  due orgs are spread over the day instead of the same second.
- Raise `MAX_RETRY_WAIT_MS`, retry a per-minute 429 more than once, and only raise
  `EngineQuotaError` when the quota id actually names a per-day or per-month quota.
- On a truncated run, do not let the org's `max(recorded_at)` block a retry: either
  re-enqueue the remainder, or record run completeness and let the scheduler see it.

Upside: costs nothing, and if C5 resolves to "the real cap is 250 RPD" this alone
fully fixes the feature. Downside: does not raise the ceiling if the project really is
capped at 20 RPD.

### B. Gemini Tier 1 (put a card on the Google Cloud project) (cost: about $1-3 / month)

Enabling Cloud Billing moves the project from Free to Tier 1 immediately.

| | Free tier | Tier 1 |
|---|---|---|
| `gemini-2.5-flash` RPM / RPD | 10 / 250 (observed: 5 / 20) | 300 / 1,500 |
| Search grounding on 2.5 | free, capped | **1,500 requests/day free**, then $35 / 1k |
| Search grounding on 3.x | not available | 5,000 requests/month free, then $14 / 1k |
| Tokens | free | **billed** |

The catch nobody states clearly: enabling billing ends the free tier **for tokens**,
so every call becomes billable at $0.15 / M input and $1.25 / M output for 2.5 Flash.
The grounded requests themselves stay free up to 1,500 per day.

Cost estimate at current demand. A grounded answer injects search results as input; at
5k-15k input and 300-800 output tokens per call that is $0.0011 to $0.0032 per call.

| Scale | Calls / month | Token cost / month |
|---|---|---|
| Today (110/week) | 470 | **$0.50 to $1.50** |
| All 12 eligible orgs | 950 | $1 to $3 |
| 10x paying base | 5,200 | $6 to $17 |

So Tier 1 is effectively free at any scale we can reach this year, and it buys a
75x headroom over the observed ceiling. Guardrails to add with it: a GCP budget alert,
and an application-side daily counter that refuses to exceed a configured number of
grounded calls (the code must not be able to run up a bill even with a loop bug).

Variant B2: run `gemini-3.x-flash` grounded on Tier 1 instead. 5,000 free searches per
month covers 10x today's demand, and overage is $14 / 1k instead of $35 / 1k. But 3.x
bills **per search the model decides to run**, not per prompt, so one prompt can cost
several searches. Worth measuring before switching; it also puts us on the generation
consumers actually use.

### C. Parametric engine, no web grounding (cost: 0)

Ask the same prompts to the existing free pool (Cerebras / Groq) with no search tool.
This measures training-data presence rather than live-search presence. It is a
different and defensible metric ("share of model" in the literal sense), it has zero
Gemini quota impact, and `docs/ai-visibility-free.md` already specs it as Tier 0b.

It does not replace a grounded engine: it cannot see this week's positioning change,
which is the whole point of the product. Ship it as a second column, not a fallback.

### D. Cross-tenant answer cache (cost: 0, saves calls)

Prompts are deliberately un-branded (`generate-visibility-prompts.ts:75-77` refuses to
inject competitor names), so they are category-level questions like "What is the best
CRM for small teams?". Cache the answer by (normalized prompt, engine, locale, day)
and parse the one answer against each org's roster.

Value today is low: 6 orgs in mostly different categories. Value at scale is high and
grows superlinearly with orgs per category. Cost: a cache table and a staleness rule.
Risk: two orgs in the same category see the identical answer text as evidence, which
is honest but must be worded carefully in the UI.

### E. A second engine (cost: per call, see table)

This is the product argument more than the capacity argument. We currently report
"AI visibility" from exactly one engine. Competitors report ChatGPT, Perplexity,
Google AI Overviews, Gemini and Claude.

| Engine | Per-call cost | Notes |
|---|---|---|
| Exa `/answer` | **$0.005** | We already hold `EXA_API_KEY` for discovery. Grounded answer with citations. Cheapest add with no new vendor. |
| Groq `compound` | $0.005 basic search + tokens | We already hold a Groq key in the pool. 200 RPM. Search is Tavily-backed, so it is "a model with a search tool", not a consumer surface. |
| Perplexity `sonar` | about $0.005 request + $1/M tokens | Already coded (`queryPerplexity`), just needs a key. This is a real consumer surface. |
| OpenAI web search | $0.010 per call + 8k input tokens billed | The closest legal proxy for "what ChatGPT says". |
| Mistral (web search connector) | free tier: 2 RPM, ~1B tokens/month | Free, low throughput, small surface relevance. |
| OpenRouter `:online` (Exa) | $0.02 per call at 5 results | Convenient, 4x the price of calling Exa directly. |
| DataForSEO LLM Responses | $0.0006 + the LLM's own cost, live mode | Structured responses from **ChatGPT, Gemini, Google AI Overview, Claude, Perplexity** behind one API. The only cheap legal route to AI Overviews. |
| SerpApi AI Overview | $0.025 per search ($25 / 1k), 250 free / month | Same surface, 40x the DataForSEO price. |
| Brave Search API | $5 monthly credit, about 1,000 queries | Free tier for new users was removed in Feb 2026. Search results, not an answer. |

At our volume (110 calls/week), a second engine costs between $2 and $5 per month.
The interesting one is DataForSEO: three real consumer surfaces for roughly $10-15 per
month at 10x scale, which is the difference between "we track Gemini" and "we track
the engines your buyers use".

### I. Turn the weekly burst into a daily drip (cost: 0, no card, no new project)

The free tier gives 20 model requests per day. A week of that is **140 requests, and a
full sweep needs 110**. The free tier is already large enough; we spend it wrong.

Today the scheduler asks "which orgs are due?" and fires all their prompts at once,
which is the one shape a per-day cap cannot serve. Invert it: a daily job asks "which
prompts have gone longest without a check?", takes the N oldest across every org, and
runs them sequentially at the paced gap. N = 18 leaves headroom, costs about 4 minutes
of wall clock, and refreshes all 110 prompts on a rolling 6-day cycle, which is the
weekly cadence we already promise.

Side effects that are all improvements: no run can be truncated (there are no runs, only
prompts), a new org starts getting answers the next day instead of waiting for Monday,
and the daily budget is a single number to tune rather than an emergent property of how
many orgs happen to be due.

### J. Spend the per-MODEL buckets, not just one (cost: 0, no card, no new project)

The 20 RPD cap in the console is **per model**, not per project:

| Model | Free RPD |
|---|---|
| Gemini 2.5 Flash | 20 |
| Gemini 2.5 Flash Lite | 20 |
| Gemini 3.6 Flash | 20 |

The search-grounding allowance is a separate, family-wide 1,500 per day that we barely
touch. So pinning a second model doubles capacity to 40 per day on the same project and
the same key, and a third takes it to 60. That is 3.7x the daily demand, for free.

Two conditions. **Grounding must be confirmed on each model before it is used**: the
matrix in `ai-visibility-free.md` recorded a 429 on `gemini-2.5-flash-lite` on
2026-07-24, but that day's 20-request bucket may simply have been spent, so the test
must be re-run on a fresh day. And a prompt must keep the **same model over time**, or
its trend line mixes two writers: assign the model by a stable hash of the prompt id,
and record it on the row.

This is also the only isolation available given no new project can be created: if
Outrival pins 2.5 Flash and Flash Lite, and personal tooling (Antigravity, AI Studio)
is pointed at 3.6 Flash, the two stop eating each other's quota (C6).

### K. A second free answer engine, no card (cost: 0)

Two vendors give away more than we need, with no credit card:

| Vendor | Free allowance | Answer + citations | Enough for us? |
|---|---|---|---|
| **Linkup** | $20 of credits, **refilled every month**, professional email, no card | `sourcedAnswer` at $0.006 | 3,300 answers/month vs 470 needed |
| **Tavily** | 1,000 credits/month, no card | `include_answer`, basic search = 1 credit, answer adds none | 1,000/month vs 470 needed |
| Groq `compound` | free tier 30 RPM / 250 RPD | built-in web search | tool billed $5/1k, unclear whether the free tier is charged: test before counting on it |

Honest framing, and it decides how we present them: Linkup and Tavily are search APIs
that compose an answer. They are **not** surfaces a buyer uses. Gemini is the only free
option that is a real consumer answer engine. So these belong in the product as a
"live-web consensus" column that adds robustness and removes the single-vendor risk,
not as a second "share of model" engine sold as ChatGPT-equivalent.

### F. BYOK for paid engines (cost: 0 to us)

Let pro/business orgs paste their own Perplexity / OpenAI key; the spend is theirs. It
is lever 1 in `docs/ai-visibility-free.md` and still unbuilt. Good margin story, real
UI and secret-storage work, and it only helps orgs motivated enough to get a key.

### G. Rejected: multiple Google projects or keys to multiply the free tier

Rate limits are per Google Cloud project, so N projects would give N times the quota.
We already made this call for Groq (`docs/architecture.md`: "NE PAS utiliser plusieurs
comptes Groq, viole les ToS") and the same reasoning applies. Rejected on consistency
and on the risk of losing the account that the whole feature depends on.

### H. Rejected: scraping Google AI Overviews directly

Ruled out by the collection doctrine (2026-07-14): Google disallows `/search` in
robots.txt and challenges bots, which we treat as a refusal. If we want the AIO
surface, we buy it (option E, DataForSEO or SerpApi).

## 5. Recommended plan

### Phase 0: measured, done (2026-08-01)

Settled by the AI Studio rate-limit page (see C5): grounding allowance 1,500 RPD with
a 27 peak, model cap 20 RPD / 5 RPM enforced on every model of the project, project
shared with personal tooling. **Phase 2 is therefore mandatory, not optional**, and
Phase 1 remains worth doing because the truncation bugs cost whole weeks regardless of
the ceiling.

One thing left to look at, one click: expand "Voir plus" under `Outils` to see whether
a Gemini 3.x search-grounding row exists on the free tier and what its allowance is.
It changes nothing about Phase 2, it only informs the eventual 2.5 retirement.

### Phase 1: make the scheduler and the backoff correct (free, do this regardless)

1. Serialize grounded calls fleet-wide (advisory lock or a `next_call_allowed_at` row),
   and set `scrape-ai-visibility` to `concurrency: 1`.
2. Stop bursting. Superseded by the daily drip in Phase 2 (option I), which removes the
   fan-out entirely; if the drip slips, staggered `startAfter` on `enqueueMany` is the
   one-line stopgap.
3. Only raise `EngineQuotaError` when the quota id names a per-day or per-month quota.
   Raise `MAX_RETRY_WAIT_MS` above Google's typical hint and allow more than one retry
   through a per-minute limit.
4. Do not let a truncated run consume the org's weekly slot: record how many prompts
   were answered versus wanted, and let the scheduler re-enqueue an incomplete org.
5. Give the teaser its own small reserved budget so a signup burst cannot starve the
   tracked feature (or, simpler, run the teaser on the parametric engine from option C).

*Verify*: one weekly sweep answers 110 of 110 prompts, or names the exact quota that
stopped it.

### Phase 2: fit inside the free tier instead of buying past it (cost: 0)

**Constraint accepted: no new Google Cloud project, no payment to Google.** The free
tier is workable, because 20 requests per day for 7 days is 140 and a full sweep is 110.
What has to change is the shape of the spend, not its size.

1. **Daily drip (option I).** Replace the weekly per-org fan-out with a daily job that
   takes the `AI_VISIBILITY_DAILY_BUDGET` least-recently-checked prompts across all
   orgs and runs them sequentially. Start at 15 to leave room for personal usage on the
   shared project, raise it once model separation (step 3) is in place.
2. **Reserve for the teaser.** The day-0 teaser is 3 calls per signup and it is an
   activation moment; give it a small reserved slice of the daily budget, and let the
   tracked sweep have the rest. On a day with several signups, the sweep yields.
3. **Second and third model (option J).** Confirm grounding on `gemini-2.5-flash-lite`
   on a fresh day, then assign each prompt a model by stable hash so its trend never
   changes writer. 40 per day, same key. Point personal Antigravity / AI Studio usage
   at `gemini-3.6-flash` so it stops competing.
4. **Prompt rotation, not full sweeps.** With a drip, "10 prompts per product refreshed
   weekly" becomes a budget question rather than a burst. If demand ever exceeds the
   budget, degrade by refreshing the oldest prompts first, which is already what the
   drip does. No org ever goes dark, they just refresh slower.

*Verify*: seven consecutive days each spend the budget and never 429 on a per-day
quota; every one of the 110 prompts has a result no older than 8 days.

### Phase 2b: a free second engine when demand outgrows 40/day (cost: 0)

At 12 opted-in orgs (31 calls/day) the Gemini buckets still hold. Past that, add
**Linkup** (option K): $20 of credits refilled monthly, no card, 3,300 sourced answers
per month, which is 7x today's demand. Tavily is the fallback with the same shape and a
smaller allowance.

Present it in the UI as a live-web consensus column, not as a consumer engine. The
honest claim is "two independent web-grounded views", not "we track ChatGPT".

*Verify*: one org shows two engines with real rows; the Gemini daily budget drops
because the second engine absorbed the overflow.

### Phase 2c (not chosen, kept for the record): Gemini Tier 1

Enabling Cloud Billing raises the model cap to 300 RPM / 1,500 RPD and keeps grounding
free to 1,500 per day, for $0.50 to $1.50 per month in tokens at current volume. It is
the smallest, simplest fix and it is ruled out by the no-payment constraint. Revisit if
the drip plus the free second engine still cannot keep up, which happens somewhere
around 50 opted-in orgs.

### Phase 3: a second engine, for the product not for the capacity ($2-15 / month)

Ranked by value per euro:

1. **DataForSEO LLM Responses** for ChatGPT and Google AI Overview. This is the one
   that changes what we can claim on the pricing page.
2. **Exa `/answer`** as a cheap grounded second opinion; existing vendor, existing key.
3. **Perplexity Sonar**, already coded, needs only a key.

*Verify*: the board shows at least two engines with real rows for one org, and the
per-engine cost lands in `ai_runs` / an ops counter.

### Phase 4: scale levers, when org count justifies them

Cross-tenant answer cache (option D), then BYOK (option F).

## 6. Risks

1. **A card on file removes the free-tier safety net.** Every token is billable from
   the first call. Mitigated by the budget alert and the application-side daily cap,
   not by intent.
2. **The 20 RPD cap is real** (measured, C5) and the drip runs at 75% of it. There is
   no burst capacity left: a signup wave, a manual "Run now" spree, or an afternoon of
   personal Antigravity use on the shared project all steal from the same 20. Model
   separation (option J) is what turns that from a daily risk into a nuisance, so it is
   not optional polish.

6. **Grounding on `gemini-2.5-flash-lite` is assumed, not proven.** If it turns out to
   be 2.5-Flash-only, option J gives 20 per day instead of 40 and Phase 2b arrives
   sooner. Test it before building on it.
3. **`gemini-2.5-flash-lite` retires 2026-10-16**, and 2.5 Flash will follow. Any pin
   is temporary; the 3.x grounding cost shape (per search, not per prompt) needs to be
   measured before that migration, not during it.
4. **A cross-tenant cache makes two customers see the same evidence text.** Acceptable
   if the UI says the answer is a shared observation of a public question, misleading
   if it implies a per-customer query.
5. **One engine is a product risk, not just a capacity one.** As long as the board says
   "Gemini" only, a prospect comparing us to a $150/month AI-visibility tool sees one
   fifth of the surface.

## 7. Sources (2026-08-01)

- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) (per-model numbers now only in AI Studio)
- [Grounding with Google Search](https://ai.google.dev/gemini-api/docs/google-search)
- [Gemini rate limits per tier](https://www.aifreeapi.com/en/posts/gemini-api-rate-limits-per-tier)
- [Enabling billing and the free tier](https://usagebox.com/articles/gemini-api-billing-free-tier-confusion)
- [Exa pricing](https://tickerr.ai/pricing/exa)
- [Groq pricing, built-in tool fees](https://groq.com/pricing)
- [DataForSEO LLM Responses pricing](https://dataforseo.com/pricing/ai-optimization/llm-responses)
- [SerpApi AI Overview](https://serpapi.com/ai-overview)
- [OpenRouter web search plugin](https://openrouter.ai/docs/guides/features/plugins/web-search)
- [Brave Search API free tier change](https://www.implicator.ai/brave-drops-free-search-api-tier-puts-all-developers-on-metered-billing/)
- [Perplexity API pricing](https://www.cloudzero.com/blog/perplexity-api-pricing/)
- [OpenAI API pricing, web search tool](https://developers.openai.com/api/docs/pricing)
- [Mistral free tier](https://pricepertoken.com/endpoints/mistral/free)
