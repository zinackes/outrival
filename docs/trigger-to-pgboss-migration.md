# Migration plan — Trigger.dev → pg-boss (`@outrival/workers` + `@outrival/api`)

Status: **Phases 0–6 done, code-complete — cutover pending** (2026-07-19). All 37
job bodies live in `apps/workers/src/core/` (runtime-neutral), consumed by the
pg-boss handlers AND by thin Trigger wrappers that stay deployable as the rollback
for one week after cutover. The API enqueues through the typed registry on a
send-only client; `/admin` reads job state from the `pgboss` schema. 17 crons
registered (the 5 the Trigger cap had blocked, plus the new heartbeat).
typecheck 8/8 + tests 12/12 green. **Not runtime-verified** — the staging gates
below need a provisioned queue Postgres, which does not exist yet. See
§11 (cutover checklist) and §12 (what is blocked).

> **Re-extraction, not rebase (2026-07-19).** The first attempt extracted job
> bodies on 2026-07-03; `main` then rewrote most of them (`scrape-monitor` alone
> +643/−42: sitemap v2, HN, wellknown, collection doctrine) and shipped 11 new
> jobs. Those `core/*` files were new files, so a merge would have kept the stale
> copies silently — no conflict, no signal, two-week-old logic in production. The
> extraction was redone from main's current bodies instead, byte-identical
> (`review-core.sh` diffs show only the import/signature/fan-out hunks).

<details><summary>Earlier status (Phase 1, 2026-07-01)</summary>

Phases 0+1 built & live-verified (2026-07-01):
`@outrival/queue` on pg-boss **v12.24.1** (typed registry, all 30 job defs,
`CRON_SCHEDULES`, `syncSchedules`, `queue-health` probe); worker entry
`apps/workers/src/queue/worker.ts` (WORKER_ROLE browser|light, light owns
cron+maintenance, Sentry, graceful drain) + `Dockerfile.queue-{light,browser}`
(browser layer ported command-for-command from `installBrowsers()`). Verified
live under Bun vs the compose PG: 16 crons synced, cross-process sender→worker
`queue-health` round-trip, SIGTERM drain on both roles. Docker image builds not
yet run (WSL2 RAM) — build once on the VPS/staging.

</details>

Goal: replace Trigger.dev Cloud with a self-owned, Postgres-native job runner
(**pg-boss v10**) — the long-term keeper: 0 € software, no per-run meter, no
10-cron cap, no vendor roadmap risk. Continues the "one-Postgres, rip-out-managed-
deps" doctrine (ClickHouse→PG, Upstash→SSE → **Trigger→pg-boss**).

## 1. Why now (the concrete pain)

- **10-schedule cap reached.** 5 jobs are shipped **cron-less** today because the
  11th declarative `schedules.task` aborts the deploy: `ai-capacity-check` (`*/30 * * * *`),
  `ops-health-check` (`0 */6 * * *`), `feedback-pattern-detection` (`0 9 * * 1`),
  `purge-retention` (`0 4 * * *`), `detect-silent-monitors` (`0 8 * * *`). They only run
  when triggered by hand → observability/retention/health silently degraded. pg-boss
  removes the cap entirely (`boss.schedule()`, limit ~100M).
- **Per-run meter** grows with scrape volume (free 10k → $50 Pro → $200 Team).
- **Vendor coupling** on the most fragile part of the system (browser build image).

## 2. Target architecture

```
┌─ @outrival/queue (NEW shared package) ───────────────────────────────┐
│  • PgBoss client factory (points at QUEUE_DATABASE_URL — dedicated PG) │
│  • defineJob<Payload>() typed registry  → restores tasks.trigger<T>()  │
│  • JOB names + payload types + queue/lane defs (single source)         │
│  • send-only mode (api) vs full mode (workers)                        │
└──────────────────────────────────────────────────────────────────────┘
        ▲ import (send)                     ▲ import (send + work)
        │                                   │
   @outrival/api                       @outrival/workers
   (enqueue + admin obs)          ┌──────────┴───────────┐
                                  │ light-worker svc      │  browser-worker svc
                                  │ (~1 GB, no browser)   │  (~8 GB, 3-browser img)
                                  │ crons, AI, extract,   │  scrape-monitor(2 lanes),
                                  │ digests, send-alert…  │  detect-platform,
                                  └───────────────────────┘  generate-battle-card

Dedicated always-on Postgres (Coolify, ~256–512 MB)  ← queue tables ONLY, not Neon.
@pg-boss/dashboard behind ADMIN_EMAILS auth          ← replaces Trigger run-tree UI.
```

