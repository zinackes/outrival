# Deployment — OVH (app, Coolify) + Netcup (workers, plain compose)

Code-side companion to the Notion runbook *"🚀 Runbook — Mise en prod (OVH VPS +
Coolify)"*. The runbook covers the **OVH** server (hardening, UFW/fail2ban, swap,
Cloudflare proxied, backups) — follow it as-is. **This file covers what the
runbook does not: the app-specific config that breaks a deploy if missed.**

The **Netcup queue box** (workers + pg-boss Postgres) has no Coolify and no Notion
runbook: its rebuild procedure is `infra/queue-box/README.md`.

## Topology (decided)

**Two servers, not one.** Coolify runs the app; it does not touch the workers.

- **OVH VPS** (`151.80.58.65`, wg `10.10.0.2`) — Coolify apps from this one repo,
  behind Cloudflare (proxied, Full strict):
  - `web` → `https://outrival.io` (Next.js 16, Node, standalone)
  - `api` → `https://api.outrival.io` (Hono on Bun)
- **Netcup RS 1000 G12** (`outrival-queue-01`, `152.53.113.71`, wg `10.10.0.1`) —
  plain `docker compose` under `/opt/outrival`, **no Coolify**:
  - `outrival-pg` — the pg-boss queue Postgres (`QUEUE_DATABASE_URL`), bound to
    the WireGuard address only
  - `outrival-worker-light` (`WORKER_ROLE=light`: crons, AI, extracts, alerts —
    owns cron and maintenance, exactly one process may)
  - `outrival-worker-browser` (`WORKER_ROLE=browser`: scrapes, platform detection,
    battle-card PDF)
- The two boxes talk over **WireGuard `10.10.0.0/24`**; the queue is never exposed
  publicly. Runbook + compose mirrors: `infra/queue-box/README.md`.
- **Managed**: Neon (Postgres, business data only — never the queue), Upstash
  (Redis), Cloudflare R2.

> Jobs are pg-boss only. Trigger.dev was retired entirely (Phase 7, 2026-08-02):
> no `trigger.config.ts`, no `*.job.ts`, no `trigger deploy`. History:
> `docs/trigger-to-pgboss-migration.md`.

## ⚠️ Pre-launch check #1 — browser binaries on the browser worker

The collection-doctrine cascade launches a single **Playwright Chromium** for the
L1/L2 render (there is no separate scrape browser anymore), shared with the
battle-card PDF. It is installed by `Dockerfile.queue-browser` and runs on the
Netcup box, so a missing binary is a build-layer problem, not a platform one.

- **L0 fetch**: fine (no browser).
- **L1/L2 render**: depends on the Chromium install layer having run at image build.

**Test after each worker image deploy**: force a scrape on a JS site that needs a
render and watch `scrape_runs.level` + the container logs. If the browser is
missing, confirm the image ran `playwright install --with-deps chromium` and that
`PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` is set at runtime.

## Code changes made for prod (this branch)

| Change | File | Why |
|---|---|---|
| Cross-subdomain cookie (env-gated) | `apps/api/src/lib/auth.ts` | RSC `get-session` forwards the incoming request's cookies; without a parent-domain cookie the dashboard bounces to `/auth`. Works in dev only because localhost ignores the port. |
| `X-Accel-Buffering: no` on SSE | `routes/notifications.ts`, `routes/ask.ts` | Stop reverse-proxy buffering so SSE/streaming chunks arrive live. |
| `output: standalone` + `outputFileTracingRoot` | `apps/web/next.config.ts` | Minimal Docker image; trace pnpm-workspace deps from the repo root. |
| Single-worker static generation (`experimental.cpus: 1` + `staticGenerationMinPagesPerWorker` + `staticGenerationMaxConcurrency`) | `apps/web/next.config.ts` | The web build OOM-killed mid-prerender on the 8 GB VPS — Next's default parallel static generation (cores-1 workers) exhausted RAM shared with web+api+Coolify. Forced to 1 worker so the prerender fits; slower build, but it completes. If the box is later upsized, these can be relaxed. |
| Runtime migrator | `packages/db/src/migrate.ts` (`db:migrate:deploy`) | `db:migrate` is drizzle-kit (a devDependency, absent from the slim prod image). Uses drizzle-orm's runtime migrator (a prod dep). |
| Dockerfiles + `.dockerignore` | `apps/{api,web}/Dockerfile` | Nixpacks is unreliable for Bun + this pnpm monorepo; build explicitly. |

