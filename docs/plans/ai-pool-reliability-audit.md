# AI pool reliability audit (code level)

Read-only audit of the provider pool, the queue orchestration and the prompt
envelopes, written against the worktree `providers_ai` on 2026-09-03.

Companion to `docs/plans/ai-provider-capacity.md`. That document holds the vendor
limits, the per-task token tables and the fleet sizing. This one goes down to the
code and answers a narrower question: given those limits, which lines of code turn a
capacity problem into a 45-65% failure rate, and which lines spend tokens we never
needed to spend. Tables from the capacity document are referenced, not repeated.

Production figures quoted below were measured on 2026-09-03 and supplied with the
assignment. Anything not derivable from the code or from those figures is marked
**to measure** with the query or log line that would settle it.

---

## 1. Summary

| # | Finding | Expected gain |
|---|---|---|
| F1 | Everything is enqueued at `:00`. `CRON_SCHEDULES` fires `schedule-scraping` and `generate-daily-digest` on the same `"0 * * * *"`, and `enqueueMany` passes no `startAfter`, so 2,051 monitors land in one batch. Peak minute reaches 123k tokens against a day mean of 640 tokens/minute. | Spreading the batch over 50 minutes brings the peak minute to roughly the mean. Removes the TPM-driven 429s on Groq by construction (8,000 TPM against a spread load of about 2.5k tokens/minute). Recovery rate **to measure**. |
| F2 | The deferral horizon is shorter than the park it waits out. Three deferrals of 75-105 s total at most 315 s, and every park a deferral can land in is 600 s (`AI_CIRCUIT_BREAKER_RESET_MIN=10`, and the same value is the default per-provider breaker TTL). A deferred job cannot outlive the outage it was deferred for. | Turns the 86% failure rate observed in minutes `:05-:14` into a wait. Directly recovers the deferral wave (195 calls/day post-08-29). |
| F3 | Two of four providers are never paced. `.env.example` declares no `TPM_LIMIT` for Cloudflare or Mistral, so `loadProviders` sets `tpmLimit: 0` and `hasHeadroom` returns `true` unconditionally. The 20% interactive reserve is therefore inert on both, and Mistral's 1 request/second is a request limit the pool has no counter for at all. | Makes pacing real on the two providers that carry the load today (Cloudflare 254-270k/day at cap, Mistral 234-720k/day). |
| F4 | `generate_extractor` spends 31% of all tokens and about 84% of its calls produce no working parser (60 `heal` rows against 23.1 calls/day over the healthy window). The prompt is capped at 40,000 characters of HTML skeleton and nothing shortens the cooldown ladder for a page that keeps failing. | Up to 240k tokens/day, 26% of the healthy daily total, is spent on generations that never validate. |
| F5 | Fast-tier coverage is 17 call sites against roughly 40 smart-tier ones, and the claim-level judge runs on the smart tier (`judge-claim.ts:80` uses `AI_CONFIG.classification`), which is up to 12 of the 13 calls in a gated chain. On Cloudflare the same 10,000 Neurons/day buy 286k tokens on `gpt-oss-120b` and 528k on `gpt-oss-20b`. | Moving the judge and the small extractors to fast nearly doubles Cloudflare's effective daily ceiling: +242k tokens/day of headroom without touching a vendor plan. |

---

## 2. Failure anatomy of one change at `:00`

The state the pool is in since 2026-08-29: Cerebras answers 402 on every call at
priority 1, Cloudflare sits at its 280k daily quota, Groq 429s under the burst,
Mistral absorbs whatever is left.

### T+0 s: the cron fires

```
packages/queue/src/jobs.ts:503   "schedule-scraping": "0 * * * *",
packages/queue/src/jobs.ts:504   "generate-daily-digest": "0 * * * *",
```

Two crons on the same expression. `generate-daily-digest` makes no LLM call
(`apps/workers/src/core/generate-daily-digest.ts:47` states it explicitly), so it
contributes DB load, not tokens. `schedule-scraping` is the one that matters.

### T+0 s: the whole due set is enqueued at once

```ts
// apps/workers/src/core/schedule-scraping.ts:173
await scrapeMonitor.enqueueMany(
  enqueueable.map((monitor) => ({ data: { monitorId: monitor.id } })),
```

No `startAfter` on any row. `enqueueMany` does support one:

```ts
// packages/queue/src/boss.ts:267
enqueueMany: (rows: { data: P; options?: Omit<JobInsert, "data"> }[]) => ...
```

so this is an omission, not a limitation.

The burst is also self-perpetuating. `computeNextRun` returns `now + interval`
exactly:

```ts
// packages/shared/src/scheduling.ts:37
return new Date(now.getTime() + interval);
```

A monitor scraped at 09:00:04 is due again at 09:00:04, so the population never
disperses on its own. With 2,051 active monitors (1,592 weekly, 459 daily) the
steady-state shape is a spike at `:00` of every hour: 67% of all AI calls land in
minutes `:00-:04` (2,300 of 3,441 post-08-29), and 48% of those fail.

### T+0..2 s: the workers wake

`notify: true` on every queue plus `notifyPollingIntervalSeconds: 2`
(`packages/queue/src/boss.ts:292`, `:306`) means pickup is sub-second, not the
polling interval. The burst reaches the handlers essentially immediately.

### T+2..90 s: scrapes run, AI work fans out

`scrape-monitor` runs at `SCRAPE_CONCURRENCY ?? 3` (`packages/queue/src/jobs.ts:219`)
on the browser worker. Each capture whose hash moved enqueues `classify-change` and,
depending on `sourceType`, `extract-pricing` or `extract-jobs`
(`apps/workers/src/core/scrape-monitor.ts:1876`, `:2489`, `:2521`).

Twenty core handlers call `loggedAi` (`ai-visibility-teaser`,
`backfill-pricing-history`, `classify-change`, `detect-structural-changes`,
`evaluate-standing-queries`, `extract-jobs`, `extract-pricing`, `extract-reviews`,
`extract-self-profile`, `generate-battle-card`, `generate-signal`,
`generate-weekly-digest`, `ingest-blog-posts`, `ingest-case-studies`,
`ingest-content-items`, `mine-job-facts`, `probe-pricing-calculator`,
`refresh-competitor-summary`, `scrape-ai-visibility`, `signal-batching`) plus four
library helpers (`alert-conditions`, `entitlements`, `staged-extract`,
`faithfulness-gate`). Six queues declare a `concurrency`; the rest inherit
`localConcurrency` 1. Nothing in `packages/ai` bounds the sum.

### T+5 s: the first 429

`callLLM` picks a provider, books the estimate into the TPM window, calls, and on a
429 parks that provider:

```ts
// packages/ai/src/provider.ts:508
await tripBreaker(
  provider.id,
  rateLimited ? "rate_limited" : "provider_error",
  rateLimited ? rateLimitBackoffSec(err) : undefined,
);
```

`rateLimitBackoffSec` reads `retry-after`, then Groq's prose form, and clamps to
`RATE_LIMIT_BACKOFF_MAX_SEC = 120` with a 30 s fallback
(`packages/ai/src/provider.ts:150-151`, `:165-185`). So Groq disappears from the pool
for 30 to 120 seconds.

### T+5 s, same call: Cerebras is parked for ten minutes

Cerebras answers 402. `isOutOfCredit` is true, `tooLarge` is false, so the code falls
through to the same `tripBreaker` above with `ttlSec` undefined:

```ts
// packages/ai/src/provider/provider-pool.ts:346-348
export async function tripBreaker(id: string, reason: string, ttlSec?: number) {
  ...
  await redis.set(`ai:breaker:${id}`, reason, { ex: ttlSec ?? resetMin * 60 });
```

with `AI_CIRCUIT_BREAKER_RESET_MIN=10` (`.env.example:587`). Ten minutes, then one
wasted round trip, then ten minutes again: roughly 144 pointless probes a day against
an account that is not coming back.

### T+10..40 s: Cloudflare drops out silently

```ts
// packages/ai/src/provider/provider-pool.ts:301
if (Number(used ?? 0) >= p.dailyTokenQuota * 0.95) continue;
```

At `AI_PROVIDER_3_DAILY_TOKEN_QUOTA=280000` (`.env.example:532`) the cut is 266,000
tokens. Production shows Cloudflare at 254-270k/day, so it crosses the line late in
the day and then simply stops being pickable, with no log line naming the event.

### T+15 s: a task exhausts the pool

`maxAttempts = eligible.length` (`packages/ai/src/provider.ts:346`), so with Cerebras
breakered, Cloudflare over quota and Groq parked, one task gets exactly one attempt
(Mistral). If Mistral 429s or 5xxs, the loop ends and `classifyExhaustion` runs.
Transient outranks everything (`packages/ai/src/provider.ts:218-238`), so the verdict
is `transient` and:

```ts
// packages/ai/src/provider.ts:576
await recordFailure();
throw new AIUnavailableError(... "all_providers_failed: ..." ...);
```

### T+15..120 s: the fifth exhausted task blanks the workspace