**Non-negotiable infra rule:** the queue lives on a **dedicated always-on Postgres**
(`QUEUE_DATABASE_URL`), NOT Neon. A 0.5–2 s poller defeats Neon's scale-to-zero and
bills compute-hours. `boss.start()` auto-creates its `pgboss` schema there; it never
touches the relational Neon DB.

## 3. Primitive mapping (see POC for code)

| Trigger.dev | pg-boss v10 |
|---|---|
| `schedules.task({cron})` | `boss.schedule(name, cron)` + `boss.work(name)` — no cap |
| `task({id})` | `boss.createQueue(name)` + `boss.work(name, handler)` |
| `tasks.trigger("x", p)` | `job.enqueue(p)` → `boss.send` (typed via registry) |
| `tasks.batchTrigger("x", [...])` | `job.enqueueMany` → `boss.insert` (name = lane) |
| `queue({concurrencyLimit})` | worker `batchSize` (+ rolling helper) |
| `retry`/`maxDuration` | `createQueue({retryLimit,retryDelay,retryBackoff})` / `expireInSeconds` |
| `AbortTaskRunError` | `NonRetriable` marker → worker completes without retry |
| `onFailure`→Sentry | `boss.on("error")` + handler catch + **dead-letter queues** |
| `triggerAndWait` | **refactor** — see Decision #1 |

## 4. The two genuine decisions (everything else is mechanical)

### Decision #1 — the single `triggerAndWait`
`generate-battle-card` awaits `refreshCompetitorSummaryJob.triggerAndWait()` and **uses
the returned `summary`** to ground the card when a competitor has no `aiSummary` yet.
pg-boss is fire-and-forget (no job-result await).
**Fix:** extract the summary core into a shared fn
`refreshCompetitorSummary(competitorId): Promise<{summary}>` (lib), called both by the
`refresh-competitor-summary` worker AND **inline** (plain `await`) inside
`generate-battle-card`. Removes cross-job waiting entirely; battle-card is on-demand so
running the summary inline is fine. ~1–2 h.

### Decision #2 — the global Groq serialization
`classify-change` + `generate-signal` share `groqQueue` (`concurrencyLimit: 1`) to stay
under Groq's 12k TPM. pg-boss concurrency is **per-queue/worker**, so two job names can't
share one global limit natively.
**Options:** (a) rely on the patch-22 provider-pool rate limiter (Redis circuit breaker +
daily quota + in-call failover) which is the stronger throttle — `groqQueue=1` is now
partly redundant; or (b) if strict serialization is still wanted, run a single **AI worker
process** with a `p-limit(1)` shared across both handlers. Recommend (a) + a low
`batchSize` on each; revisit only if 429s appear. ~2 h to wire + observe.

## 5. Full 30-job inventory

`hello-world` = demo, **dropped**. Legend: 🌐 = browser-worker, ⚙️ = light-worker.