> The Dockerfiles are a tested-by-construction starting point but have **not**
> been `docker build`-validated locally (WSL RAM). Expect a small iteration on the
> first VPS build (paths, native deps).

## Migrations

Coolify **Pre-deployment Command** (General tab — runs before the container goes
live, aborts the deploy on failure). For the `api` app:

```
bun run node_modules/@outrival/db/src/migrate.ts
```

Needs `DATABASE_URL` in the app env (it is). The baseline already ran on Neon, so
`migrate` is a no-op until new migrations land. (Local dev still uses
`pnpm db:migrate` = drizzle-kit.)

## Staging — rehearse migrations on a Neon branch (MVP)

No staging app is deployed yet, but the highest-value risk to kill first is
migrations hitting prod blind. The cheapest fix is a **throwaway Neon branch** to
rehearse them. The runtime migrator reads only `DATABASE_URL`, so there is no
code or env wiring to add — just point it at the branch.

**One-time (Neon console):** create a branch `staging` off the production branch
(instant, copy-on-write, ~free). Copy its **direct** (non-`-pooler`) connection
string.

**Per migration, before deploying to prod:**
```
# repo root — runs the EXACT runtime migrator Coolify runs, but against staging
DATABASE_URL='postgres://…@…neon.tech/neondb?sslmode=require' \
  bun run packages/db/src/migrate.ts
```
Inspect the result (`pnpm db:studio` with the same URL), then let the prod deploy
apply the identical files. Reset the branch from prod whenever it drifts.

> Use the **direct** endpoint for DDL (not `-pooler`); the app keeps the pooled
> URL. When a full staging environment lands later (Coolify app on a `staging`
> git branch + its own pg-boss queue + Stripe **test** keys + an
> `outrival-snapshots-staging` R2 bucket), this same Neon branch becomes its DB.

## Environment matrix

`NEXT_PUBLIC_*` are inlined at **build** time → pass them as Docker **build args**
on the `web` app, not just runtime env. Everything else is runtime.

### `web` (build args)
```
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://api.outrival.io
NEXT_PUBLIC_TURNSTILE_SITE_KEY=...
NEXT_PUBLIC_POSTHOG_KEY=...            # if analytics enabled
NEXT_PUBLIC_POSTHOG_HOST=...
NEXT_PUBLIC_ONBOARDING_PARALLEL_DISCOVERY=true
NEXT_PUBLIC_ONBOARDING_DISCOVERY_DEBOUNCE_MS=3000
SENTRY_AUTH_TOKEN= / SENTRY_ORG= / SENTRY_PROJECT_WEB=   # optional, source maps
```

### `web` (runtime, server-to-API hop)
```
INTERNAL_API_URL=http://api:3001
```
Runtime, **not** a build arg and **not** `NEXT_PUBLIC_`: it is the address the Next
*server* uses to reach the API, and the browser must never see it. Without it, every
server-side fetch goes to `https://api.outrival.io`, which is Cloudflare-proxied: it
leaves the VPS, crosses the edge and comes back in through Traefik to a container on
the same host. A dashboard render makes 8 to 14 of those calls, so that hairpin is
paid 8 to 14 times per navigation.