```ts
// packages/ai/src/provider/circuit-breaker.ts
const FAILURE_WINDOW_SEC = 600;
... incr("ai:failures:global"); expire(..., FAILURE_WINDOW_SEC);
... if (count >= Number(process.env.AI_CIRCUIT_BREAKER_THRESHOLD ?? 5)) tripGlobalBreaker(...)
```

Five exhausted tasks inside a rolling ten-minute window opens the global breaker for
`AI_CIRCUIT_BREAKER_RESET_MIN` minutes, that is 600 s. At a peak of 12-22 AI calls per
minute, five exhausted tasks is a few seconds of the burst.

From then on every call short-circuits before touching a provider:

```ts
// packages/ai/src/provider.ts:319-320
const breaker = await checkGlobalBreaker();
if (breaker.open) throw new AIUnavailableError(breaker.reason ?? "ai_unavailable");
```

A single 402 can do it in one step rather than five: if every provider that answers
returns 402, `classifyExhaustion` says `out_of_credit` and
`tripGlobalBreaker("ai_out_of_credit")` fires immediately, no threshold
(`packages/ai/src/provider.ts:549`).

### T+75..105 s: the deferral wave lands inside the blackout

```ts
// apps/workers/src/queue/ai-deferral.ts:13,21,40
const BASE_SEC = Number(process.env.AI_DEFER_BASE_SEC ?? 75);
const JITTER_FRACTION = Number(process.env.AI_DEFER_JITTER_FRACTION ?? 0.4);
return Math.round(BASE_SEC * (1 + Math.random() * Math.max(0, JITTER_FRACTION)));
```

75 to 105 seconds. `QUEUE_MAX_DEFERRALS=3` (`.env.example:583`,
`packages/queue/src/boss.ts:53`), so the total deferral horizon is at most 315 s. The
global breaker holds for 600 s. After the third deferral the job falls back to the
normal retry policy: `retryLimit 2`, `retryDelay 1`, `retryDelayMax 10`
(`packages/queue/src/boss.ts:277-280`), which is another 21 s at most.

**Every attempt a job can make is consumed inside the blackout it was deferred for.**
That is the mechanism behind the measured 86% failure rate in minutes `:05-:14`.

Then the job dies quietly: only 5 of 53 jobs declare `deadLetter`, so 48 of them end
as `failed` rows in `pgboss.job` with nothing replaying them
(`packages/queue/CLAUDE.md`, confirmed against `packages/queue/src/jobs.ts`).

### Proposed values for the collision

| Setting | Today | Proposed | Why |
|---|---|---|---|
| `AI_CIRCUIT_BREAKER_RESET_MIN` | 10 | 2 | The blackout has to be shorter than the deferral horizon, not longer. Two minutes still absorbs a 120 s rate-limit park, which is the longest thing `rateLimitBackoffSec` can produce. |
| `AI_CIRCUIT_BREAKER_THRESHOLD` | 5 | 20 | Five exhausted tasks in ten minutes is normal traffic at 12-22 calls/minute, not an outage. |
| `AI_DEFER_BASE_SEC` | 75 | 150 | Longer than the longest per-provider park (120 s). |
| `AI_DEFER_JITTER_FRACTION` | 0.4 | 0.6 | 150-240 s, wide enough that a deferred cohort does not rebuild the burst. |
| `QUEUE_MAX_DEFERRALS` | 3 | 5 | Horizon 750-1200 s, comfortably past a 120 s breaker. |

The env-only version of this is the "today" wave in section 5. The correct version is
to make the deferral read the breaker instead of guessing: `checkGlobalBreaker()`
already returns `resetInSec` (it is what `apps/api/src/routes/system.ts` renders), so
`resolveAiDeferral` can defer to `resetInSec + jitter` when the breaker is open.

---

## 3. Findings ranked by impact

### R1. `schedule-scraping` enqueues the whole hour in one batch (Q1, Q15)

**Evidence.** `packages/queue/src/jobs.ts:503` (`"0 * * * *"`),
`apps/workers/src/core/schedule-scraping.ts:173-174` (no `startAfter`),
`packages/shared/src/scheduling.ts:37` (`now + interval`, never a slot),
`packages/queue/src/boss.ts:267-268` (per-row `options` is accepted).

**Why it hurts.** 67% of all AI calls fall in `:00-:04` at a 48% failure rate; peak
minute 12-22 calls and up to 123k tokens against a day mean of 640 tokens/minute, so
the peak is roughly 190 times the mean. Groq's free ceiling is 8,000 TPM: a 123k-token
minute cannot be served by the pool at any priority order. 08:00-10:00 UTC alone
carries 27% of the day.

**Fix.** Spread the batch inside `enqueueMany`:

```ts
const SPREAD_SEC = Number(process.env.SCRAPE_SPREAD_SEC ?? 3000); // 50 min
await scrapeMonitor.enqueueMany(
  enqueueable.map((monitor, i) => ({
    data: { monitorId: monitor.id },
    options: { startAfter: Math.floor((i / enqueueable.length) * SPREAD_SEC) },
  })),
);
```

3000 s leaves a 10-minute margin before the next cron. Shuffle `enqueueable` first so
the same org is not always last.

**Effort.** Under 30 minutes, three lines plus a shuffle.
**Expected gain.** Peak minute drops from 123k tokens to roughly the mean. The
resulting failure rate is **to measure** (compare `ai_runs` error share in
`:00-:04` before and after over a week).
**Risk.** Low. A monitor's freshness moves by at most 50 minutes, which is inside the
noise of a 1 h realtime cadence and irrelevant to daily and weekly ones.

### R2. The deferral horizon cannot outlive the parks (Q1)

**Evidence.** `apps/workers/src/queue/ai-deferral.ts:13,21,40`;
`packages/queue/src/boss.ts:53,494,507`; `.env.example:583,586-587`;
`packages/ai/src/provider/circuit-breaker.ts` (`FAILURE_WINDOW_SEC = 600`,
reset from `AI_CIRCUIT_BREAKER_RESET_MIN ?? 10`);
`packages/ai/src/provider/provider-pool.ts:349` (`ttlSec ?? resetMin * 60`).

**Why it hurts.** 3 x (75..105) = 225..315 s of deferral against a 600 s breaker.
The measured `:05-:14` deferral wave is 195 calls/day at 86% failure, the worst rate
of any window in the day, and it is worse than the `:00-:04` window it is trying to
escape.

**Fix.** The values in section 2, plus the structural version: have
`resolveAiDeferral` consult `checkGlobalBreaker()` and return
`Math.max(BASE_SEC, resetInSec) * (1 + jitter)` when the breaker is open. The
resolver currently sees only the error message
(`apps/workers/src/queue/ai-deferral.ts:32`), so this needs the resolver to be async
or the breaker TTL to be encoded in the `AIUnavailableError` message.

**Effort.** Env-only version: 5 minutes. Structural version: about half a day
including the `DeferralResolver` type change in `packages/queue/src/boss.ts:120`.
**Expected gain.** The deferral wave stops being a failure wave. Bounded above by the
195 calls/day currently failing at 86% in that window.
**Risk.** Low. A shorter global breaker means a broken pool is probed more often; the
threshold rise to 20 offsets it.

### R3. Two of four providers have no rate limiter at all (Q2, Q3)

**Evidence.**

```ts
// packages/ai/src/provider/provider-pool.ts:104
tpmLimit: Number(process.env[`AI_PROVIDER_${i}_TPM_LIMIT`] ?? 0),
```

```ts
// packages/ai/src/provider/tpm-window.ts:64-65
export function hasHeadroom(input: HeadroomInput): boolean {
  if (input.limit <= 0) return true;
```

`.env.example` sets `AI_PROVIDER_1_TPM_LIMIT=30000` (Cerebras, line 454) and
`AI_PROVIDER_2_TPM_LIMIT=8000` (Groq, line 513). Cloudflare (block starting line 526)
and Mistral (line 544) declare none.

**Why it hurts.** Three consequences, all of them live today:

1. Cloudflare and Mistral are never deprioritised for being saturated, so the pool
   fires into them at whatever rate the burst produces.
2. The 20% interactive reserve (`AI_INTERACTIVE_RESERVE_FRACTION=0.2`,
   `.env.example:561`) is computed inside `hasHeadroom` and therefore does not exist
   on those two. Since Cerebras is dead, the reserve today only shapes Groq.
3. Mistral's published limit is 1 request per second, a **request** limit. The pool
   counts tokens only: `ai:usage:<id>:<date>` (`provider-pool.ts:331`) and
   `ai:tpm:<id>:<bucket>` (`tpm-window.ts`). There is no request counter anywhere in
   `packages/ai`, so nothing can enforce an RPS or RPM ceiling. This also means Groq's
   30 RPM and 1,000 RPD are unenforced.

**Fix, minimal token bucket.** One Redis key per provider per second, incremented
before the call, checked against a configured `rpsLimit`:

```
key:   ai:rps:<providerId>:<unixSeconds>
op:    INCR then EXPIRE 2
rule:  if value > rpsLimit -> provider has no request headroom this second
```