### Scheduler / cron jobs (16 → all become `boss.schedule()`)
| # | Job | Cron | Today | Fan-out | Notes |
|---|---|---|---|---|---|
| 1 | schedule-scraping | `0 * * * *` | active | ⇒ scrape-monitor (fast+slow) | plan-cap gate (`selectWithinPlanCap`, unchanged) |
| 2 | generate-daily-digest | `0 * * * *` | active | — | idempotent `daily_email_sent_at` |
| 3 | schedule-tech-stack | `0 6 * * *` | active | ⇒ scrape-tech-stack | |
| 4 | schedule-platform-detection | `0 4 * * *` | active | ⇒ detect-platform | |
| 5 | schedule-ai-visibility | `0 7 * * 1` | active | ⇒ scrape-ai-visibility | |
| 6 | signal-batching | `0 */6 * * *` | active | — | maxDur 300 |
| 7 | detect-structural-changes | `0 6 * * 1` | active | — | maxDur 600 |
| 8 | generate-weekly-digest | `0 8 * * 1` | active | — | maxDur 600 |
| 9 | relevance-threshold-recalculation | `0 3 * * 0` | active | — | maxDur 300 |
| 10 | detect-new-competitors | `0 20 * * 0` | active | — | maxDur 600 |
| 11 | analyze-sectoral | `0 7 * * 1` | active | — | maxDur 600 |
| 12 | ai-capacity-check | `*/30 * * * *` | **CRON-LESS** | — | ← unblocked |
| 13 | ops-health-check | `0 */6 * * *` | **CRON-LESS** | — | ← unblocked |
| 14 | feedback-pattern-detection | `0 9 * * 1` | **CRON-LESS** | — | ← unblocked |
| 15 | purge-retention | `0 4 * * *` | **CRON-LESS** | — | maxDur 600, ← unblocked |
| 16 | detect-silent-monitors | `0 8 * * *` | **CRON-LESS** | — | maxDur 300, ← unblocked |

