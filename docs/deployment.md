# Deployment — OVH VPS + Coolify

Code-side companion to the Notion runbook *"🚀 Runbook — Mise en prod (OVH VPS +
Coolify)"*. The runbook covers the server (hardening, UFW/fail2ban, swap,
Cloudflare proxied, backups) — follow it as-is. **This file covers what the
runbook does not: the app-specific config that breaks a deploy if missed.**

## Topology (decided)

- **Jobs run on Trigger.dev v4 Cloud** (`project: proj_syxlttkfpjwsjmkdnmhp`).
  There is **no "workers" service on the VPS** — `apps/workers` has no `start`
  script and nothing to run continuously. Jobs ship via `trigger deploy` (below).
- **Two Coolify apps from this one repo**, behind Cloudflare (proxied, Full strict):
  - `web` → `https://outrival.io` (Next.js 16, Node, standalone)
  - `api` → `https://api.outrival.io` (Hono on Bun)
- **Managed**: Neon (Postgres), Upstash (Redis), Cloudflare R2.

> The runbook's *"App 2 — Workers"* Dockerfile (Playwright image + `patchright
> install` + `camoufox fetch`) assumes **self-hosted** scraping. With Trigger
> Cloud the browsers run on Trigger's machines, so that container is **not**
> deployed here. The browser-binary problem it anticipates still exists — it just
> moves into the Trigger build (see *Browser binaries* below).

## ⚠️ Pre-launch blocker #1 — browser binaries on Trigger Cloud

The patch-20 cascade launches **patchright** (L1–L3, its own patched Chromium)
and **camoufox-js** (L4, a custom Firefox). Neither sets `executablePath`, and
**nothing in the repo installs those binaries for the Trigger deploy** — the
`playwright` build extension in `trigger.config.ts` installs *Playwright's*
Chromium only.

- **L4 Camoufox**: certainly absent (no `camoufox-js fetch` step anywhere).
- **L1–L3 patchright**: at risk (depends on whether patchright's postinstall ran
  and wasn't skipped during Trigger's build).
- **L0 fetch**: fine (no browser).

**Test before launch**: `trigger deploy`, then force a scrape on a JS/protected
site that escalates past L0 and watch `scrape_runs.level` + the run logs. If the
browsers are missing:

1. **Custom Trigger build extension** that runs `npx patchright install chromium`
   + `npx camoufox-js fetch` at deploy build and sets `CAMOUFOX_EXECUTABLE`
   (keeps Trigger Cloud — preferred).
2. Self-host the scraping jobs (runbook's App 2 Dockerfile) — hybrid, heavier.
3. Launch **L0-only** first (many sites scrape fine via direct fetch) and wire the
   browsers right after.

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
> git branch + Trigger staging env + Stripe **test** keys + an
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
TRIGGER_SECRET_KEY=                   # api triggers tasks via @trigger.dev/sdk
SENTRY_DSN=                           # optional
```

> If you ever serve marketing on `www.outrival.io`, widen the **hardcoded** CORS
> origin in `apps/api/src/index.ts` (currently `["https://outrival.io"]` only).

### Trigger.dev Cloud (set in the Trigger dashboard, NOT Coolify)
`DATABASE_URL`, `R2_*`, `GROQ_API_KEY`/`AI_PROVIDER_*`, `ANTHROPIC_API_KEY`,
`RESEND_API_KEY`, `EXA_API_KEY`, `PROXYSCRAPE_*`, `CAMOUFOX_*`, `POSTHOG_API_KEY`,
`SENTRY_*`, and the patch tuning knobs (see `.env.example`).

## Stripe webhook

Add endpoint `https://api.outrival.io/api/stripe/webhook` in the Stripe dashboard
→ set `STRIPE_WEBHOOK_SECRET`. The route is mounted before auth (verified by
signature). The `stripe listen` in `pnpm dev` is dev-only.

## Deploy order

1. Provision Neon / Upstash / R2 / Cloudflare DNS (proxied) / Stripe webhook.
2. Server: follow the Notion runbook (Phases 0–4, 7).
3. `trigger deploy` → **run the browser test (blocker #1)**.
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
