# OUT-278 — pipeline reliability validation

Date: 2026-09-05. Baseline: `af53bd1cf4f2a4fa414f5c074bf095d9d280852b`.

**Gate remains open.** HTTP failover/recovery and signal replay passed isolated
checks. Manual dead-letter redrive and SDK transport failover have confirmed gaps:
[OUT-292](https://linear.app/zinacke/issue/OUT-292) and
[OUT-293](https://linear.app/zinacke/issue/OUT-293). Completing this audit does not
unblock the product rollouts beneath OUT-277.

## Evidence matrix

| Requirement | Result | Evidence / limitation |
| --- | --- | --- |
| HTTP 402, 429, 503 failover | Pass | Real SDK + real pool, fake HTTP/Redis: failed A then healthy B, exactly two requests, failure streak cleared. |
| Billing exhaustion | Pass | Both providers return 402; `ai_out_of_credit` opens the global breaker. Another call performs no HTTP; expiry plus healthy response recovers. |
| Full outage and recovery | Pass | Both providers return 503; one failed task counted. A subsequent no-provider task reaches the configured threshold. Expiry recovers and clears the streak. |
| Rate-limit recovery | Pass | Both providers return 429; their short parks expire and the next task succeeds. |
| SDK connection errors/timeouts | **Fail** | `shouldFailover(APIConnectionError)` and `shouldFailover(APIConnectionTimeoutError)` are false. No status means 0; a healthy next provider is not tried. OUT-293. |
| Native exhausted job redrive | Pass | Real pg-boss 12.26.1 on in-memory PGlite: failed classify-change job returns to its original queue with payload intact. |
| Manually parked truncation redrive | **Fail** | The same redrive leaves a generate-signal envelope in the DLQ because its native `source_name` is null. OUT-292. |
| Signal replay after provider failure | Pass, scoped | Real generate-signal body and migrated PGlite: injected AI error leaves the change and creates no signal. Two concurrent retries plus a third retry create exactly one signal. |
| Organization isolation on replay | Pass, scoped | Foreign org/competitor fields added to the replay payload do not alter ownership resolved through the persisted change. The other seeded organization has zero signals. |
| Classifier replay after signal creation | Pass | The real classifier returns the existing signal without generating another. |
| Bounded retry / runtime budget | Partial | Queue retry/deferral counts are bounded by defaults below. End-to-end SDK timeout/retry time within the 120-second job expiry is not proven; OUT-293 includes this check. |
| Terminal failure visibility | Partial | Native source metadata and job error output are inspectable. Manual envelopes retain reason/job ID in their payload, but source display/redrive is broken and their branch bypasses the normal error reporter. OUT-292 includes notification validation. |

## Current retry, visibility and recovery behavior

`packages/queue/src/jobs.ts` declares both `classify-change` and `generate-signal`
with `expireInSeconds: 120`, concurrency 1, and `outrival-dlq` as their dead-letter
queue. `defineJob` defaults to two retries after the initial attempt, a one-second
retry delay with backoff capped at ten seconds, and seven-day deletion retention.
These are repository defaults, not a claim about the current production rows.

`apps/workers/src/queue/ai-deferral.ts` defers `AIUnavailableError` for 75–105
seconds by default. It excludes misconfiguration and oversized requests; billing
exhaustion currently follows the deferral path. The queue carries `__deferrals`
between resends and removes it before invoking the handler. Default maximum:
three deferrals, then ordinary retries and native dead-lettering. A native
redrive preserves that payload, so it does not reset the carried deferral count.
Environment overrides change these defaults. The light worker supervises every
60 seconds; a job's database expiry does not cancel a running JavaScript call.

Malformed classification/insight JSON throws a retriable error. A truncated
reply throws `DeadLetter(reason='truncated_reply')`; the queue wrapper immediately
sends the original business payload plus `__dlq: { queue, reason, jobId }` into
the DLQ and records a `deadLettered` output on the completed original job. It does
not call the ordinary `_reportError` path. With no DLQ configured, it falls back
to normal retry behavior.

Admin job details expose payload/error output. The DLQ view reads `source_name`;
the redrive endpoint calls `boss.redrive('outrival-dlq', { limit })`. Native
pg-boss failures have source metadata; manual `boss.send` entries do not.
The installed redrive SQL only selects rows with a valid destination resolved
from that native column, so manual entries remain safely parked but unrecoverable
through that button. A blanket destination override would be unsafe in the shared
DLQ and is not a proposed repair.

The global AI breaker stores its reason/TTL in Redis and attempts a best-effort
ops Slack notification. A task success resets the failure streak. The default
global threshold is five failed tasks; the test fixture uses two. Queue-internal
errors have throttled ops notification. The worker heartbeat detects stalled
consumer queues but explicitly excludes the DLQ. No real Slack message or external
heartbeat was sent during this validation; delivery/configuration is not verified.

## Reproducible automated checks

Added tests:

- `packages/ai/src/provider-reliability.test.ts`: six HTTP fault-injection and
  recovery cases. Only HTTP and Redis are replaced; production SDK, provider
  selection, accounting, circuit breaker and semaphore code execute. HTTP fixtures
  set `x-should-retry: false` to test pool transitions without SDK sleep. These
  tests deliberately do **not** prove the SDK retry timing budget.
- `apps/workers/test/signal-replay.test.ts`: the real handler and real migrated
  Postgres schema, including the unique signal/change constraint. Only the insight
  generator is stubbed. Archive fixtures keep alert delivery, external calls and
  verification capture out of this test. This proves signal-row idempotence and
  persisted ownership, **not** exactly-once email/webhook delivery or admin-route
  authorization. Both concurrent calls execute the pre-insert path.

Run from the repository root:

```sh
pnpm test:local --filter @outrival/ai
pnpm test:local --filter @outrival/workers
pnpm typecheck
pnpm check:lint
```

Results: AI **316 pass / 0 fail**; workers **527 pass / 0 fail**;
repository typecheck **8 successful tasks**; lint **exit 0**, existing warnings
only. No production build was run (the repository forbids the OOM-prone full
build as a local validation step).

The first standalone worker run exceeded Bun's five-second setup timeout while
initializing PGlite alongside the separate DLQ probe. Its setup allowance is now
30 seconds. The subsequent isolated run passed (one test, ten assertions).

## Isolated DLQ probe

Used the installed pg-boss **12.26.1** with a fresh in-memory PGlite database, the
`pglite` backend, and `schedule: false` / `supervise: false`. A custom
`executeSql` adapter routed every statement into PGlite; no connection string or
shared Postgres was used. The temporary probe was run from `/tmp` and is not a
production script.

Recipe for the follow-up regression test:

1. Create `outrival-dlq`, then `classify-change` and `generate-signal` with
   `retryLimit: 0` and that DLQ. Zero retries accelerates the terminal-state probe;
   production retry counts are unchanged.
2. Send `{ changeId: 'change-native' }` to classify-change, fetch it, and fail it
   with `{ message: 'injected provider outage' }` using pg-boss's native API.
3. Send the real `deadLetterPayload('generate-signal', payload,
   'truncated_reply', 'original-generate-job')` to the DLQ, exactly as `work()` does.
4. Query `id, name, source_name, data` from `pgboss.job`, run native redrive with
   `limit: 100`, then query remaining DLQ entries and recreated source jobs.

Observed trace:

```text
Native original: 396c8dc4-0bc9-40cc-b7ad-fe040dffdd52
Native DLQ:      8b06a934-9a2c-4572-9227-a808540a6e54
  source_name=classify-change; changeId=change-native
Manual DLQ:      879f834f-eca4-458a-9596-771df48a31ea
  source_name=null; __dlq.queue=generate-signal
  __dlq.reason=truncated_reply; changeId=change-manual
redrive moved:   1
Native replay:   04eabda6-da27-4ca0-8122-3fb60c7e29c1
  queue=classify-change; changeId=change-native
Remaining DLQ:   879f834f-eca4-458a-9596-771df48a31ea (manual entry unchanged)
```

No jobs were deleted from a shared queue, replayed in production, or sent to real
AI providers. OUT-292 and OUT-293 must be resolved and their missing scenarios
verified before OUT-278 can close.