### Worker jobs (14)
| # | Job | Queue / concurrency | Machine | maxDur | Triggers → | Worker |
|---|---|---|---|---|---|---|
| 17 | scrape-monitor | scrape-monitor (5) / slow (2) | medium-1x (2 GB) | 300 | classify-change, generate-signal, refresh-competitor-summary, detect-platform, extract-{self-profile,pricing,jobs,reviews} | 🌐 |
| 18 | detect-platform | default | medium-1x | 120 | — | 🌐 (step-B browser capture) |
| 19 | generate-battle-card | default | small-2x | 180 | **wait**→refresh-competitor-summary (Decision #1) | 🌐 (PDF via Playwright) |
| 20 | scrape-tech-stack | default | default | 120 | generate-signal | ⚙️ (native fetch, no cascade) |
| 21 | classify-change | groq-ai (1) | default | 120 | generate-signal | ⚙️ (Groq — Decision #2) |
| 22 | generate-signal | groq-ai (1) | default | 120 | send-alert | ⚙️ idempotent `signals.changeId` |
| 23 | send-alert | default | default | 60 | — | ⚙️ |
| 24 | extract-pricing | default | default | 120 | — | ⚙️ |
| 25 | extract-jobs | default | default | 180 | — | ⚙️ |
| 26 | extract-reviews | default | default | 120 | — | ⚙️ |
| 27 | extract-self-profile | default | default | 120 | — | ⚙️ |
| 28 | refresh-competitor-summary | competitor-summary (1) | default | 120 | — | ⚙️ (also a shared inline fn — Decision #1) |
| 29 | scrape-ai-visibility | default | default | 300 | generate-signal | ⚙️ (Perplexity API) |
| 30 | notify-onboarding-analysis | default | default | 600 | refresh-competitor-summary | ⚙️ |

**Idempotence** (already present, carries over verbatim): `signals.changeId` guard,
snapshot content-hash dedup, `daily_email_sent_at`, `(orgId, weekStart)` digest key,
`(product_id, competitor_id)` battle-card key. These cover pg-boss at-least-once delivery.

## 6. Cross-app surface (was under-counted)

- **API enqueue — 15 sites** across `changes/monitors/monitor-alternatives/competitors/`
  `products/my-product/battle-cards/candidates/onboarding/ai-visibility/admin-users/dev`.
  Choke-point exists: `apps/api/src/lib/trigger.ts` re-exports `tasks`. Refactor every
  route to import a shared `enqueue()` from `@outrival/queue`, then delete the shim. Jobs
  enqueued from API: classify-change, scrape-monitor, scrape-tech-stack, detect-platform,
  refresh-competitor-summary, generate-battle-card, scrape-ai-visibility, (dev: any).
  The API runs a **send-only** PgBoss (`supervise:false, schedule:false`).
- **Admin observability — re-point.** `admin/system.ts`, `admin/jobs.ts` read Trigger
  `runs`/`schedules`/`queues` for the `/admin` scraping+jobs pages. Replace with pg-boss
  queries (job counts/states from the `pgboss` schema) or defer entirely to the mounted
  `@pg-boss/dashboard`. `dev.ts` "run any task by id" button → `boss.send(id, {})`.

## 7. Phased execution plan (each phase has a verify gate)

**Phase 0 — Foundation** (`@outrival/queue`): client factory, `defineJob` registry, all
30 job names + payload zod types, queue/lane defs; provision dedicated PG (Coolify);
local `docker-compose` (PG + dashboard). *Verify:* typecheck green; `boss.start()`
connects; `createQueue` for all queues; `hello-world` round-trips locally. **~1 d**

**Phase 1 — Worker bootstrap**: `worker.ts` (start, registerQueues, work registrations,
`boss.on(error)`→Sentry, graceful `stop({graceful})` on SIGTERM/SIGINT), `ROLE` env
(browser|light) selecting which `work()` to register; Dockerfiles (browser = 3-browser
apt/npm install, plain — *simpler* than the Trigger build-extension; light = slim);
2 Coolify services. *Verify:* both workers boot; hello-world processed by light worker.
**~0.5 d**

**Phase 2 — Leaf + cron jobs** (no downstream): send-alert, extract-{pricing,jobs,reviews,
self-profile}, refresh-competitor-summary, scrape-ai-visibility, scrape-tech-stack, and all
16 crons (digests, detect-*, purge, ops, capacity, feedback, relevance, signal-batching,
analyze-sectoral). Mechanical wrapper swap; bodies unchanged. *Verify:* per-handler unit/dry
run; each cron fires once on staging. **~1 d**

**Phase 3 — Pipeline core + DAG**: scrape-monitor (+ its 8 downstream `enqueue`s),
classify-change, generate-signal, the 4 `schedule-*` fan-outs (`insert`, lane routing).
*Verify:* end-to-end on staging — force a scrape → snapshot → change → classify → signal →
send-alert; two-lane split honored. **~1 d**

**Phase 4 — The two decisions**: extract shared `refreshCompetitorSummary` fn + inline it
in generate-battle-card; wire Groq serialization strategy (Decision #2). *Verify:* battle
card grounds correctly on a summary-less competitor; no Groq 429 storm under load. **~0.5 d**

**Phase 5 — Cross-app**: swap 15 API enqueue sites to `@outrival/queue`; re-point admin
observability / mount dashboard. *Verify:* API force-rescan, on-demand battle card,
onboarding scrape all enqueue + run; `/admin` shows live job state. **~0.5–1 d**

**Phase 6 — Crons live**: register all 16 `boss.schedule()` incl. the 5 previously-capped.
*Verify:* each appears in dashboard schedules; fires on staging. **~0.25 d**

**Phase 7 — Parity + cutover**: run pg-boss workers **alongside** Trigger on staging for
one full cron cycle, diff outcomes (scrapes, signals, digests). Then prod cutover: stop
Trigger schedules, deploy pg-boss services, flip API enqueue. Keep Trigger deployable
(rollback) for ~1 week, then remove `@trigger.dev/*` deps + `trigger.config.ts` + delete
Trigger project. *Verify:* smoke test (`docs/deployment.md`): scrape→signal, digest, alert,
API-triggered rescan; dead-letter queue empty. **~1–1.5 d**

**Total ≈ 5.5–6.5 d** focused (≈ 1 working week + buffer). Higher than the first
back-of-envelope because it now includes the API surface + admin observability.

## 8. Infra & env changes

- **New env:** `QUEUE_DATABASE_URL` (dedicated PG), `WORKER_ROLE` (browser|light),
  `QUEUE_POLL_INTERVAL_SECONDS` (default 2), keep `SCRAPE_CONCURRENCY` /
  `SCRAPE_SLOW_CONCURRENCY` / `SUMMARY_CONCURRENCY`, add `GROQ_QUEUE_CONCURRENCY` (1).
- **Remove (Phase 7):** `TRIGGER_SECRET_KEY`, `TRIGGER_PROJECT_ID`.
- **Update:** `.env.example` + `docs/architecture.md` (stack table: Trigger.dev → pg-boss;
  infra block: + dedicated PG service, − Trigger.dev Cloud line) per production rule #4.
- **Coolify:** 1 Postgres service (queue), 2 worker services (browser 8 GB / light 1 GB),
  dashboard (mount in api under admin auth or a tiny sidecar).
- **Dockerfile (browser):** the `installBrowsers()` build-extension becomes plain
  `RUN` layers (playwright + patchright chromium install) — same commands, now under
  your control, no extension bug surface.

## 9. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Shared-process OOM on browser worker | med | Chromium is a child process (page RAM out-of-process); size 8 GB; cap `batchSize`; DLQ + retry |
| Intra-lane batch coupling (slow lane) | low | separate lanes preserved; `batchSize:1`×replicas or p-limit if measured |
| Groq 429 after dropping global limit | low | provider-pool limiter (patch-22) is primary throttle; p-limit(1) fallback |
| Queue PG becomes a SPOF | med | it's the only new always-on component; Coolify backups; small + isolated |
| Missed API enqueue site | low | grep gate in CI: fail if `@trigger.dev` imported outside a deleted allowlist |
| Lost run history at cutover | low | keep Trigger read-only 1 week; dashboard retention 3 d is enough going forward |

## 10. Rollback

Until Phase 7 completes, Trigger stays fully deployable. Cutover is: (1) stop Trigger
schedules, (2) start pg-boss workers, (3) flip API `enqueue`. Rollback = reverse (3)→(1);
in-flight pg-boss jobs drain via graceful stop. Only after a clean week do we delete the
Trigger project + deps.

## 11. Cutover checklist (run by hand — the assistant never touches prod)

Order matters: schedules stop **before** the workers start, so the two runners can
never fire the same cron in the same minute. Enqueue flips **last**, because it is
the only step users can feel.

### 11.0 — Prerequisites (before any of this)

```bash
# Coolify: create the queue Postgres service (512 MB), then grab its internal URL.
# It must NOT be the Neon branch — a sub-2s poller defeats scale-to-zero.
# pg-boss creates its own `pgboss` schema on first worker boot: NO drizzle migration,
# nothing to run against Neon.

# Set on BOTH worker services + the api service:
QUEUE_DATABASE_URL=postgres://…      # the new service's internal URL
# Set on workers-light only:
HEARTBEAT_URL=https://uptime.betterstack.com/api/v1/heartbeat/…
# Set on workers-browser only:
WORKER_ROLE=browser  SCRAPE_CONCURRENCY=3
# Set on workers-light only:
WORKER_ROLE=light
```

Browser service Docker options: `--shm-size=1g`; stop grace period ≥ 60 s.

### 11.1 — Staging rehearsal (the gates that still need a box)

```bash
# 1. Both images build on the VPS (never built — WSL2 has no RAM for it)
docker build -f apps/workers/Dockerfile.queue-light  -t outrival-light .
docker build -f apps/workers/Dockerfile.queue-browser -t outrival-browser .

# 2. Boot both, then prove the round-trip from a third process:
#    enqueue queue-health → a worker completes it.
# 3. Watch one full hour: schedule-scraping fires, scrapes run, signals appear.
# 4. Parity: leave Trigger running alongside for one cron cycle and diff the
#    outcomes (scrapes, signals, digests). The existing idempotence keys are what
#    make the double-run safe — signals.changeId, snapshot content-hash,
#    daily_email_sent_at, (orgId, weekStart), (product_id, competitor_id).
#    Do NOT add new guards; verify these hold.
```

### 11.2 — Prod cutover

```bash
# 1. STOP Trigger's schedules (Trigger dashboard → Schedules → disable all).
#    Nothing is deleted: the project stays deployable as the rollback.

# 2. Start the two pg-boss services in Coolify (light first — it owns cron and
#    creates the schema; then browser).
#    Verify: /admin → queue health lists the queues; the heartbeat monitor is green.

# 3. Deploy the api with QUEUE_DATABASE_URL set — this is the enqueue flip.
#    Verify: force a re-scan from the UI → the job appears in /admin/jobs and completes.

# 4. Run the smoke test in docs/deployment.md (incl. the pg-boss section).
```

### 11.3 — Rollback (any time during the first week)

Reverse order: redeploy the api without `QUEUE_DATABASE_URL` (routes fall back to
nothing — so in practice, redeploy the previous api image), stop the pg-boss
services (SIGTERM drains in-flight jobs gracefully, ≥60 s grace), re-enable the
Trigger schedules. The Trigger wrappers were never deleted, so `trigger deploy`
still works untouched.

### 11.4 — After one clean week (NOT before)

- Delete `apps/workers/src/jobs/*.job.ts` (the wrappers) + the 4 `cron-*.job.ts`
  dispatchers + `hello-world.job.ts` + `trigger.config.ts`.
- Delete `apps/workers/src/lib/trigger-adapter.ts` (the `asTriggerRun` shim).
  **`lib/job-logger.ts` and `lib/job-wait.ts` STAY** — the core bodies import them.
- Drop `@trigger.dev/*` from `apps/workers/package.json` and `apps/api/package.json`,
  and `trigger.dev` from devDependencies.
- Remove `TRIGGER_SECRET_KEY` / `TRIGGER_PROJECT_ID` from `.env.example`,
  `docs/architecture.md`, `docs/deployment.md`, and the Coolify env.
- Add the CI guard so an import cannot creep back:

```yaml
# .github/workflows/ci.yml
- name: No Trigger.dev imports
  run: |
    if grep -rn "@trigger.dev" apps packages --include=*.ts --include=*.json; then
      echo "::error::@trigger.dev is retired — enqueue via @outrival/queue"; exit 1
    fi
```

- Delete the Trigger.dev project.

## 12. Blocked on infrastructure

Everything below needs hardware that does not exist yet; the code is done and green.

| Gate | Needs |
|---|---|
| Docker images build | The VPS (WSL2 lacks the RAM) |
| queue-health round-trip, cron firing, drain | `QUEUE_DATABASE_URL` + both services on staging |
| Parity run vs Trigger | Staging with both runners live for one cron cycle |
| Heartbeat received | `HEARTBEAT_URL` from Better Stack / UptimeRobot |
| The 5 ex-capped crons each fired | Staging, one 24 h window |

## 13. Known semantic gap — `idempotencyKey` → `singletonKey`

Trigger's `idempotencyKey` dedups against **completed** runs too; pg-boss's
`singletonKey` only against jobs that have not completed. Four call sites use it:

| Site | Own guard | Verdict |
|---|---|---|
| `generate-signal` → `send-alert` | prior `alerts` rows (`alreadyProcessed`) | safe |
| `generate-signal` → `evaluate-standing-queries` | cooldown + hysteresis | safe (costs one extra eval at worst) |
| `extract-reviews` → `detect-review-theme-shifts` | one emission per episode | safe |
| `generate-daily-digest` → `send-monthly-recap` | **none found** | ⚠️ a duplicate recap email is possible if the digest fires twice in the org's local first-of-month morning hour AND the first recap job already completed |

The recap case is the only real exposure. If it shows up, the faithful pg-boss
primitive is `sendThrottled(name, data, opts, seconds, key)` with a ~35-day window
— not a new DB guard. Left as-is for now rather than adding a mechanism nobody has
measured needing.

---
*Companion POC (translated code + primitive mapping): `scratchpad/pgboss-poc/`
(`boss.ts`, `jobs.ts`, `worker.ts`, `MIGRATION.md`).*