Wire it into `pickProvider` next to `hasHeadroom` so it feeds `withHeadroom`, not
`available` (a request-limited provider is a rate problem, not a wall). Add
`AI_PROVIDER_N_RPS_LIMIT` and `AI_PROVIDER_N_RPM_LIMIT` and populate:
Mistral `RPS=1`, Groq `RPM=30`. Set `AI_PROVIDER_3_TPM_LIMIT` for Cloudflare from its
Neurons budget: 286k tokens/day on `gpt-oss-120b` spread over 1,440 minutes is about
200 tokens/minute sustained, which is not a useful per-minute cap, so the honest
Cloudflare limiter is the daily quota it already has plus the RPS bucket.

**Effort.** Half a day, including tests next to
`packages/ai/src/provider/tpm-window.test.ts`.
**Expected gain.** Removes the class of 429 that comes from us exceeding a request
limit rather than a token limit. Share of current 429s attributable to RPS is
**to measure** (see section 7, Q3).
**Risk.** Medium. A too-low bucket starves the pool. Ship it as deprioritisation only
(never as a hard skip), which is what `withHeadroom` already gives.

### R4. A saturated provider is still picked (Q2, Q5)

**Evidence.**

```ts
// packages/ai/src/provider/provider-pool.ts:316
const pool = withHeadroom.length > 0 ? withHeadroom : available;
```

The comment above it defends this: an estimate built on a character ratio "must never
be the sole reason a task fails". That is correct as a floor and wrong as a steady
state. Under the `:00` burst `withHeadroom` is empty for whole minutes, so the
fallback is not an exception, it is the normal path, and the pool goes back to
pre-pacing behaviour exactly when pacing was supposed to matter.

**Why it hurts.** The provider then answers 429 and is parked for 30-120 s
(`provider.ts:508`), and the 429 branch deliberately keeps the TPM booking
(`provider.ts:485-489`), so the saturated minute is charged twice: once for the tokens
that were never spent, once for the park.

**Fix.** Keep the fallback, but only for interactive calls and only when nothing has
headroom at any priority. For background calls, return `null` from `pickProvider` when
`withHeadroom` is empty, and let `callLLM` raise `AIUnavailableError` so the job
defers instead of burning a failover slot. That converts a guaranteed 429 into a
deferral, which is the outcome the deferral machinery exists for.

**Effort.** About 2 hours including the `pickProvider` signature already carrying
`interactive`.
**Expected gain.** Removes one 429 and one 30-120 s park per saturated pick.
Count of picks made from the `available` fallback is **to measure** (section 6, C4).
**Risk.** Low once R2 has fixed the deferral horizon. Shipping it before R2 would make
things worse.

### R5. The size estimate under-counts HTML by up to 2.4x (Q4)

**Evidence.**

```ts
// packages/ai/src/provider/provider-pool.ts:250-252
export function estimateRequestTokens(text: string, maxTokens: number): number {
  return Math.ceil(text.length / 4) + maxTokens;
}
```

The prune cap is `PRUNE_HTML_MAX_CHARS ?? 40000`
(`packages/scrapers/src/lib/prune-html.ts:3`), and `generate-extractor` sends the
pruned skeleton with `maxTokens: 1024`
(`packages/ai/src/tasks/generate-extractor.ts:91-100`). So the estimate for a
worst-case `generate_extractor` is `40000/4 + 1024 = 11,024` tokens. The measured
average prompt for that task is 12,296 tokens and the maximum is 24,308. Even the
**average** exceeds the ceiling the estimate can produce, and the maximum is 2.2 times
it.

**Why it hurts.** The estimate is the only input to `providersAcceptingSize`
(`provider-pool.ts:260-262`), which is described in the code as a wall:

```
// provider-pool.ts (comment above providersAcceptingSize)
// attempting it buys a guaranteed 413 and, worse, a wasted failover slot
```

Under-counting means a request that will 413 is still routed to a provider with a
ceiling, and it is booked into that provider's TPM window at the wrong size on the way
in. The code's own comment at `provider.ts:326` records the historical cost:
"430 such calls in a week, 198 of them generate_extractor against Groq's 8000-token
free ceiling with a ~12k prompt".

**maxTokens inventory** (every call site; unset means `callLLM` defaults to 1024 at
`provider.ts:328`):

| Task file | maxTokens | Tier |
|---|---|---|
| `tasks/extract-jobs.ts:68` | 8192 | smart |
| `tasks/mine-job-facts.ts:127` | 6144 | smart |
| `tasks/enrich-blog-posts.ts:173` | 4096 | smart |
| `tasks/score-overlap.ts:100` | 4096 | fast |
| `tasks/digest.ts:178` | 3072 | digest |
| `tasks/battle-card.ts:491,532` | 3072 | insights |
| `tasks/type-content-items.ts:110` | 3072 | smart |
| `tasks/extract-case-studies.ts:117` | 3072 | smart |
| `tasks/extract-pricing.ts:187` | 2048 | smart |
| `tasks/extract-entitlements.ts:75` | 2048 | smart |
| `faithfulness/extract-claims.ts:78` | 2048 | fast |
| `tasks/extract-reviews.ts:83` | 1536 | smart |
| `tasks/extract-ai-visibility.ts:76` | 1536 | smart |
| `tasks/name-competitors.ts:78` | 1500 | smart |
| `tasks/generate-extractor.ts:99` | 1024 | smart |
| `api/lib/ask/agent.ts:131` | 1024 | insights |
| `tasks/generate-visibility-prompts.ts:126` | 700 | smart |
| `tasks/competitor-summary.ts:99` | 512 | smart |
| `tasks/generate-calculator-spec.ts:57` | 512 | smart |
| `sectoral/formulate.ts:57` | 512 | insights |
| `tasks/summarize-source.ts:121` | 256 | smart |
| `tasks/batch-summary.ts:44` | 256 | smart |
| `tasks/match-alert-conditions.ts:89` | 256 | fast |
| `tasks/standing-query-judge.ts:82` | 256 | fast |
| `faithfulness/judge-claim.ts:84` | 256 | smart |
| `api/routes/signals.ts:495` | 240 | insights |
| everything routed through `groundedAiCall` with no `maxTokens` | 1024 (default) | varies |

Two of these are visibly inflated against their measured output. `extract_jobs`
averages 2,937 **total** tokens per run but reserves 8,192 output tokens, so
`estimateRequestTokens` books 8,192 phantom tokens into the TPM window and adds 8,192
to the size used for routing. With a 40,000-character page
(`tasks/extract-jobs.ts:25`, `MAX_PAGE_CHARS = 40000`) the routed size is
`10,000 + 8,192 = 18,192`, which excludes Groq permanently and over-books any provider
that has a TPM limit by roughly 6x the real cost. `mine_job_facts` reserves 6,144 for
a measured 5,435 total, which is closer but still reserves more output than the whole
call costs.

**Fix.**
1. Use a markup-aware divisor: `text.length / (looksLikeHtml ? 2.5 : 4)`. The cheapest
   detection is a `<` density check on the first 2,000 characters. This is a pure
   function with an existing test seam.
2. Reconcile the booking as soon as the reply lands, which the code already does
   (`provider.ts:450`), but also shrink the *initial* booking for tasks whose
   historical p95 output is far below `maxTokens`. Simplest version: book
   `ceil(chars/2.5) + min(maxTokens, 2048)` and let `reconcileTpm` correct upward.
3. Lower `extract-jobs` `maxTokens` from 8192 to 3072 and `mine-job-facts` from 6144 to
   4096. Both currently truncate silently into `markTruncated`
   (`provider.ts:456`), which is observable, so a regression is visible.

**Effort.** 1-2 hours.
**Expected gain.** Correct routing for the three largest tasks and an end to the
"430 oversized calls a week" class the code comment describes. Exact count today is
**to measure** (section 7, Q5).
**Risk.** Low for (1) and (2). (3) risks truncation on very long job boards; the
truncation flag makes it detectable within a day.

### R6. Priority order is fixed and not size-aware (Q5)

**Evidence.** `loadProviders` sorts once by `priority`
(`provider-pool.ts:134`), and `pickProvider` keeps only the best available priority:

```ts
// packages/ai/src/provider/provider-pool.ts:320-322
const bestPriority = pool[0]!.priority;
const topTier = pool.filter((p) => p.priority === bestPriority);
```

Every provider in `.env.example` has a distinct priority (1, 3, 2, 4 for cerebras,
groq, cloudflare, mistral), so `topTier.length === 1` always and the round-robin at
`provider-pool.ts:324-325` never runs.

**Why it hurts.** "Smallest capable provider first" is not expressible. The pool
always tries priority 1 regardless of whether the request is a 300-token
`source_summary` or a 24,000-token `generate_extractor`. In the current state that
means every call first hits a Cerebras account that answers 402 for the ten minutes
after each breaker expiry, and small calls that Groq could serve for free (its cached
tokens are exempt from its rate limits) get routed by priority rather than by fit.

**Fix.** Make the ordering a score rather than a constant. In `pickProvider`, sort the
`withHeadroom` set by `(priority, maxRequestTokens ascending)` so that among providers
that can serve a request, the tightest one goes first and the roomiest is kept in
reserve for the requests that need it. A one-line comparator change; `providersAcceptingSize`
already guarantees correctness.

Separately: park an `out_of_credit` provider for far longer than 600 s. A 402 is a
billing state, not a transient fault.