Setting it in Coolify: enable **Connect to Predefined Network** on both the `web` and
`api` apps, then use the api container's name and internal port. Verify from inside
the web container before relying on it:
```
curl -sS -o /dev/null -w '%{http_code} %{time_total}\n' http://api:3001/health
```
A non-200 (or a DNS failure) means the two apps are not on the same network. Leave
the variable unset rather than half-set: the fallback is the working public URL.

### `api` (runtime)
```
NODE_ENV=production
PORT=3001
DATABASE_URL=                         # Neon pooled, ?sslmode=require
BETTER_AUTH_SECRET=                   # 32+ chars
BETTER_AUTH_URL=https://api.outrival.io
WEB_URL=https://outrival.io           # REQUIRED — else OAuth/magic-link redirects rejected
AUTH_COOKIE_DOMAIN=outrival.io        # REQUIRED — cross-subdomain session cookie
UPSTASH_REDIS_REST_URL= / UPSTASH_REDIS_REST_TOKEN=   # BLOCKING: api refuses to boot in prod without these
GOOGLE_CLIENT_ID= / GOOGLE_CLIENT_SECRET=
TURNSTILE_SECRET_KEY=
AUTH_RATE_LIMIT_EMAIL=3 / AUTH_RATE_LIMIT_IP=10 / AUTH_RATE_LIMIT_WINDOW_MIN=15
R2_ACCOUNT_ID= / R2_ACCESS_KEY_ID= / R2_SECRET_ACCESS_KEY= / R2_BUCKET_NAME=
STRIPE_SECRET_KEY= / STRIPE_WEBHOOK_SECRET= / STRIPE_PRICE_*=
RESEND_API_KEY= / RESEND_AUTH_FROM=
GROQ_API_KEY= (or AI_PROVIDER_*) / ANTHROPIC_API_KEY=
EXA_API_KEY=
POSTHOG_API_KEY=
QUEUE_DATABASE_URL=                   # send-only: the api enqueues, never runs a handler
SENTRY_DSN=                           # optional
```

> If you ever serve marketing on `www.outrival.io`, widen the **hardcoded** CORS
> origin in `apps/api/src/index.ts` (currently `["https://outrival.io"]` only).

### `workers` (Netcup queue box — NOT Coolify)
The two workers and the queue Postgres run on a **separate server**
(`outrival-queue-01`, Netcup RS 1000 G12, `152.53.113.71`), driven by a plain
`docker compose` under `/opt/outrival`. There is no Coolify UI here.

**Env lives in `/opt/outrival/.env.worker` (0600), read once at boot** — appending
a var does nothing until the process restarts. Both services are built from
`apps/workers` (`Dockerfile.queue-light` / `Dockerfile.queue-browser`) and take the
job env (`DATABASE_URL`, `R2_*`, `AI_PROVIDER_*`, `ANTHROPIC_API_KEY`,
`RESEND_API_KEY`, `EXA_API_KEY`, `PROXYSCRAPE_DC_*`, `POSTHOG_API_KEY`, `SENTRY_*`,
plus the tuning knobs in `.env.example`) plus:
```
WORKER_ROLE=light                     # or browser — one value per service, not both
QUEUE_DATABASE_URL=                   # the local queue Postgres, NEVER the Neon serverless branch
SCRAPE_CONCURRENCY=3                  # browser service only
HEARTBEAT_URL=                        # light service only (it owns cron)
```
`QUEUE_DATABASE_URL` also goes on the **`api`** service **in Coolify** — the API
enqueues (send-only: never a handler, never cron) and reaches the queue box over
the WireGuard tunnel (`10.10.0.1:5432`, no public bind). Without it, every route
that fires a job 500s while the rest of the API keeps serving. The password lives
in three places at once: `.env.worker`, Coolify, and the `outrival` role — rotate
all three in one shell.

Compose files, WireGuard config and the full rebuild-from-scratch runbook are
mirrored in `infra/queue-box/` (copies for disaster recovery — nothing there is
applied automatically; edit on the box, mirror in the same commit).

