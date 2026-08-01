# AI consumption audit — 2026-08-01

Measured on production `ai_runs` / `extraction_runs` / `scrape_runs`, 14-day window.
The question this answers: why does a solo tester see "AI insights are delayed" all
the time, and where does the token budget actually go.

## Headline

| Metric | Value |
|---|---|
| Tokens burned | 6.91 M over 14 days (~1.0 M/day) |
| AI runs that fail | 1 266 / 3 661 = **35 %** |
| `generate_extractor` share | **42 % of all tokens**, for 45 usable parsers out of 656 calls |
| Errors by provider | cerebras 1, groq 1 265 (67 % of its runs) |
| Tokens per signal produced | 30 600 (226 signals in 14 days) |
| Scale | 39 orgs, 208 competitors, 1 655 active monitors |

At 39 orgs the fleet already consumes the entire free-tier envelope. This is not a
cost problem yet, it is a **ceiling that has been reached**.

### Token share by task (14 d)

| Task | Runs | Errors | Tokens | Share |
|---|---:|---:|---:|---:|
| `generate_extractor` | 656 | 405 (62 %) | 2 908 249 | 42 % |
| `classify` | 381 | 57 | 712 166 | 10 % |
| `extract_pricing` | 540 | 284 (53 %) | 676 947 | 10 % |
| `faithfulness_check` | 88 | 0 | 493 014 | 7 % |
| `insight` | 261 | 19 | 419 307 | 6 % |
| `cosmetic_gate` | 617 | 246 (40 %) | 413 136 | 6 % |
| `extract_jobs` | 218 | 85 (39 %) | 278 875 | 4 % |
| everything else | 900 | 170 | 1 008 306 | 15 % |

## Root cause 1 — the pool has one usable provider

`ai_runs` only ever records **cerebras** and **groq**. Cloudflare and Mistral are
coded, documented in `architecture.md`, and have **never served a request** (zero
rows, ever). PR #379 is open with empty keys.

What 2026-07-31 looks like hour by hour:

```
05:00  cerebras  102 runs  420k tokens    1 failure
05:00  groq      169 runs   26k tokens  152 failures   <- cerebras just vanished
06:00 → 21:00    groq only, 8-61 runs/h, ~30 % failures
```