```ts
// suggested, in provider.ts around :509
const OUT_OF_CREDIT_PARK_SEC = 6 * 3600;
await tripBreaker(provider.id, "out_of_credit", OUT_OF_CREDIT_PARK_SEC);
```

**Effort.** 1 hour.
**Expected gain.** About 144 wasted Cerebras round trips per day removed, plus the
failover slot each one consumes. Token gain is near zero (a 402 returns no usage), the
gain is in attempts and latency.
**Risk.** Low. A six-hour park delays recovery after a top-up; make the value an env
var so it can be cleared by hand.

### R7. One provider's failure can trip the global breaker (Q6)

**Evidence.** Two distinct paths.

*Path A, the threshold.* `recordFailure()` is called once per exhausted task
(`provider.ts:576`), into a 600 s rolling window with threshold 5
(`circuit-breaker.ts`). When only one provider is pickable (Cerebras breakered,
Cloudflare over quota, Groq parked), `maxAttempts = eligible.length` is 1
(`provider.ts:346`), so a single 429 from the one remaining provider exhausts the task.
Five of those in ten minutes, which at 12-22 calls/minute is a few seconds, opens the
global breaker.

*Path B, no threshold at all.* If every provider that answers returns 402,
`classifyExhaustion` returns `out_of_credit` and the global breaker opens on the first
task:

```ts
// packages/ai/src/provider.ts:549-550
if (exhaustion === "out_of_credit") {
  await tripGlobalBreaker("ai_out_of_credit");
```

With Cerebras 402-ing at 100% and Cloudflare skipped for quota, an evening in which
Groq and Mistral are both parked leaves a pool where the only provider that *answers*
is Cerebras, and it answers 402. That is a one-call workspace blackout.

**Why it hurts.** The global breaker is workspace-wide and 600 s long. It is also what
drives the customer-facing banner (`apps/api/src/routes/system.ts:39`, `"down"`).

**Fix.**
1. `AI_CIRCUIT_BREAKER_THRESHOLD` 5 -> 20, matching the current call volume.
2. Require `out_of_credit` to be observed across at least two distinct providers before
   it trips the global breaker. `classifyExhaustion` already receives the flags; it
   needs a count, not a boolean.
3. Do not count a task as a global failure when `eligible.length === 1`. A pool with
   one provider left is already degraded; failing that one call is not new information.

**Effort.** 2 hours.
**Expected gain.** Removes the workspace blackout as an amplifier. Number of global
breaker trips per day is **to measure** (section 6, C2: nothing logs it to a queryable
store today, only Slack).
**Risk.** Low. The breaker still fires on a genuine all-provider outage; it just needs
more evidence.

### R8. The interactive path is not protected (Q7)

**Evidence.** Exactly two call sites mark a call interactive:

```
apps/api/src/lib/ask/agent.ts:81       interactive: true,
apps/api/src/routes/signals.ts:504     }, { interactive: true });
```

Everything else the user waits on runs as background: the battle card
(`apps/workers/src/core/generate-battle-card.ts`, a queued job), a manual re-scan, and
both onboarding legs (`nameKnownCompetitors`, `scoreOverlap` at
`apps/api/src/routes/onboarding.ts:537,560`).

And the reserve those two sites buy is inert on the providers that carry the load,
because `hasHeadroom` returns early when `limit <= 0`
(`packages/ai/src/provider/tpm-window.ts:65`) and neither Cloudflare nor Mistral has a
`TPM_LIMIT`.

Finally, `interactive` is not consulted at all by the global breaker: the check at
`provider.ts:319-320` is the first statement in `callLLM` and has no exemption.

**Why it hurts.** During a blackout the user gets
`"AI generation is temporarily unavailable. Try again shortly"`
(`apps/api/src/routes/battle-cards.ts:570`), which is honest but is exactly the outcome
the reserve was built to prevent. The onboarding path is the worst case: about 30k
tokens for one competitor, 46% of it `generate_extractor`, at the moment a new user is
deciding whether the product works.

**Fix.**
1. Set `AI_PROVIDER_3_TPM_LIMIT` and `AI_PROVIDER_4_TPM_LIMIT` so the reserve exists at
   all (see R3 for the values).
2. Wrap the onboarding discovery legs and the battle-card API entry point in
   `withAiContext(fn, { interactive: true })`.
3. Let an interactive call bypass the *global* breaker for one attempt against the
   highest-priority provider that is not individually breakered. The breaker exists to
   stop a stampede of background jobs; a person clicking a button is not a stampede.

**Effort.** 2-3 hours.
**Expected gain.** Interactive success during a degraded window. Current interactive
failure rate is **to measure**: `nameKnownCompetitors` and `scoreOverlap` are not
logged to `ai_runs` at all (they run through `withAiCache` at
`apps/api/src/routes/onboarding.ts:528` with no `loggedAi` wrapper), so onboarding
spend and onboarding failures are both invisible today.
**Risk.** Medium for (3): it reopens a path to the provider during an outage. Bound it
to one attempt and to calls whose `estimateRequestTokens` is under 4,000.

### R9. Aggregate concurrency is unbounded (Q2)

**Evidence.** `workOptions` per queue:

```ts
// packages/queue/src/boss.ts:292-293
batchSize: 1, // one job per fetch; parallelism comes from localConcurrency
notifyPollingIntervalSeconds: 2,
```

and `...(config.concurrency ? { localConcurrency: config.concurrency } : {})`, with the
pg-boss default of 1 when unset (`docs/audits/2026-08-16/REPORT.md:705`, `:1111`).

Twenty-four AI-bearing handlers (listed in section 2), of which six declare a
concurrency: `scrape-monitor` 3, `verify-signal-delta` 2, `generate-battle-card` 2,
`refresh-competitor-summary` `SUMMARY_CONCURRENCY ?? 1` (but `.env.example` sets 3),
`classify-change` 1, `generate-signal` 1. Every other AI queue runs at 1.

**Why it hurts.** Per-queue serialisation is not pool serialisation. The lower bound on
simultaneous in-flight LLM calls from the workers alone is about 22, plus whatever the
API is doing, and nothing in `packages/ai` counts concurrent calls. The per-queue
`concurrency: 1` comments in `packages/queue/src/jobs.ts:231,236` describe this as a
"groq lane (global serialization)", which was true when Groq was the only provider and
is not true now.

**Fix.** One process-wide semaphore in `packages/ai/src/provider.ts`, around the
`callLLM` attempt loop, sized from `AI_MAX_CONCURRENT_CALLS` (suggest 4). It is a
counter and a queue of promises, roughly 20 lines, and it belongs in the pool because
that is the only place that sees every caller. Combined with R3's RPS bucket it gives
the pool an actual admission control.

**Effort.** Half a day with tests.
**Expected gain.** Caps the instantaneous demand that produces the 429 storms.
Current maximum concurrent calls is **to measure** (section 6, C3).
**Risk.** Medium. Too small a semaphore turns a token problem into a latency problem
and pushes jobs into `expireInSeconds` (120 s for `classify-change` and
`generate-signal`, `packages/queue/src/jobs.ts:231,236`). Start at 4 and watch the
expiry rate.

### R10. Error classification is coarse and partly wrong (Q3)

**Evidence.**

```ts
// packages/ai/src/provider.ts:101-105
s === 429 || s === 413 || s === 401 || s === 402 || s === 403 || s === 404 || s >= 500
```

Four issues:

1. **404 is treated as a config error.** `isConfigError` covers 401/403/404
   (`provider.ts:135-139`). A 404 on an OpenAI-compatible endpoint is usually a wrong
   model name, not a wrong key, and Mistral ships with an empty `AI_PROVIDER_4_MODEL`
   in `.env.example:547`, which `loadProviders` turns into the literal string
   `"llama-3.3-70b"`:

   ```ts
   // packages/ai/src/provider/provider-pool.ts:99
   model: process.env[`AI_PROVIDER_${i}_MODEL`]?.trim() || "llama-3.3-70b",
   ```

   Any environment copied from `.env.example` sends `llama-3.3-70b` to Mistral, gets a
   404, and the pool reads it as "misconfigured", which trips the **global** breaker
   with no threshold (`provider.ts:538`). Production evidently sets the value, since
   Mistral serves 234-720k tokens/day, but the example file ships a landmine.

2. **429 is a "transient" error, and transient outranks everything** in
   `classifyExhaustion` (`provider.ts:218-238`). So a rate limit and a 502 are the same
   signal to the global breaker, even though the first is self-healing on a timer and
   the second is not.

3. **`ai_out_of_credit` is deferrable.** `resolveAiDeferral` excludes only
   `ai_provider_misconfigured` and `ai_request_too_large`
   (`apps/workers/src/queue/ai-deferral.ts:37,39`). An out-of-credit pool has just
   opened a 600 s global breaker, so deferring for 75-105 s is guaranteed to fail, three
   times.

4. **`ai_empty_completions` is deferrable too**, and it is a property of the request
   (the code says so at `provider.ts:566-568`), so it will reproduce identically.

**Why it hurts.** Each misclassification costs a full retry ladder. Items 3 and 4 are a
direct source of the 295-491 error rows/day.