#### Sizing on the Netcup RS 1000 (8 GB shared by all three)

The queue Postgres, the light worker and the browser worker share one box, so the
limits are what stop a Chromium spike from taking down the queue everything else
depends on. They are set in `docker-compose.override.yml`
(`deploy.resources.limits.memory`), not in any UI:

| Service | Memory limit | Notes |
|---|---|---|
| `queue-postgres` | 512 MB | Tiny working set (job rows only), but it must never be the one that gets OOM-killed — everything else is idle without it. |
| `workers-light` | 1 GB | Crons, AI lane, extracts, digests, alerts. No browser. |
| `workers-browser` | 4–5 GB | Chromium is out-of-process per page; `SCRAPE_CONCURRENCY=3` is sized for this ceiling. |

Also on the **browser** service:
- **`shm_size: 1g`**. Chromium's default 64 MB `/dev/shm` causes renderer crashes
  that surface as random scrape failures, not as OOM.
- **`stop_grace_period: 40s`** on BOTH workers. The code asks pg-boss for a 30 s
  graceful drain; Compose's 10 s default SIGKILLed it every time, and pg-boss
  cannot observe a SIGKILL — the job stays `active` until `expireInSeconds` (900
  for `scrape-monitor`), then retries, and three of those mark the monitor
  unscrapable. Measured cost: up to 45 scrapes on 2026-08-01 alone.

If real load OOMs the browser worker, the fix is a bigger box (RS 2000, 16 GB —
in-place upgrade at Netcup, no migration), NOT raising concurrency on this one.
Watch `/admin` → queue backlog: a growing `scrape-monitor` queue with no failures
means the concurrency is the bottleneck; failures with no backlog means memory is.

## Stripe webhook

Add endpoint `https://api.outrival.io/api/stripe/webhook` in the Stripe dashboard
→ set `STRIPE_WEBHOOK_SECRET`. The route is mounted before auth (verified by
signature). The `stripe listen` in `pnpm dev` is dev-only.

## Deploy order

1. Provision Neon / Upstash / R2 / Cloudflare DNS (proxied) / Stripe webhook.
2. **OVH box**: follow the Notion runbook (Phases 0–4, 7).
3. **Netcup queue box**: `infra/queue-box/README.md` (WireGuard first, then
   Postgres, then the workers) → **run the browser test (blocker #1)**.
4. Coolify `api` app (Dockerfile, env, pre-deploy migrate command), then `web` app
   (Dockerfile, build args, domain).
5. Smoke test (below).

## Smoke test (end to end)

- [ ] **Login OTP → /dashboard loads** (proves the cross-subdomain cookie; the #1
      auth trap). Test in a clean browser, not just localhost.
- [ ] Google OAuth round-trip (proves `WEB_URL` / trustedOrigins).
- [ ] Notifications bell connects (SSE through Cloudflare/Traefik).
- [ ] Add a competitor → scrape → signal appears (proves the pipeline + browsers).
- [ ] A Stripe test webhook hits `/api/stripe/webhook`.
- [ ] Sentry + uptime (BetterStack) receiving events.

### pg-boss additions to the smoke test

- [ ] `/admin` → queue health lists the queues with live counts (proves the API's
      send-only client reaches the queue Postgres).
- [ ] Force a re-scan from the UI → the job appears in `/admin/jobs` and completes
      (proves API-enqueue → browser-worker execution end to end).
- [ ] Weekly digest + an alert email actually send (light worker).
- [ ] **Dead-letter queue is empty** (`/admin` → queue health).
- [ ] The heartbeat monitor has received a ping in the last 5 min.
- [ ] The five previously cron-less jobs each ran at least once: `ai-capacity-check`,
      `ops-health-check`, `feedback-pattern-detection`, `purge-retention`,
      `detect-silent-monitors` (check `/admin/jobs` filtered by queue name).