Cerebras serves ~740k tokens then stops dead at 05:00. That is **not** the daily
quota (1 M TPD, the pool skips at 95 %). It is the **per-minute ceiling**
([~30k TPM on the free tier](https://console.cerebras.ai)) which the hourly cron
fan-out blows through in seconds. The provider is parked for 30-120 s, all traffic
shifts to Groq, whose free tier caps at **8 000 TPM** and counts
`prompt_tokens + max_tokens` against it. A 4.4k prompt asking for 1024 fits once a
minute. Hence 67 % failures.

**Observability defect worth fixing on its own**: cerebras shows 1 error in 14 days
because `markProvider` overwrites the id on every failover iteration, so only the
LAST provider tried is recorded. Cerebras' 429s are therefore **invisible** in the
data. Groq's 1 265 errors are fully **failed tasks**, not absorbed retries.

## Root cause 2 — the bug that costs 39 % of the budget

`apps/workers/src/lib/staged-extract.ts:211`

```ts
} catch (err) {
  logger.warn("self-heal generate-extractor failed (non-fatal)", {...});
}
```

When `generateExtractor` **throws** (405 of 656 runs, the dominant path), the catch
swallows it and **never stamps `lastHealAttemptAt`**. The 12 h cooldown read at
`:164-166` therefore never arms. The next scrape retries. And the one after that.

Measured: **181 of 410 runs over 7 days land within 5 minutes of the previous run
for the same competitor**.

Second hole at `:205`, `else if (cached)`: when there is **no cached row at all** and
the generation parse-fails, no row is inserted, so no cooldown arms there either.

The amplification, over 7 days, for the 184 pricing pages that actually changed:

```
410 generate_extractor calls  +  333 extract_pricing calls  =  743 AI calls
                                                            ≈ 4 calls per page
```

`extract_pricing` alone runs at 1.8x (333 calls for 184 captures) because
`retryLimit: 2` is the default in `packages/queue/src/boss.ts:176` (3 attempts) and
each attempt re-pays both calls. A retry one second later hits the same rate limit.

Of the 656 `generate_extractor` calls, `extraction_runs` records only **45 successful
heals**. 250 calls returned a spec, 205 of those produced a spec that did not
validate, and 405 never got an answer at all. **93 % waste.**

## Root cause 3 — no client-side pacing

`SCRAPE_MIN_DOMAIN_GAP_MS` paces scraping. `AI_VISIBILITY_MIN_REQUEST_GAP_MS` paces
Gemini. **Nothing paces the main pool.** `callLLM` fires as fast as the queues ask.
The 05:00 fan-out produced 271 runs and 450k tokens in one hour, most of it in a few
minutes.

The queues are individually bounded (`classify-change` and `generate-signal` at
concurrency 1, the rest defaulting to pg-boss localConcurrency 1), but there are 8+
AI-bearing queues plus the API path, so nothing bounds the **aggregate** rate against
a provider's per-minute ceiling.

## Root cause 4 — prefix caching is unused

`CompletionOptions.system` exists and is correctly documented (Groq and Cerebras
auto-cache a byte-identical prefix). **2 tasks out of 32 pass it**: `classify.ts` and
`cosmetic-gate.ts`. The other 30 glue rubric, schema and format block onto the
variable payload in a single user message.

On Groq, cached tokens do not count against the rate limit. So this is as much a
**TPM capacity** win as a token win.

## Root cause 5 — the banner cries wolf

`apps/api/src/routes/system.ts:18`: `>= 2 ai_runs errors in 15 min -> degraded`.

With Groq failing at 67 % continuously, that threshold is crossed almost permanently.
The user sees "AI insights are delayed" while Cerebras answers fine. The counter does
not distinguish "a provider was skipped and another answered" from "the task failed".

## Root cause 6 — the cosmetic gate pays a lot for a little

617 calls and 413k tokens over 14 days to suppress **58 of 607 changes** (9.5 %). It
sits on the critical path of every signal, and 246 of those calls errored (fail-open,
so pure waste plus added latency).

---

# Plan

Ordered by measured impact per unit of effort. Each item names its verification.

## P0 — stop the bleeding (est. -45 % tokens, -90 % failures)

### P0.1 — arm the heal cooldown on every exit path

`apps/workers/src/lib/staged-extract.ts`

Extract the "stamp the attempt" write into one helper and call it from **all three**
exits: success-but-invalid (already done), parse-fail with no cached row (currently
skipped), and the `catch` (currently skipped). An attempt that never reached a
provider is still an attempt: the cooldown exists to stop re-paying for a page we
cannot parse, and a provider outage is the strongest possible reason not to retry in
five seconds.

Also distinguish the two failure classes: an `AIUnavailableError` should arm a
**short** cooldown (minutes, the provider will be back), while a spec that generated
and did not validate should arm the **full** 12 h (the page is the problem).

- Effort: ~1 h.
- Verify: `select count(*) from ai_runs where task='generate_extractor'` over 7 days
  drops from 410 to under 60; the `within_5min` thrash count goes to ~0.
- Expected: **-2.7 M tokens per 14 days (-39 % of everything)**.

### P0.2 — give the pool somewhere to fail over to

The code is written and merged-ready (PR #379). It needs **keys**, not code:

- `AI_PROVIDER_3` Cloudflare Workers AI (10k neurons/day free, same gpt-oss weights,
  account id already known: it is `R2_ACCOUNT_ID`).
- `AI_PROVIDER_4` Mistral La Plateforme (1 Bn tokens/month free, EU).

Two manual steps for Mistral before it carries traffic: opt out of training (Admin
Console > Privacy, the free tier trains **by default**) and pin a **dated** model id
from `GET /v1/models`, never a `-latest` alias.

- Effort: ~30 min plus the two console visits.
- Verify: `ai_runs` shows four distinct providers within a day.
- Expected: daily capacity goes from ~1.2 M to ~2.5 M tokens; Groq stops being the
  only fallback.

### P0.3 — pace the pool against the per-minute ceiling

Add a token-bucket per provider in `packages/ai/src/provider/provider-pool.ts`, keyed
in Redis next to the existing daily counter, sized from a new
`AI_PROVIDER_N_TPM_LIMIT` (cerebras 30000, groq 8000, cloudflare/mistral per docs).
`pickProvider` skips a provider whose bucket cannot fund the request; `callLLM`
reserves the estimated cost before the call and reconciles with the real usage after.

This is the single change that fixes the **user-visible symptom**. Today a burst
saturates p1, parks it, and every subsequent call queues behind a provider that
cannot serve it.

Pair it with a **priority lane**: interactive tasks (`ask`, `battle_card`,
`extract_*` on a user-forced rescan) get a reserved share of the bucket, the same way
`USER_SCRAPE_PRIORITY` already separates a click from the hourly fan-out.

- Effort: ~4 h.
- Verify: no hour in `ai_runs` where failures exceed 10 % of runs.
- Expected: 1 266 failures per 14 days go to near zero. Token count unchanged: this
  buys **latency and reliability**, not budget.

### P0.4 — do not spend a pg-boss retry on a rate limit

`AIUnavailableError` currently consumes one of the 3 attempts and retries after
`retryDelay: 1` second with backoff to 10 s max. The provider's own 429 asks for
30-60 s. Catch `AIUnavailableError` in the AI-bearing handlers and re-enqueue with a
`startAfter` derived from the breaker's reset, instead of letting the generic retry
policy hammer it.

- Effort: ~2 h.
- Verify: `extract_pricing` runs per changed pricing capture drops from 1.8 to ~1.05.
- Expected: **-10 % tokens**, and the retry storms stop feeding the banner.

## P1 — structural savings (est. -15 % more tokens, +30 % effective TPM)

### P1.1 — split `system` on the top consuming tasks

Move the static half (role, rubric, JSON schema, format block, "write in English")
into `CompletionOptions.system` for, in order of payoff: `extract_pricing`,
`generate_extractor`, `insight`, `extract_jobs`, `faithfulness_check`,
`competitor_summary`, `classify_structured`.

The split must be **byte-identical across calls** or the cache never hits. Anything
interpolated (competitor name, source type) stays in the user message.

- Effort: ~3 h for the seven tasks.
- Verify: on Groq, `prompt_tokens` per run drops on the second call onward for the
  same task; the TPM ceiling is hit less often.
- Expected: **-10 to -15 % tokens**, and roughly **+30 % TPM headroom** since cached
  prefixes are not billed against the rate limit.

### P1.2 — a deterministic pre-filter ahead of the cosmetic gate

Before spending the call, normalise both sides of the diff (collapse whitespace,
strip punctuation and casing, sort list items) and compare. Identical after
normalisation means cosmetic with certainty, no model needed. Only what survives that
goes to the gate, and only when the diff is prose-shaped and under a size floor.

617 calls currently catch 58 suppressions. The deterministic pass should catch a good
share of them for free, and the remaining calls stop being paid on diffs that no
model could suppress anyway.

- Effort: ~2 h, pure function plus a unit test.
- Verify: `changes.suppression_reason='cosmetic'` count per 14 days holds at or above
  58 while `ai_runs task='cosmetic_gate'` drops by more than half.
- Expected: **-4 % tokens**, and one AI call removed from the critical path of most
  signals (latency win on every signal the user is waiting for).

### P1.3 — make the staged ladder actually pay off

`extraction_runs` over 14 days:

| source | ai_fallback | cache | structured | heal |
|---|---:|---:|---:|---:|
| pricing | 256 (65 %) | 57 (15 %) | 47 (12 %) | 34 (9 %) |
| jobs | 133 (57 %) | 8 (3 %) | 77 (33 %) | 11 (5 %) |

The whole point of patch-30 was to move AI off the hot path, and two thirds of pricing
extractions still burn a full AI call. Two moves:

1. The cache tier only serves 15 % because so few heals ever succeed (45 in 14 days).
   P0.1 alone should raise it: today a page that COULD be parsed loses its heal to a
   rate limit and falls to the floor.
2. Widen `structuredFn` for pricing. 12 % structured against jobs' 33 % says the
   JSON-LD / microdata reader is leaving pricing markup on the table.

- Effort: ~1 day for (2), (1) is free once P0.1 lands.
- Verify: pricing `ai_fallback` share below 40 %.
- Expected: **-5 to -8 % tokens**.

### P1.4 — cap the prompt envelope where it is loosest

`PRUNE_HTML_MAX_CHARS=40000` feeds `generate_extractor` an average of 4 433 prompt
tokens, its whole cost being prompt (98.9 %). Post-P0.1 its volume collapses, so this
is a second-order fix, but the same envelope discipline is worth a pass over
`faithfulness_check` (5 602 tokens/run average, the most expensive single call in the
product) and `battle_card` (6 111).

- Effort: ~2 h.
- Expected: **-3 %**.

## P2 — tell the truth about what is happening

### P2.1 — log the attempt, not just the outcome

`markProvider` overwrites the id per iteration, so a p1 429 is invisible and the
whole failover story is unreadable from the data. Record each **attempt**
(provider, outcome, latency) and keep the task-level row as the summary. Without this
we cannot verify P0.3 at all.

- Effort: ~2 h. One new table or a jsonb column on `ai_runs`.

### P2.2 — make the banner mean something

`system.ts:18` should count **failed tasks**, not failed provider attempts, and should
only fire when the user's own workspace is affected. A background heal that failed
over successfully is not a degradation the user needs to be told about.

Suggested shape: degraded when a task has failed **after exhausting the pool** twice
in 15 minutes, scoped to the org where possible.

- Effort: ~2 h.
- Verify: the banner is off during a normal day.

### P2.3 — surface the ceiling in `/admin`

The `/admin/scraping` page already shows the extraction ladder split. Add: tokens per
provider against its daily and per-minute quota, and the current bucket level. The
ceiling is now the binding constraint on the whole product and nothing displays it.

---

## Expected outcome

| | today | after P0 | after P0+P1 |
|---|---:|---:|---:|
| Tokens / day | ~1.0 M | ~0.55 M | ~0.35 M |
| Failed AI runs | 35 % | < 5 % | < 3 % |
| AI calls per changed pricing page | ~4 | ~1.2 | ~1.0 |
| Daily capacity (pool) | ~1.2 M | ~2.5 M | ~2.5 M |
| Headroom at current load | **0 %** | ~4.5x | ~7x |

P0 is roughly a day and a half of work and removes the symptom the user actually
feels. P1 is another two to three days and buys the runway to grow past 39 orgs
without paying for inference.

## Not in scope, deliberately

- **Switching to a paid provider.** The measured problem is waste and burstiness, not
  a genuine need for 1 M tokens a day. Paying before fixing P0.1 would buy capacity
  for calls that should not happen.
- **Downgrading model tiers.** `resolveReasoningEffort` already pins `low` on gpt-oss
  and the fast/smart split is already wired. There is no quality left to trade.
- **Removing the faithfulness gate.** 7 % of tokens for the only mechanism that stops
  a fabricated claim reaching a customer. Its envelope can be trimmed (P1.4); its
  existence is not the problem.