**Fix.** In `resolveAiDeferral`, return `null` for `ai_empty_completions`, and for
`ai_out_of_credit` return the breaker's remaining TTL rather than the base. Separate
429 from 5xx in `classifyExhaustion` and count only 5xx toward the global breaker.
Split 404 out of `isConfigError` into its own `wrong_model` kind that parks the
provider without implying the whole pool is misconfigured.

**Effort.** 2-3 hours.
**Expected gain.** Removes three wasted attempts per affected task. Share of error rows
in each class is **to measure**: `ai_runs` has no error-kind column (section 6, C1).
**Risk.** Low.

---

## 4. Efficiency findings

### E8. The change pipeline is four sequential AI calls per change (Q8)

**Evidence.** The chain, in order:

1. `classify-change` runs `cosmetic_gate` when the change is unstructured and the
   source type qualifies (`apps/workers/src/core/classify-change.ts`, `classificationFast`),
   then either `classify_structured` (smart) or `classify` (fast).
2. On significance it enqueues `generate-signal`.
3. `generate-signal` runs `insight` (`generate-signal.ts:425-427`), optionally
   `narrate_change` (`:514`), and optionally `faithfulness_check` (`:561`).
4. `faithfulness_check` is itself 1 + up to 12 calls (see E11).

So one significant homepage change costs at minimum `cosmetic_gate` + `classify` +
`insight` = three calls, and up to `cosmetic_gate` + `classify_structured` + `insight` +
`narrate_change` + 13 faithfulness calls = 17 calls. Combined per-day volume for the
first three tasks is 61.9 + 48.0 + 32.3 = 142 calls/day, 46% of all successful calls.

**Merge opportunities.**

- `cosmetic_gate` and `classify` are both fast-tier, both read the same
  `truncateDiffText(diffText, 8000)` slice (`tasks/cosmetic-gate.ts:71`,
  `tasks/classify.ts:193`), and both are cached under
  `AI_CACHE_TTL_CLASSIFY_DAYS`. They can be one call returning
  `{ cosmetic: boolean, ...classification }`. Saves 32.3 calls/day and 32.3 x 1,014 =
  33k prompt tokens/day, because the gate's prompt is nearly the whole cost of the gate.
- `narrate_change` reads `structuredDiff`, which `classify_structured` has already been
  shown (`tasks/classify-structured.ts:84`, the same
  `renderForPrompt(changes).slice(0, 8000)`). Merging them saves a second full prompt of
  the same content.

**Reorder opportunity.** The cosmetic gate runs before the classifier and its measured
job is to suppress about 10% of changes (prior audit: 58 of 607). A cheap lexical
similarity check on `humanChangeBefore` / `humanChangeAfter` would suppress most of the
same changes for zero tokens, leaving the LLM gate for the ambiguous middle.

**Effort.** Merging gate and classify: about a day, mostly prompt and schema work.
**Expected gain.** 33k tokens/day from the gate merge (3.6% of the healthy daily total)
plus 32.3 fewer calls/day, which matters more than the tokens under a 30 RPM ceiling.
**Risk.** Medium. The gate "fails open" today; a merged call that parse-misses would
lose both decisions at once. Keep the fail-open on the merged shape.

### E9. Why `ai_fallback` beats `cache` in the extraction ladder (Q9)

Healthy window: `ai_fallback` 354, `structured` 278, `cache` 159, `heal` 60. The
cache path, which is the whole point of the ladder, is the third most common outcome.

**Evidence.** Three code paths conspire.

1. **A failed heal poisons the domain permanently.** `stampHealAttempt` writes a row
   with `lastValidatedAt: null`:

   ```ts
   // apps/workers/src/lib/staged-extract.ts:287
   lastValidatedAt: null,
   lastHealAttemptAt: now,
   ```

   and `shouldTrustCachedExtractor` refuses any such row:

   ```ts
   // apps/workers/src/lib/extractor-trust.ts:38
   if (input.lastValidatedAt == null) return false;
   ```

   So the very first failed heal for a `(domain, sourceType)` guarantees that this pair
   can never resolve as `cache` again until a heal succeeds.

2. **The 12-hour cooldown then blocks the heal that would fix it.**
   `HEAL_COOLDOWN_MS` is `EXTRACTOR_HEAL_COOLDOWN_HOURS ?? 12` hours
   (`staged-extract.ts`, `.env.example:260`), and `shouldAttemptHeal` returns false
   inside it (`apps/workers/src/lib/heal-cooldown.ts:45`). A weekly monitor therefore
   never has a cooldown problem, but a daily or realtime one spends most of its runs
   with the heal blocked. During that window step 4 always pays:

   ```ts
   // apps/workers/src/lib/staged-extract.ts:110-118
   const runFallback = async (): Promise<T | null> =>
     validateSchema(await loggedAi(input.aiFallbackTask, AI_CONFIG.classification, ...))
   ```

3. **Working caches expire on a timer.** `EXTRACTOR_REVALIDATE_INTERVAL_DAYS ?? 14`
   (`.env.example:282`) skips a cached spec purely on age, and `lastValidatedAt` is
   stamped only by `upsertExtractor`, never by a successful replay
   (`extractor-trust.ts:17-20` states this deliberately). So a parser that has replayed
   correctly every day for two weeks is thrown away and re-generated.

**Why it hurts.** Each of these routes a page to `ai_fallback` at smart-tier cost.
`extract_pricing` averages 3,577 tokens and `extract_jobs` 2,937, against a `cache`
resolution that costs zero.

**Fix.**
1. Do not write a row at all when the heal produced nothing usable, or write it with a
   distinct `heal_failed_at` column so `lastValidatedAt: null` keeps meaning "unknown
   provenance" rather than "we tried once and failed".
2. Make the revalidation age-based **and** success-aware: reset the clock on a
   successful replay, or raise `EXTRACTOR_REVALIDATE_INTERVAL_DAYS` to 60 and rely on
   `consecutiveFailures` for drift detection, which is what it is for.
3. Back off the heal cooldown exponentially per domain: 12 h, then 48 h, then 7 days.

**Effort.** Half a day plus a migration for (1).
**Expected gain.** Shifting even half of the 354 `ai_fallback` runs to `cache` saves
roughly 177 x 3,200 = 566k tokens over the 16-day healthy window, about 35k tokens/day.
Exact split by `sourceType` is **to measure** (section 7, Q9).
**Risk.** Low. A stale parser is caught by `consecutiveFailures >= 5`
(`extractor-trust.ts:36`, `EXTRACTOR_MAX_CONSECUTIVE_FAILURES=5`).

### E10. The four largest prompts are uncapped or capped too high (Q10)

| Task | Cap in code | Avg prompt (prod) | p95 | Max |
|---|---|---|---|---|
| `generate_extractor` | `PRUNE_HTML_MAX_CHARS = 40000` (`prune-html.ts:3`) | 12,296 | 16,869 | 24,308 |
| `faithfulness_check` | 12,000 chars per call, 1 + 12 calls (`extract-claims.ts:30`, `judge-claim.ts:26`, `verify.ts:27`) | 3,583 | 13,422 | 47,502 |
| `enrich_blog_posts` | `MAX_POST_CHARS = 6000` per post (`enrich-blog-posts.ts:84`), no cap on post count | 5,729 | 13,616 | 13,944 |
| `mine_job_facts` | `MAX_JD_CHARS = 4500` per description (`mine-job-facts.ts:54`), no cap on count | 4,286 | 10,038 | 10,521 |

**`generate_extractor`.** `prune-html.ts` documents the answer itself: "Every page
whose parser ever validated has under 21k of text; the ones that come back empty run
to 940k." The 40,000-character skeleton is therefore well above the size at which the
task succeeds. Cutting `PRUNE_HTML_MAX_CHARS` to 21,000 keeps every page that has ever
produced a working parser (the comment's own bound) and drops the ones that never do.
16,000 is the aggressive setting: it also cuts the validated pages between 16k and 21k.
Either is an env change with no code edit.

**Gain.** At 21,000 the prompt falls from about 12,296 to about 6,450 tokens, so
5,840 x 23.1 = 135k tokens/day, 14.6% of the healthy daily total. At 16,000 it is about
4,900 tokens and 171k/day (18.5%), paid for with some pages that used to validate.

**`faithfulness_check`.** The p95 and max are not one prompt: `loggedAi` wraps the whole
chain (`apps/workers/src/lib/faithfulness-gate.ts:62`) and `consumeUsage` sums every
`complete()` in the scope (`provider-context.ts:181`). The chain is one extraction
call plus up to `MAX_JUDGE_CALLS = 12` sequential judge calls
(`packages/ai/src/faithfulness/verify.ts:27,93-101`), each carrying up to 12,000
characters of source. That is up to 13 pool round trips inside one job, back to back,
which is 43% of Groq's 30 RPM budget from a single signal.

**Fix.** Lower `MAX_JUDGE_CALLS` to 5 and `SOURCE_CHARS` in `judge-claim.ts` to 4,000
(the judge rules on one claim; it does not need the whole diff). Batch the remaining
judges into one call that rules on up to 5 claims at once, which turns 13 round trips
into 2.

**`enrich_blog_posts` and `mine_job_facts`.** Both cap the per-item text and neither
caps the item count, so the prompt grows linearly with how much the competitor
published. Add a hard item cap (10 posts, 8 job descriptions) and process the rest on
the next run.

**Effort.** `PRUNE_HTML_MAX_CHARS` is 5 minutes. The faithfulness batching is about a
day. The item caps are an hour each.
**Expected gain.** 135k to 171k tokens/day from the prune cap alone (14.6% to 18.5%),
plus 11 fewer pool requests per gated signal.
**Risk.** Medium for the prune cap: fewer pages will yield a parser. The counter-argument
is in the file's own comment, and `extraction_runs.resolution` makes a regression visible
within a day.

### E11. Parse failures cost a full second call, and JSON mode is half-configured (Q11)

**Evidence.**

- `groundedAiCall` parses the citation envelope, falls back to the bare schema, and
  returns `null` on a miss (`packages/ai/src/grounding/grounded-call.ts`, `run()`).
  It does **not** re-call. Good.
- But the *caller* does. `generate-signal.ts:469-472`:

  ```ts
  logger.error("Insight returned null (parse failed) — retrying", ...);
  throw new Error("Insight returned null (parse failed)");
  ```

  A plain throw means pg-boss re-runs the whole job, which re-pays `insight` (1,525
  tokens) and, on a structured change, everything before it. `classify-change` does the
  same via `retriableClassifyError`. With `retryLimit: 2` a persistent parse miss costs
  three full generations.
- `loggedAi` records this as `parse_failed`, not `error`
  (`apps/workers/src/lib/analytics.ts:317`), so the retry cost is invisible in the error
  count.
- Constrained decoding exists and is off. `JSON_SCHEMA_TASKS` covers only
  `generate_signal` and `narrate_change` (`grounding/grounded-call.ts`), and even those
  require the provider to opt in:

  ```ts
  // packages/ai/src/provider.ts:418
  ...(options.jsonSchema && provider.supportsJsonSchema
  ```

  ```ts
  // packages/ai/src/provider/provider-pool.ts:107
  supportsJsonSchema: process.env[`AI_PROVIDER_${i}_JSON_SCHEMA`] === "true",
  ```

  `.env.example` has the only occurrence commented out (`# AI_PROVIDER_1_JSON_SCHEMA=true`,
  line 469). So `response_format: { type: "json_schema" }` never fires anywhere, and
  every JSON task falls back to `{ type: "json_object" }` (`provider.ts:430`).

**Fix.**
1. Set `AI_PROVIDER_2_JSON_SCHEMA=true` and `AI_PROVIDER_3_JSON_SCHEMA=true` (Groq and
   Cloudflare both serve `gpt-oss` with json_schema support; verify with the boot probe
   in `checkProviderModels`, `provider-pool.ts:155`, before enabling in prod).
2. Extend `JSON_SCHEMA_TASKS` to the tasks with the highest parse-miss rates. Which
   those are is **to measure**: `SELECT task, count(*) FILTER (WHERE status='parse_failed')::float / count(*) FROM ai_runs GROUP BY task`.
3. Replace the bare `throw` on a parse miss with one bounded re-call at a lower
   temperature inside the same job, so the retry does not re-pay the upstream calls.

**Effort.** (1) is 10 minutes plus a canary. (2) is an hour. (3) is half a day.
**Expected gain.** Directly proportional to the parse-miss rate, **to measure**.
**Risk.** Low for (1) and (2). `json_schema` on a provider that lies about supporting
it returns 400, which `shouldFailover` does not retry (`provider.ts:105`), so it fails
fast and loudly. That is why it must be canaried per provider.

### E12. Prefix caching covers 8 tasks out of about 30 (Q12)

**Evidence.** Every site passing a byte-stable `system:`:

```
packages/ai/src/tasks/generate-extractor.ts:96   system: EXTRACTOR_SYSTEM[kind]
packages/ai/src/tasks/cosmetic-gate.ts:79        system: GATE_SYSTEM
packages/ai/src/tasks/extract-pricing.ts:184     system: EXTRACT_PRICING_SYSTEM
packages/ai/src/tasks/classify.ts:210            system: CLASSIFY_SYSTEM
packages/ai/src/tasks/extract-jobs.ts:65         system: EXTRACT_JOBS_SYSTEM
packages/ai/src/faithfulness/judge-claim.ts:81   system: JUDGE_SYSTEM
packages/ai/src/tasks/competitor-summary.ts:95   system: SUMMARY_SYSTEM
packages/ai/src/faithfulness/extract-claims.ts:75 system: EXTRACT_SYSTEM
packages/ai/src/grounding/grounded-call.ts:222   system passthrough
```

The prefixes that exist are correctly built: `generate-extractor.ts:56-85` builds two
byte-identical strings at module load precisely so nothing request-specific can leak in,
and the comment explains why. That is the right pattern.

**Missing, ranked by tokens/day:** `insight` (48.0 calls x 1,134 prompt = 54k/day),
`digest`, `battle_card` + `battle_card_revise` + `battle_card_repair` (3.4 calls/day but
7,776 / 5,079 / 4,838 tokens each), `classify_structured` (8.7 x ~1,700),
`mine_job_facts` (5.0 x 4,286), `enrich_blog_posts` (3.8 x 5,729),
`extract_entitlements` (7.7), `source_summary` (39.9 x 305).

**Why it matters specifically.** Groq exempts cached tokens from its rate limits. Every
token moved into a stable prefix is a token that does not count against 8k TPM or 200k
TPD. For `insight` at 48 calls/day, a stable 600-token system prefix removes 29k
tokens/day from Groq's budget for free.

**Fix.** Mechanical: for each task, split the prompt into the invariant instruction
block and the per-call evidence, hoist the first into a module-level `const`, pass it as
`system`. `groundedAiCall` already forwards `params.system`, so tasks routed through it
need no plumbing.

**Cache-hit measurement.** Prefix cache hits are **to measure**. Neither
`markUsage` nor `logAiRun` records `prompt_tokens_details.cached_tokens`, which the
OpenAI-compatible response carries. Adding it to `TokenUsage`
(`provider-context.ts:26-30`) and to `ai_runs` is the only way to know whether the
prefixes actually hit.

**Effort.** About 20 minutes per task, 8 tasks worth doing.
**Expected gain.** Up to 90k tokens/day removed from rate-limit accounting on Groq,
**to measure** for the actual hit rate.
**Risk.** Very low. A prefix that fails to match costs nothing extra.

### E13. Fast-tier coverage is a minority (Q13)

**Evidence.** 17 `AI_CONFIG.classificationFast` references against about 40
`AI_CONFIG.classification` ones, and `AI_CONFIG` itself has only four entries
(`packages/ai/src/config.ts`): `classification` (smart), `classificationFast`,
`insights`, `digest`. `insights` and `digest` have no `tier`, so they resolve to smart.

Fast today: `cosmetic-gate`, `classify`, `match-alert-conditions`,
`standing-query-judge`, `score-overlap`, `faithfulness/extract-claims`, plus their
worker call sites and both `ask/agent` legs.

**Smart-tier tasks that should move.**

| Task | Calls/day | Avg tokens | Why it can move |
|---|---|---|---|
| `faithfulness_check` judge | 18.2 chains, up to 12 calls each | 4,389/chain | `judge-claim.ts:80` uses `AI_CONFIG.classification`. The choice is deliberate and documented at `apps/workers/src/lib/faithfulness-gate.ts:22-25`, so this is a design change to argue, not a bug. The argument: the judge answers a yes/no on one claim against 12k of source, and it runs up to 12 times per chain. |
| `source_summary` | 39.9 | 412 | 256 output tokens, 305-token prompt. There is no reasoning here. |
| `extract_pricing` | 13.1 | 3,577 | Structured extraction from a focused 12,000-char slice (`MAX_PRICING_TEXT`). |
| `extract_jobs` | 11.1 | 2,937 | Same shape. |
| `extract_entitlements` | 7.7 | 3,515 | Same shape. |

**Why it matters.** Cloudflare's 10,000 Neurons/day buy roughly 286k tokens on
`gpt-oss-120b` and 528k on `gpt-oss-20b`. Cloudflare currently runs at 254-270k/day,
that is at its cap. Moving the five tasks above to fast moves 18.2 x 4,389 + 39.9 x 412
+ 13.1 x 3,577 + 11.1 x 2,937 + 7.7 x 3,515 = about 200k tokens/day of demand from the
expensive model to the cheap one, which is most of the way to doubling Cloudflare's
effective daily ceiling.

**Fix.** Change the config reference at each site. `judge-claim.ts:80` first, because it
is the largest single block of smart-tier calls in the system.

**Effort.** An hour, plus an eval run per task
(`packages/ai/src/eval/*`, the `eval:*` scripts, which hit real providers and are not
part of the suite).
**Expected gain.** +242k tokens/day of Cloudflare headroom at the same Neuron spend.
**Risk.** Medium. Quality on `extract_pricing` in particular is worth an eval before and
after. `faithfulness_check` has a natural guard: a fast judge that gets stricter shows up
immediately as a rise in `blocked` verdicts in the log line at
`apps/workers/src/lib/faithfulness-gate.ts:87`.

### E14. Duplicate and wasted work (Q14)

**The content-hash short-circuit is correctly placed.** Verified:

```ts
// apps/workers/src/core/scrape-monitor.ts:1062
if (!input.force && lastSnapshot && lastSnapshot.contentHash === newHash) {
```

returns at `:1158` (`return { changed: false, snapshotId: lastSnapshot.id };`) which is
before every AI-bearing enqueue: `classifyChange.enqueue` at `:1876`, `:2151`, `:2404`,
`extractPricing.enqueue` at `:2489`, `extractJobs.enqueue` at `:2521`. `scrape-monitor`
makes no `complete()` call of its own. **No LLM call is paid on an unchanged page.**

One caveat: the unchanged branch still enqueues catch-up ingests
(`ingestBlogPosts`, `ingestContentItems`, `ingestAudiencePages`,
`ingestNamedCompetitors`, `ingestCaseStudies`, `ingestIntegrations`, lines 1074-1131),
and several of those do call the model. They are each gated on their own one-shot
marker, so they fire once per competitor, but a re-scan storm on a competitor whose
markers are unset would fan out. Worth a counter, not a fix.

**The actual duplicates.**

1. **A failed heal pays twice on the same page.** `staged-extract.ts:196` runs
   `generate_extractor` (12,296 tokens), and when the resulting spec does not replay the
   code falls through to `runFallback()` at step 4 (`:110`) which pays the smart-tier
   extraction on the same HTML. About 84% of heals end this way (60 successful heals
   against 23.1 generations/day over 16 days), so the dominant `generate_extractor`
   outcome is a double charge.
2. **A parse miss re-runs the whole job** (see E11).
3. **The Cerebras re-probe**: 144 wasted round trips per day (see R6).
4. **Onboarding is unmeasured**: `nameKnownCompetitors` and `scoreOverlap` run through
   `withAiCache` at `apps/api/src/routes/onboarding.ts:528-560` with no `loggedAi`, so
   about 30k tokens per onboarded competitor, 46% of it `generate_extractor`, never
   reaches `ai_runs`. The capacity document's per-task table is therefore an
   **undercount** by the onboarding volume.

**Fix for (1).** Skip `runFallback` when the heal itself just failed with an
`AIUnavailableError` (that path already calls `pauseHealsAfterPoolFailure`,
`staged-extract.ts:221`, so the fallback will fail too). And when the heal produced a
spec that did not replay, prefer the fallback but do not re-generate on the next run:
that is E9's cooldown backoff.

**Effort.** 2 hours.
**Expected gain.** Removing the double charge on the failing 84% of heals is bounded
above by 19.4 calls/day x 3,577 (the `extract_pricing` fallback cost) = 69k tokens/day.
**Risk.** Low.

### E15. The cheapest way to spread the burst (Q15)

Ranked by cost to implement:

1. **`startAfter` in `enqueueMany`** (R1). 30 minutes, no new infrastructure, no new
   Redis keys. This alone flattens the peak minute by roughly 50x.
2. **Randomise `computeNextRun`.** Add `+ Math.random() * 0.1 * interval` at
   `packages/shared/src/scheduling.ts:37`. Ten minutes of work, and it makes the
   dispersion permanent instead of re-applied every hour. Do both: (1) fixes today's
   population, (2) stops it re-forming.
3. **Move the two `:00` crons apart.** `generate-daily-digest` does not need to share a
   minute with `schedule-scraping`; `"7 * * * *"` costs nothing. Five minutes.
4. **The semaphore** (R9), which bounds the burst rather than spreading it. Half a day.
5. **Per-provider RPS buckets** (R3), which shape it. Half a day.

The first three together are under an hour and address the measured 67%/48% window
directly.

---

## 5. Action plan

### Wave 1: today, under one hour

| # | Step | Check |
|---|---|---|
| 1 | `.env` on the queue box: `AI_CIRCUIT_BREAKER_RESET_MIN=2`, `AI_CIRCUIT_BREAKER_THRESHOLD=20`, `AI_DEFER_BASE_SEC=150`, `AI_DEFER_JITTER_FRACTION=0.6`, `QUEUE_MAX_DEFERRALS=5`. Restart the workers. | `ai_runs` error rows in the `:05-:14` window over the next 24 h, against today's 195 calls at 86% failure. |
| 2 | `.env`: `PRUNE_HTML_MAX_CHARS=21000` (16000 only if the `heal` share holds). | `SELECT avg(prompt_tokens) FROM ai_runs WHERE task='generate_extractor' AND recorded_at > now() - interval '24 hours'`. Expect roughly 6,450, down from 12,296. Then check `extraction_runs` for a drop in `heal` resolutions. |
| 3 | `.env`: add `AI_PROVIDER_3_TPM_LIMIT` and `AI_PROVIDER_4_TPM_LIMIT` so the interactive reserve exists. Suggested starting values: Cloudflare 6000, Mistral 8000, both to be tuned. | `redis-cli GET ai:tpm:cloudflare:<minute>` is non-empty during the next `:00` burst. |
| 4 | Move `generate-daily-digest` to `"7 * * * *"` in `packages/queue/src/jobs.ts:504`. Note that `syncSchedules` reconciles on boot (`jobs.ts:533`), so a restart applies it. | `SELECT name, cron FROM pgboss.schedule`. |
| 5 | Change `packages/ai/src/faithfulness/judge-claim.ts:80` from `AI_CONFIG.classification` to `AI_CONFIG.classificationFast`. This overrides the deliberate choice documented at `faithfulness-gate.ts:22-25`, so revert if quality moves. | `SELECT model, count(*) FROM ai_runs WHERE task='faithfulness_check' GROUP BY model` shows `gpt-oss-20b`. Then watch the `blocked` count in the worker log line at `faithfulness-gate.ts:87`. |

**Status, 2026-09-03 evening.** Steps 1 to 3 are live on the worker box: written to
`/opt/outrival/.env.worker` (timestamped backup kept next to it) and both workers
recreated. Mistral got `AI_PROVIDER_4_TPM_LIMIT=60000` rather than 8,000: its
published limit is 1 request/second, which the pool cannot count, and 60k TPM at
~3.3k tokens per call keeps the fleet near 0.25 req/s while leaving 12k/min to the
interactive reserve. Step 4 is in the branch and ships with the next worker image
(`docker compose pull && docker compose up -d` after merge). Step 5 was NOT applied:
`judge-claim.ts:70-78` records a measured regression on the fast model (5/6 invented
claims rejected against 6/6 on the 120b), which is the exact failure the gate exists
to stop, so that swap is a product decision, not a tuning. Cerebras was already
disabled on the worker box (empty `AI_PROVIDER_1_API_KEY` since 2026-09-02 17:36) but
is still configured at priority 1 on the api (Coolify), which also has none of the
breaker or TPM variables above; the api env is Mathys's console, listed in the
handover.


Steps 1 to 4 are env and config only. Step 5 is a one-word code change that also fixes a
documented contradiction.

### Wave 2: this week, up to two days

| # | Step | Check |
|---|---|---|
| 1 | `startAfter` spread in `schedule-scraping.ts:173` plus a shuffle, and the jitter in `computeNextRun`. | `SELECT date_trunc('minute', recorded_at), count(*), sum(total_tokens) FROM ai_runs GROUP BY 1 ORDER BY 3 DESC LIMIT 10`. Expect the top minute under 10k tokens, down from 123k. |
| 2 | Fix the `lastValidatedAt: null` poisoning (`staged-extract.ts:287` + `extractor-trust.ts:38`) and add the exponential heal backoff. | `SELECT mode, count(*) FROM extraction_runs WHERE recorded_at > now() - interval '7 days' GROUP BY 1`. Expect `cache` to overtake `ai_fallback`. |
| 3 | Add `error_kind` and `attempts` to `ai_runs` and populate from `AIUnavailableError` (see section 6). | `SELECT error_kind, count(*) FROM ai_runs WHERE status='error' GROUP BY 1`, which is the query that does not exist today. |
| 4 | Process-wide semaphore in `provider.ts` at `AI_MAX_CONCURRENT_CALLS=4`. | Job expiry rate: `SELECT name, count(*) FROM pgboss.job WHERE state='failed' AND output::text ILIKE '%expire%'`. Must not rise. |
| 5 | Move `source_summary`, `extract_pricing`, `extract_jobs`, `extract_entitlements` to `classificationFast`, one per day, with an eval run each. | `SELECT provider, sum(total_tokens) FROM ai_runs WHERE recorded_at::date = current_date GROUP BY 1` and Cloudflare's Neuron dashboard. |

### Wave 3: later

1. Per-provider request buckets (`ai:rps:<id>:<sec>`) and `AI_PROVIDER_N_RPS_LIMIT`.
   Mistral's 1 req/s is unenforceable without it.
2. Merge `cosmetic_gate` into `classify` as one fast call, with a lexical pre-filter in
   front of both.
3. Batch the faithfulness judge: `MAX_JUDGE_CALLS` 12 -> 5, and one call ruling on up to
   5 claims. 13 round trips become 2.
4. Prefix-cache the eight uncovered tasks, starting with `insight`, and record
   `cached_tokens` so the hit rate is knowable.
5. Enable `json_schema` per provider behind a canary, then extend `JSON_SCHEMA_TASKS`
   to the tasks with the worst measured parse-miss rate.
6. Size-aware provider ordering and a long park for `out_of_credit`.
7. Wrap the onboarding AI legs in `loggedAi` so onboarding spend is visible.

---

## 6. Instrumentation

For each root cause, the one counter or log line that would have shown it, and where it
belongs.

| Id | Root cause | The missing signal | Where it belongs |
|---|---|---|---|
| C1 | R10, error classification | `ai_runs.error_kind` (`misconfigured` / `out_of_credit` / `too_large` / `empty_replies` / `rate_limited` / `transient`) plus `attempts`. Today 295-491 error rows/day carry no reason at all. | `AiRunStatus` in `apps/workers/src/lib/analytics.ts:249`, the insert at `:284-294`, and a new column on `ai_runs`. `AIUnavailableError` already carries the kind in its message prefix. |
| C2 | R7, global breaker | A counter for global breaker trips with the reason, and one for time spent open. Today `tripGlobalBreaker` posts to Slack and writes a Redis key with a TTL, and nothing is queryable afterwards. | `packages/ai/src/provider/circuit-breaker.ts`, next to the Slack post: `INCR ai:metrics:global_breaker:<date>:<reason>`. |
| C3 | R9, concurrency | Instantaneous in-flight call count, sampled. | The semaphore itself in `packages/ai/src/provider.ts`: `INCR`/`DECR` on `ai:inflight` with a periodic `GET` logged by `ai-capacity-check`. |
| C4 | R4, saturated picks | A counter for picks made from the `available` fallback rather than `withHeadroom`. | `packages/ai/src/provider/provider-pool.ts:316`, one `INCR ai:metrics:no_headroom:<providerId>:<date>`. |
| C5 | R3, request limits | Requests per provider per minute. Today only tokens are counted. | The RPS bucket in R3 doubles as the counter. |
| C6 | E12, prefix caching | `prompt_tokens_details.cached_tokens` from the provider response. | `TokenUsage` at `packages/ai/src/provider/provider-context.ts:27`, `markUsage` at `provider.ts:450`, and a `cached_tokens` column on `ai_runs`. |
| C7 | E9, extraction ladder | Already exists and is under-used: `extraction_runs.resolution` and `ai_used`, written at `apps/workers/src/lib/staged-extract.ts:95-107`. Nothing alerts on the `cache` share falling. | An `ops-health-check` threshold on `cache / (cache + ai_fallback)`. |
| C8 | E14, onboarding | `loggedAi` around `nameKnownCompetitors` and `scoreOverlap`. | `apps/api/src/routes/onboarding.ts:537,560`. The API has `logApiAiRun` already (`apps/api/src/routes/signals.ts:497`). |
| C9 | Quota exhaustion | `ai-capacity-check` divides total used by total capacity: `totalCapacity` is dominated by Mistral's 30,000,000 quota (`.env.example:550`), so with Cerebras 1M + Groq 200k + Cloudflare 280k the denominator is 31.48M and the ratio cannot reach the 80% alert even when every other provider is at 100%. Only the `exhausted` list at >= 95% is meaningful. | `apps/workers/src/core/ai-capacity-check.ts`: alert per provider, never on the sum. This is a live false-negative, not a theoretical one. |
| C10 | R1, burst shape | Tokens per minute, as a rolling metric rather than a query someone remembers to run. | `ai-capacity-check` already runs every 30 minutes (`jobs.ts:517`); have it read the `ai:tpm:*` buckets it does not currently touch. |

---

## 7. Open questions to measure

| Q | Question | How to settle it |
|---|---|---|
| Q3 | What share of 429s comes from exceeding a **request** limit rather than a token limit? | Log the full `retry-after` and the provider's error body in `rateLimitBackoffSec` (`provider.ts:165-185`) for one day. Groq's prose message distinguishes RPM from TPM. |
| Q5 | How many calls per week are still routed to a provider that then answers 413? | Add `error_kind='too_large'` (C1) and count. The code comment at `provider.ts:326` cites 430/week historically. |
| Q9 | Which `sourceType` drives the `ai_fallback` majority? | `SELECT source_type, resolution, count(*) FROM extraction_runs WHERE recorded_at > now() - interval '30 days' GROUP BY 1,2 ORDER BY 3 DESC`. |
| Q11 | Which tasks have the worst parse-miss rate, and therefore benefit most from `json_schema`? | `SELECT task, count(*) FILTER (WHERE status='parse_failed')::float / nullif(count(*),0) AS miss_rate, count(*) FROM ai_runs WHERE recorded_at > now() - interval '14 days' GROUP BY 1 HAVING count(*) > 20 ORDER BY 2 DESC`. |
| Q12 | Do the eight existing prefixes actually hit the provider caches? | C6: record `cached_tokens`, then `SELECT task, avg(cached_tokens::float / nullif(prompt_tokens,0)) FROM ai_runs GROUP BY 1`. |
| Q13 | Does `gpt-oss-20b` hold quality on `extract_pricing`? | The existing `eval:*` scripts in `packages/ai` hit real providers. Run the pricing eval on both tiers over the same fixture set. |
| Q14 | What does onboarding really cost? | C8, then `SELECT sum(total_tokens) FROM ai_runs WHERE task IN ('name_competitors','score_overlap') AND recorded_at > ...`. The 30k/competitor figure predates any logging of these two. |
| Q-A | Is the Mistral model actually configured in prod? | `.env.example:547-548` ships `AI_PROVIDER_4_MODEL=` empty, and `loadProviders` substitutes the literal `"llama-3.3-70b"` (`provider-pool.ts:99`). Production serves 234-720k Mistral tokens/day, so it must be set, but the boot probe result is the proof: check the `checkProviderModels` output in the worker boot log (`provider-pool.ts:155`). |
| Q-B | How many concurrent AI calls does the fleet actually reach at `:00`? | C3. The code bounds it at about 22 from the workers plus the API; the observed peak is unknown. |
| Q-C | How many of the 48 jobs without a `deadLetter` are dying silently each day? | `SELECT name, count(*) FROM pgboss.job WHERE state = 'failed' AND created_on > now() - interval '1 day' GROUP BY 1 ORDER BY 2 DESC`. |

---

## 8. Contradictions found between the docs and the code

1. **`.env.example:623`** documents the faithfulness gate as settling undecided claims
   "by a binary judge (both calls on the pool's FAST model)".
   `packages/ai/src/faithfulness/extract-claims.ts:74` does use `classificationFast`, but
   `packages/ai/src/faithfulness/judge-claim.ts:80` uses `AI_CONFIG.classification`, the
   smart tier. The code is the deliberate side here: `apps/workers/src/lib/faithfulness-gate.ts:22-25`
   states that the fast label "names the fast tier because extraction (one call, always)
   runs there; the judge runs smart". So `.env.example:623` is the stale line, and since
   the judge can run up to 12 times per chain (`verify.ts:27`), it understates the gate's
   cost by roughly an order of magnitude.
2. **`packages/queue/CLAUDE.md`** states that "`boss.createQueue()` est create-IF-NOT-EXISTS.
   Changer les `queueOptions` d'un job deja deploye n'a aucun effet". The code has since
   been fixed: `packages/queue/src/boss.ts:332-338` documents and performs an
   `updateQueue` reconciliation on every boot, so `jobs.ts` is now the source of truth
   for everything except `policy`. The package doc is stale and will cause someone to
   avoid a change that would in fact apply.
3. **`apps/workers/src/core/ai-capacity-check.ts`** alerts on
   `totalUsed / totalCapacity`, and `totalCapacity` is dominated by Mistral's
   30,000,000-token declared quota, so the 80% and 90% alerts are unreachable. The
   capacity document's monitoring section assumes this check is a working early warning.
   It is not; only its `exhausted` list works.
4. **`packages/ai/CLAUDE.md`** describes the cascade as "Cerebras p1, Cloudflare Workers
   AI p2, Groq p3, Mistral p4", which matches the `PRIORITY` values in `.env.example`,
   but the file's provider **numbering** is cerebras=1, groq=2, cloudflare=3, mistral=4.
   Anyone setting `AI_PROVIDER_2_*` expecting Cloudflare will configure Groq.

---

## 9. Not verifiable from this worktree

- Anything in `.env.local` or the production `.env` on the queue box. Every value quoted
  here comes from `.env.example`, and the production values may differ. The Mistral model
  question (Q-A) is the one place where that difference is load-bearing.
- Whether Cloudflare and Groq accept `response_format: { type: "json_schema" }` for
  `gpt-oss`. The boot probe (`checkProviderModels`) only lists models.
- Actual prefix-cache hit rates, request-limit versus token-limit 429 shares, current
  parse-miss rates per task, and the observed maximum concurrency. All of these are
  listed in section 7 with the query or counter that would settle them.
- `pg-boss`'s own default for `localConcurrency`. The worktree has no `node_modules`, so
  the value used here (1) comes from `docs/audits/2026-08-16/REPORT.md:705` and `:1111`
  rather than from the library source.
