# Outrival audit 2026-09-02

Scope: architecture, OWASP security, performance, code quality, delivery chain.
Measured on branch `audit/2026-08-16-fixes` at `c3c72096` (later commits on the branch do not touch the cited lines).
Prior audit: `docs/audits/2026-08-16/REPORT.md` (ids `code:SEC-NN`, `COR-NN`, `PER-NN`, `ux:NN`). Its remediation landed on this branch (`81a2b730..ee391589`, 20 commits): COR-01, COR-02, COR-08, SEC-01..05, SEC-08, SEC-14, PER-04/06/16/38, N+1 batch, WCAG, hydration. Findings below are new unless `prior:` says otherwise.

## Legend
- id: `S` security, `P` perf/ops, `D` delivery/infra, `Q` quality, `A` architecture. Ids are stable; `sev` may be re-triaged.
- sev: `P0` critical/blocking, `P1` major, `P2` debt.
- status: `open` | `fixed <sha>` | `partial <sha> <what remains>` | `wontfix <why>` | `dup <id>`. Update in place, never delete a row.
- where: `path:lines` at the HEAD above. If lines drifted, relocate by the quoted symbol.
- effort: `S` under 2 h, `M` under 1 day, `L` over 1 day.
- verify: the command or test that proves the fix. A fix without its verify line is not done.

## Status index
| id | sev | status | effort | title |
|---|---|---|---|---|
| S-01 | P0 | fixed 54512f71 | S | Password sign-up exposed with email never verified (account pre-hijack) |
| S-02 | P0 | fixed 54512f71 | M | Sign-in performed on GET with the OTP in the URL |
| S-03 | P0 | fixed 54512f71 | M | Client IP taken from spoofable headers; every public rate limit bypassable |
| D-01 | P0 | open | M | Known-vulnerable deps in prod (next, hono, sharp, undici); CI audit is `|| true` |
| S-04 | P1 | fixed c68b516a | S | RBAC is binary; billing has no role check |
| S-05 | P1 | fixed c68b516a | S | Hono API without secureHeaders/bodyLimit; localhost trusted in prod |
| S-06 | P1 | fixed c68b516a | S | Public report token URL cached `public`, links never expire |
| S-07 | P1 | open | M | At-rest encryption key optional, plaintext accepted, no rotation, empty-key HMAC |
| S-08 | P1 | fixed c68b516a | S | In-process session cache keyed by raw token; revocation lags 30 s |
| S-09 | P1 | open | M | SSRF residual: no DNS pinning in safeFetch; unguarded fetch sites; queue DB on the same WireGuard net |
| S-10 | P1 | partial c68b516a | S | Fail-open guards: NODE_ENV defaults to development; Sentry token as build ARG |
| P-01 | P1 | open | M | No index on Better Auth FK columns and 4 app columns |
| P-02 | P1 | open | S | Queue: synchronous_commit=off and retryLimit 0 on key jobs |
| D-02 | P1 | open | M | Mutable `:latest` tag, no post-deploy gate, Node/turbo drift, root legacy Dockerfile |
| S-11 | P2 | open | S | JSON-LD innerHTML without `<` escaping; no script-src CSP |
| S-12 | P2 | open | S | 404 before 403 leaks cross-tenant id existence |
| S-13 | P2 | open | S | Stripe webhook has no event-id idempotency store |
| P-03 | P2 | open | S | Playwright lifecycle not centralised; orphan Chromium on throw |
| P-04 | P2 | open | S | `briefCache` Map never evicts |
| P-05 | P2 | open | S | OpenAI clients have no request timeout (SDK default 10 min) |
| P-06 | P2 | open | S | List endpoints without limit on growing tables |
| D-03 | P2 | open | M | Config sprawl: 1000-line .env.example, direct process.env reads, domain drift |
| Q-01 | P2 | open | L | God files: competitors.ts 3911 lines / 48 routes |
| Q-02 | P2 | open | L | 160 silent catches, 83 in scrapers |
| Q-03 | P2 | open | M | Request bodies and jsonb cast instead of zod-parsed |
| Q-04 | P2 | open | M | 4 libs duplicated api/workers; 133 console.*; email in logs |
| Q-05 | P2 | open | M | Test gaps: db 2 files, queue 1, no auth-surface test |
| A-01 | P2 | open | M | Two user tables synced by hand (`user` vs `users`) |

## Findings

### S-01 · P0 · fixed 54512f71 · Password sign-up exposed, email never verified (account pre-hijack)
- where: apps/api/src/lib/auth.ts:84-88 `emailAndPassword { requireEmailVerification: false }`; apps/web/src/app/(auth)/auth/auth-form.tsx:218 (front only calls `signIn.email`); apps/api/src/index.ts:112-114 (catch-all exposes `POST /api/auth/sign-up/email`); lib/auth.ts:264-272 (no rate rule for `/sign-up/email`); lib/auth.ts:281-310 (hook blocks disposable/dupe, not third-party emails)
- prior: 2026-08-16 §7.1 gap sweep, unrefuted
- impact: attacker registers victim's email with own password; victim's later OTP/Google sign-in links to that user; attacker keeps password access to the workspace (competitors, CRM tokens, billing). Also email enumeration and unbounded account creation.
- fix: `emailAndPassword: { enabled: true, disableSignUp: true, requireEmailVerification: true, minPasswordLength: 12 }`; add `"/sign-up/email": { window: 60, max: 3 }` to `rateLimit.customRules`.
- verify: `curl -X POST $API/api/auth/sign-up/email -H 'content-type: application/json' -d '{"email":"x@y.io","password":"correct-horse-battery","name":"x"}'` returns 4xx; add `apps/api/test/auth-surface.test.ts` listing allowed `/api/auth/*` endpoints.
- fixed 54512f71: as proposed. Checked against prod first: 7 legacy credential-only accounts are unverified, none shows the pre-hijack shape (no second provider), and all keep access through the email-code flow the /auth page leads with. `disableSignUp` breaks nothing, `signUp` is exported in the web auth client but has zero call sites. The auth-surface test was deliberately skipped: `auth-step-up.test.ts` sorts first and its process-global `mock.module` answers any later import of `src/lib/auth`, so the assertion would read the mock and be green regardless. Verification is the curl line above, run on deploy.

### S-02 · P0 · fixed 54512f71 · Sign-in performed on GET with the OTP in the URL
- where: apps/api/src/lib/auth.ts:134-136 (`otp-link?email=&code=`); apps/api/src/routes/auth.ts:176-209 (`GET /otp-link` calls `auth.api.signInEmailOTP`, sets cookie); routes/auth.ts:41 (`authRateLimit` only on `/check-and-send-magic-link`)
- prior: code:SEC-22 (verified, effort S, fix risk high)
- impact: link scanners (Safe Links, Proofpoint, Gmail prefetch) consume the OTP (`allowedAttempts: 3`) and receive the session; OTP lands in CDN/proxy logs, history, Referer; route sits outside Better Auth's limiter.
- fix: GET renders a minimal HTML page with `<form method="post">`; `POST /otp-link` (with `authRateLimit`) redeems an opaque `t` token (Redis GETDEL, 10 min) for the OTP then calls `signInEmailOTP`. Mail carries `?t=<uuid>`; OTP stays in the mail body. Pattern already in `routes/digest-feedback.ts`.
- verify: `curl -I "$API/api/auth/otp-link?email=a@b.io&t=x"` returns 200 text/html with no `set-cookie`; POST path covered by test.
- fixed 54512f71: as proposed, with the handle in Better Auth's `verification` table rather than Redis. The OTP is already stored there by the emailOTP plugin, so this adds no new class of secret at rest, and it behaves identically in dev where Upstash is absent. `DELETE ... RETURNING` is what makes redemption single-use under concurrency. `POST /otp-link` carries `ipRateLimit("otp-link")`. Covered by 8 tests in `apps/api/test/auth-otp-link.test.ts`.

### S-03 · P0 · fixed 54512f71 · Client IP from spoofable headers; every public rate limit bypassable
- where: apps/api/src/middleware/auth-rate-limit.ts:32-35, apps/api/src/routes/auth.ts:23-29, apps/api/src/routes/contact.ts:32-35 (`cf-connecting-ip ?? x-forwarded-for[0] ?? "unknown"`, 3 copies, no peer check); middleware/auth-rate-limit.ts:20-24 (`incr` then `expire` only when `count === 1`, non-atomic); routes/auth.ts:129 (`overSignupIpCap` uses it)
- impact: if the OVH origin answers directly (Coolify default), forged `cf-connecting-ip` gives a fresh bucket per request: unlimited OTP mails (Resend cost, domain reputation), contact spam, signup cap void. Missing header collapses everyone into `"unknown"`: one abuser locks all users behind a corporate proxy.
- fix: one `clientIp(c)` in `packages/shared/src/http/client-ip.ts`: trust `cf-connecting-ip` only when `getConnInfo(c).remote.address` is in Cloudflare ranges, else the TCP peer, never `x-forwarded-for`; return 429 when null. Counter: `redis.multi().incr(key).expire(key, ttl, "NX").exec()` or `@upstash/ratelimit` slidingWindow. Box: UFW allows 443 from Cloudflare ranges only, or Authenticated Origin Pulls.
- verify: `curl -skI https://<OVH_IP>/health -H 'Host: api.outrival.app'` must not return 200 from outside Cloudflare; two requests with different forged `cf-connecting-ip` share one bucket.
- fixed 54512f71: the atomic counter and the fail-closed null are as proposed, the identity rule is not. This finding's premise that Cloudflare fronts the api does not hold. `api.outrival.app` and the apex both resolve to 151.80.58.65 (OVH, DNS-only) and only `www` is proxied, so `cf-connecting-ip` can only ever be forged here and trusting it under any condition is itself the bug. Coolify's Traefik runs with no `forwardedheaders.insecure` and no `trustedIPs`, which is its secure default: a client-supplied `x-forwarded-for` is stripped before the proxy writes its own. The identity is therefore the LAST element of that header, or the TCP peer when the peer is public. Helper sits in `apps/api/src/lib/client-ip.ts` rather than `packages/shared`: all three call sites are in the api and shared carries no hono dependency. Covered by 9 tests in `apps/api/test/client-ip.test.ts`.
- residual, config drift not code: two Coolify/DNS changes would silently break this. Turning on `forwardedheaders.insecure` makes `x-forwarded-for` caller-written again, and putting `api.outrival.app` behind Cloudflare makes the last element a CF edge address, collapsing every visitor into a handful of shared buckets. The box-level item in the fix above (UFW allowing 443 from Cloudflare ranges) does not apply as written, there are no CF ranges in this path to allowlist.

### D-01 · P0 · open · Known-vulnerable deps in prod; CI audit non-blocking
- where: .github/workflows/ci.yml:23 (`pnpm audit --prod --audit-level=high || true`); package.json:35-53 (17 `ignoreGhsas`, no reason, no date)
- data (pnpm audit --prod, 2026-09-02): 58 vulns, 26 high. next 16.2.6 < 16.2.11 (middleware/proxy bypass, DoS + SSRF via Server Actions, SSRF via rewrites); hono 4.12.28 < 4.12.34 (GHSA-54fx-42gc-7vw4); sharp 0.34.5 < 0.35.0 (libvips CVEs, decodes scraped images in the worker); undici 7.26.0 < 7.29.0 (cross-request info leak); fast-uri 3.1.2 < 3.1.4 (SSRF); @opentelemetry/core < 2.8.0 (unbounded memory via Baggage); @xmldom/xmldom via mammoth.
- note: web has no middleware/proxy, no Server Actions, static rewrites (apps/web/next.config.ts:90-101): the next advisories reduce to DoS here; hono serves the public API; sharp decodes scraped images in the worker.
- impact: published SSRF/DoS on the prod web framework; attacker-controlled images hit a vulnerable libvips in the worker; CI green throughout.
- fix: drop `|| true`; add `aquasecurity/trivy-action` (fs, HIGH,CRITICAL, exit-code 1, ignore-unfixed) and `gitleaks/gitleaks-action@v2`; bump next ^16.2.11, hono ^4.12.34, sharp ^0.35.0, undici ^7.29.0 one PR each (edit range, `pnpm install --lockfile-only`); keep an `ignoreGhsas` entry only with a dated reason in `docs/security/audit-ignores.md`, monthly review.
- verify: `pnpm audit --prod --audit-level=high` exits 0 in CI; `pnpm typecheck` green; web build in CI (not locally, OOM).

### S-04 · P1 · fixed c68b516a · RBAC is binary; billing has no role check
- where: packages/db/src/schema/users.ts:4 (`owner|admin|member`); only role checks: apps/api/src/routes/settings.ts:134, routes/feedback.ts:87, routes/digest-feedback.ts:127; apps/api/src/routes/billing.ts (no `role`/`owner` anywhere; checkout L230-231, portal, cancel)
- impact: any `member` upgrades, cancels or opens the Stripe portal; `admin` role exists in the enum only.
- fix: `requireRole(...roles)` middleware in `apps/api/src/middleware/require-role.ts` (reads `users.role`, 403 otherwise); `billingRouter.use("*", authMiddleware, requireRole("owner", "admin"))`; same on `settingsRouter.patch("/")`.
- verify: test: member token on `POST /api/billing/checkout` returns 403.
- fixed c68b516a: `requireRole()` in apps/api/src/middleware/require-role.ts, registered as `billingRouter.on(["POST"], "*", requireRole("owner", "admin"))` rather than per route, so a mutation added later inherits it. The two GETs stay open (the dashboard reads the plan on every page). Also on `settingsRouter.patch("/workspace")`, which is the workspace mutation the report meant by `patch("/")`.
- deviation: a user with no `orgId` passes the guard. `users.role` defaults to `member` and only `ensureUserOrg` promotes, on org creation, so a fail-closed check would 403 every brand-new account out of its own onboarding. Prod probe: 45/45 org-attached users are `owner`, the 4 `member` rows have no org.
- test: apps/api/test/require-role.test.ts, 4 cases (member 403, owner through, no-org through, GET open).

### S-05 · P1 · fixed c68b516a · Hono API without global hardening; localhost trusted in prod
- where: apps/api/src/index.ts (no `secureHeaders()`, no `csrf()`, no global `bodyLimit`; only routes/products.ts:112 and routes/onboarding.ts:329); index.ts:69-78 (CORS from raw `process.env.WEB_URL`); apps/api/src/lib/auth.ts:45-48 (`trustedOrigins` includes `http://localhost:3000` in prod); lib/auth.ts:62-63 (`process.env.BETTER_AUTH_SECRET!` bypasses env.ts)
- impact: a 200 MB JSON body exhausts the single Bun process (API outage); a page on a user's `localhost:3000` can make authenticated cross-site requests to prod; missing secret crashes on first call instead of boot.
- fix: `app.use("*", secureHeaders({ crossOriginResourcePolicy: "same-site" }))`; `app.use("*", bodyLimit({ maxSize: 1024 * 1024 }))` before mounts (upload routes keep their own); `trustedOrigins = env.NODE_ENV === "production" ? [env.WEB_URL] : ["http://localhost:3000", env.WEB_URL]`; read `secret`/`baseURL` from `env`.
- verify: `curl -X POST $API/api/contact -H 'content-type: application/json' --data-binary @2mb.json` returns 413; response carries `X-Content-Type-Options: nosniff`.
- fixed c68b516a: `secureHeaders({ crossOriginResourcePolicy: "same-site" })` and a 1 MB `bodyLimit` on `*`, with `/api/products/analyze-document` and `/api/onboarding/analyze-document` exempted by path (both accept 10 MB uploads). `trustedOrigins` drops localhost when NODE_ENV is production.
- deviation: `csrf()` not added, for the reason already recorded under Non-findings (JSON-only routes keep cross-site form POSTs out). `secret`/`baseURL` still read `process.env` in lib/auth.ts: that module is imported by the test suite, which runs without a DATABASE_URL, so pulling `env.ts` in would break CI. Boot-blocking is unchanged, index.ts imports `env` before lib/auth.
- residual: no unit test. index.ts cannot be imported under `bun test` (it parses the full prod env schema at import). Verified by the curl lines above after deploy.

### S-06 · P1 · fixed c68b516a · Public report token URL cached `public`; share links never expire
- where: apps/api/src/routes/public-report.ts:35 (`Cache-Control: public, max-age=300`), no rate limit on the router; apps/api/src/routes/share.ts:23-24 (`mintToken` = 2 UUIDs, no expiry column)
- impact: Cloudflare serves a revoked report for 5 min; a leaked link is valid forever; competitor and pricing data leave without trace.
- fix: `Cache-Control: private, no-store` + `X-Robots-Tag: noindex`; add `expiresAt` (default now + 30 d) on the share row and return 410 when past.
- verify: `curl -sI $API/api/public/report/<token> | grep -i cache-control` shows `no-store`.
- fixed c68b516a: `share_links.expires_at` NOT NULL, default `now() + interval '30 days'` (migration 0086); 410 past expiry; `private, no-store` + `X-Robots-Tag: noindex, nofollow`; `ipRateLimit("public-report", 60)` on the router. Every create-or-return in routes/share.ts now filters on `expiresAt > now()`, so "Share" never hands back a URL that already 410s; revoke deliberately does not, a lapsed link must still be killable.
- pending: migration 0086 is NOT applied. A shared env needs an explicit go.
- test: apps/api/test/share-expiry.test.ts, 7 cases.

### S-07 · P1 · open · At-rest key optional, plaintext accepted, no rotation, empty-key HMAC
- where: apps/api/src/env.ts:38-41 (`OAUTH_TOKEN_ENCRYPTION_KEY` optional in prod); packages/shared/src/secrets/at-rest.ts:102-105 (`readStoredSecret` returns legacy plaintext); apps/api/src/lib/oauth/token-store.ts:193-197 (`stateSecret()` = `BETTER_AUTH_SECRET`); apps/api/src/routes/digest-feedback.ts:52 (`BETTER_AUTH_SECRET ?? ""`)
- prior: code:SEC-08 fixed by bf09ddfd (CRM secret now encrypted); what remains is listed here
- impact: without the var, CRM refresh tokens are stored in clear in Neon; a DB dump equals CRM access for every customer; no rotation without a manual rewrite.
- fix: superRefine in env.ts requires the key when `NODE_ENV === "production"`; versioned keys `v2` (current) and `v1` (`OAUTH_TOKEN_ENCRYPTION_KEY_PREVIOUS`) in at-rest.ts; throw on unknown version after a backfill of plaintext rows; digest-feedback reads the secret from `env`.
- verify: boot with the var unset and `NODE_ENV=production` fails; `SELECT count(*) FROM oauth_connections WHERE access_token NOT LIKE 'v%.%'` is 0.

### S-08 · P1 · fixed c68b516a · In-process session cache keyed by raw token; revocation lags 30 s
- where: apps/api/src/middleware/auth.ts:27-31 (`TTL_MS` 30 s, `MAX_ENTRIES` 5000, `Map` keyed by token); auth.ts:89-98 (suspension read from the cached entry)
- impact: sign-out everywhere, admin suspension and password change take up to 30 s per instance; two instances hold two truths; a heap dump holds 5000 valid tokens.
- fix: key by `sha256(token)`; export `evictSession(token)` and call it from sign-out, admin suspend, set-password; multi-instance: Upstash `SETEX 30` with `DEL` on revoke.
- verify: test: suspend user then hit an authed route with the same cookie returns 401 immediately.
- fixed c68b516a: cache moved to apps/api/src/lib/session-cache.ts, keyed by `sha256(token)`. `evictUserSessions(userId)` rather than `evictSession(token)`: the paths that revoke (admin suspend, sign-out, revoke-session(s), change/set-password, delete-user) know the user, not every token they hold, and dropping one device would leave the other tab signed in. Wired in routes/admin/users.ts and behind a `REVOCATION_PATHS` wrapper around the Better Auth handler in index.ts.
- deviation: a Hono-level wrapper rather than a Better Auth `hooks.after`. The hook context shape could not be verified from the installed dist types and a silent no-op would be worse than an explicit, testable wrapper.
- residual: still per process. The Upstash half of the fix stays open and becomes a prerequisite, not an optimisation, the day a second api container exists.
- test: apps/api/test/session-cache.test.ts, 5 cases.

### S-09 · P1 · open · SSRF residual in workers on the queue DB's network
- where: packages/scrapers/src/lib/guarded-fetch.ts and lib/quick-fetch.ts:39-46 (hostname check per hop, no DNS resolution; gap documented at quick-fetch.ts:35); raw `fetch` to fixed third-party hosts only: backfill/wayback.ts:59,89 (`redirect: "follow"` toward archive.org), backfill/cdx.ts:72, news.scraper.ts:30 (news.google.com), github.scraper.ts:50, appstore-reviews.scraper.ts:35,170, trustpilot.scraper.ts:77,110; `page.goto` at scrape-patchright.ts:310, pricing/calculator/probe.ts:262, spa/api-capture.ts:72; infra/queue-box/docker-compose.yml exposes Postgres on 10.10.0.1:5432
- prior: SEC-02/03/04 fixed 3bd2aebc, SEC-14 fixed c12b28f4; every user-influenced URL already passes the hostname guard; the residual is DNS rebinding (check-then-connect gap) plus no egress filter on the worker network
- impact: a competitor domain that resolves to 10.10.0.1 after the check reaches the queue Postgres from the worker.
- fix: in safeFetch resolve with `dns.lookup`, reject non-public IPs, connect through an undici Agent pinned to the resolved address; migrate the user-influenced raw fetches to safeFetch; worker container egress: iptables REJECT RFC1918 + 169.254/16 except 10.10.0.1/32 tcp/5432.
- verify: unit test with a hostname resolving to 127.0.0.1 throws `SsrfBlocked`; from the worker container `curl 10.10.0.1:5432` from a non-app process is refused.

### S-10 · P1 · partial c68b516a · Fail-open guards; Sentry token as build ARG
- where: apps/api/src/env.ts:9 (`NODE_ENV .default("development")`); apps/api/src/lib/turnstile.ts:8-12 (bypass when secret unset); apps/api/src/middleware/auth-rate-limit.ts:27-28 (no-op without Upstash); env.ts:24 (`INTERNAL_API_SECRET` optional); apps/web/Dockerfile:26 (`ARG SENTRY_AUTH_TOKEN`)
- impact: an image started without `NODE_ENV=production` (manual compose, debugging on the box) runs with captcha, rate limit and internal secret disabled, silently; the Sentry token stays in builder layer history.
- fix: `NODE_ENV` defaults to `production`; `RUN --mount=type=secret,id=sentry_token SENTRY_AUTH_TOKEN=$(cat /run/secrets/sentry_token) pnpm build`.
- verify: `docker history` of the web image shows no token; `bun run src/index.ts` without NODE_ENV and without Upstash refuses to boot.
- fixed c68b516a: `NODE_ENV` defaults to `production` in apps/api/src/env.ts. Dockerfile, .env.local and bun-test all set it explicitly, so nothing observable changes; what changes is that an env which LOST the variable now fails closed instead of silently disabling captcha, rate limiting and the internal secret.
- open: the Sentry half. `RUN --mount=type=secret` touches the Coolify build and needs its own verified deploy, so it is deliberately not shipped blind here.

### P-01 · P1 · open · No index on Better Auth FK columns and 4 app columns
- where: packages/db/src/schema/auth.ts:82 `session.userId`, :91 `account.userId`, :107 `verification.identifier`, plus `twoFactor.userId`, `passkey.userId` (only `session.token` :77 is unique); packages/db/src/schema/feedback.ts:10-11 `orgId`,`userId`; `manual_snapshots.monitorId`; `organizations.stripeCustomerId` (looked up by stripe-webhook.ts:132,150,165)
- prior: PER-04/06/16/38 fixed 0059c191 covered app tables only
- impact: every OTP sign-in seq-scans `verification`; every session cache miss seq-scans `session`/`account` by userId; Neon bills the CPU and login latency grows with users.
- fix: `(t) => [index("session_user_idx").on(t.userId)]` etc. in schema; `pnpm db:generate`; edit the migration to `CREATE INDEX CONCURRENTLY`; Neon staging branch first, prod backup, `db:migrate:deploy`.
- verify: `EXPLAIN SELECT * FROM verification WHERE identifier = 'x'` shows Index Scan.

### P-02 · P1 · open · Queue: synchronous_commit=off and retryLimit 0 on key jobs
- where: infra/queue-box/docker-compose.yml (`synchronous_commit=off`); packages/queue/src/jobs.ts:218-334 (`retryLimit` 0|1, `expireInSeconds` 60-900, `deadLetter: PIPELINE_DLQ`); apps/workers/src/queue/handlers.ts:237-292 (terminal failure logged, no product alert)
- impact: an OS crash on the Netcup box drops the last pg-boss commits (a `completed` job replays or a `created` job vanishes); with `retryLimit: 0` a transient error (cold Neon, AI provider open circuit) is a lost monitor run, a missed change, no alert.
- fix: `retryLimit: 2, retryDelay: 60, retryBackoff: true` on monitor jobs (NonRetriable stays the opt-out); remove `synchronous_commit=off` or document the trade-off in docs/deployment.md; Slack alert when `PIPELINE_DLQ` depth > 0 for 15 min.
- verify: kill the worker mid-job, the job retries; DLQ alert fires in staging.

### D-02 · P1 · open · Mutable tag, no post-deploy gate, toolchain drift, root legacy Dockerfile
- where: .github/workflows/deploy.yml:125-127 (pushes `:latest` and `:sha`); infra/queue-box/docker-compose.override.yml (`image: …outrival-worker:latest`); deploy.yml:143-148 (`pull && up -d && prune`, no health gate, no rollback); ci.yml Node 20 vs images Node 22; package.json `"turbo": "latest"`; Dockerfile.worker:23-27 (`COPY . .` before `pnpm install`, cache busts every commit); apps/workers/Dockerfile.queue-browser:29-48 (runtime as root, `npm install -g` at build; legacy); infra/queue-box/docker-compose.override.yml `worker-light`/`worker-browser` have no `healthcheck` (only postgres has one, docker-compose.yml:69)
- impact: nobody can say which image runs or roll back in one command; a broken worker stays up until the next deploy; CI validates with a different Node/turbo than prod.
- fix: `image: …:${WORKER_IMAGE_TAG:?}` set to the git sha by deploy.yml; compose `healthcheck` on both workers (heartbeat file age under 2 min, source apps/workers/src/core/heartbeat.ts); after `up -d` poll `docker inspect …Health.Status` 60 s and redeploy `$PREV` on failure; ci.yml `node-version: 22`; pin turbo; delete Dockerfile.queue-browser; `COPY` manifests, install, then sources.
- verify: `docker compose config | grep image` shows a sha tag; a deploy with a failing healthcheck restores the previous tag.

### S-11 · P2 · open · JSON-LD innerHTML without `<` escaping; no script-src CSP
- where: apps/web/src/app/sample/page.tsx:44, components/blog/article-json-ld.tsx:10, components/landing/json-ld.tsx:145, components/landing/compare/structured-data.tsx:11; apps/web/next.config.ts:51-76 (HSTS, XFO, frame-ancestors only; comment L51-52)
- impact: static today; the first title sourced from a CMS/DB with `</script>` executes JS on outrival.app.
- fix: `JSON.stringify(data).replace(/</g, "\\u003c")` in one `jsonLd()` helper; `Content-Security-Policy-Report-Only` with nonce, `script-src 'self' 'nonce-…' https://challenges.cloudflare.com`.
- verify: unit test on the helper with `</script>` input.

### S-12 · P2 · open · 404 before 403 leaks cross-tenant id existence
- where: apps/api/src/routes/monitors.ts:57,212,388; routes/structural-changes.ts:69 (lookup by id, 404 if absent, then org check 403)
- impact: an authenticated user can enumerate whether a monitor/change id exists in another tenant (oracle only, no data).
- fix: return 404 in both cases (`if (!monitor || !competitor) return 404`).
- verify: test: foreign monitor id returns 404, not 403.

### S-13 · P2 · open · Stripe webhook has no event-id idempotency store
- where: apps/api/src/routes/stripe-webhook.ts:128-197 (no `event.id` persistence; mitigated by live re-retrieve L142,158); L191-194 (`plan_cancelled` emitted on every redelivery)
- fix: `stripe_events(id pk, type, received_at)`; `insert … onConflictDoNothing().returning()`; return early when empty.
- verify: replay the same event twice via Stripe CLI; second returns `{ duplicate: true }`.

### P-03 · P2 · open · Playwright lifecycle not centralised
- where: packages/scrapers/src/lib/scrape-patchright.ts:182,215 (`browser.close().catch(() => {})`); spa/api-capture.ts:31,79,82; pricing/calculator/probe.ts:185; apps/workers/src/core/generate-battle-card.ts:854; `closeScraperBrowsers` called only in verify-signal-delta.ts:177 and scrape-monitor.ts:997
- impact: a throw before `finally` leaves an orphan Chromium; browser worker memory climbs until restart, pg-boss expires the next jobs.
- fix: `withBrowser(fn)` helper with `try/finally` and a logged close failure; all launch sites use it.
- verify: `ps -C chrome | wc -l` stable across 50 jobs in staging.

### P-04 · P2 · open · `briefCache` Map never evicts
- where: apps/api/src/routes/signals.ts:428-432 (Map keyed `org:product`, 30 min TTL checked on read, no delete, no cap)
- impact: bounded by org×product count, so slow growth only; stale entries live until restart.
- fix: cap at 1000 entries with FIFO delete like `apps/api/src/lib/translate.ts:49-51`.
- verify: unit test inserting 1001 keys keeps size 1000.

### P-05 · P2 · open · OpenAI clients have no request timeout
- where: packages/ai/src/provider.ts:48 (`new OpenAI({ apiKey, baseURL, maxRetries: 0 })`, no `timeout`); only the pool health probe sets one (provider/provider-pool.ts:157-165, 10 s); callers in the API request path: routes/ask.ts (SSE), onboarding streaming
- impact: a stalled provider holds an API request and its Bun connection for 10 min; in workers the job hits `expireInSeconds` first and is retried against the same stalled provider.
- fix: `new OpenAI({ …, timeout: 60_000 })` and pass `signal: c.req.raw.signal` from SSE handlers so a closed tab cancels the upstream call.
- verify: unit test with a never-resolving fetch mock rejects within 60 s.

### P-06 · P2 · open · List endpoints without limit on growing tables
- where: apps/api/src/routes/structural-changes.ts:42-48 (`structuralChanges.findMany` by org competitors and status, `orderBy desc`, no `limit`, no time window, whole rows returned); routes/candidates.ts:627-640 (`competitorCandidates.findMany` status != added, no limit). Other 16 limit-less `findMany` in routes read plan-capped rosters (competitors, monitors, products), bounded by PLAN_LIMITS.
- prior: PER-14 (worker-side signals scan) is the same class; not fixed on the branch
- impact: an org monitoring 50 competitors for a year returns thousands of structural changes on every page load; response size and Neon read grow linearly, no pagination contract for the web.
- fix: `limit: 200` + `since` query param (default 90 days) on both; cursor pagination when the web needs more.
- verify: response of `GET /api/structural-changes?status=open` carries at most 200 rows and a `nextCursor`.

### D-03 · P2 · open · Config sprawl
- data (2026-09-02): 250 keys in .env.example vs 216 read in code. 20 read but undocumented: RESEND_FROM, RESEND_AUTH_FROM, SIGNUP_IP_DAILY_CAP, SIGNUP_MX_CHECK_ENABLED, SCRAPER_REGION, HIRING_FREEZE_*, AI_INTENSIVE_RATE_LIMIT, AI_CACHE_TTL_NAME_DAYS, EVAL_*. 38 documented but never read by a static name: AXIOM_*, PRICING_BACKFILL_*, NOTIFICATION_DAILY_EMAIL_CAP, QUIET_HOURS_DEFAULT_START, RELEVANCE_RECALC_INTERVAL_HOURS, SECTORAL_ANALYSIS_DAY, CONFIDENCE_DOT_THRESHOLD, AI_CACHE_TTL_ANALYZE_DAYS (AI_PROVIDER_3/4_* are read dynamically, keep them). Breaks `.claude/rules/production.md` §4.
- where: .env.example (over 1000 lines, tuning knobs mixed with secrets); direct `process.env.*` with local fallbacks in apps/api/src/lib/auth.ts:62-63, routes/share.ts:20, routes/billing.ts:27, index.ts:69; comments say outrival.io in lib/auth.ts, fallbacks say outrival.app
- fix: delete the 30 dead keys, document the 20 live ones in .env.example and docs/architecture/env.md; `.env.example` (boot minimum, ~40 lines) + `.env.tuning.example`; `import { env } from "./env"` everywhere, zero `process.env` outside env.ts; one `WEB_URL` source.
- verify: `grep -rn "process.env\." apps/api/src --include=*.ts | grep -v env.ts` is empty.

### Q-01 · P2 · open · God files
- where: apps/api/src/routes/competitors.ts (3911 lines, 48 routes; handlers of 407 lines ending L1710, 231 ending L1941, 136 ending L2789); apps/api/src/lib/signal-facts.ts (1900); apps/api/src/routes/signals.ts (1399)
- impact: unreviewable, constant merge conflicts, business logic untestable; the 407-line handler is the first N+1 suspect (none proven in this audit).
- fix: `routes/competitors/<sub-resource>.ts` under 400 lines each, logic in `lib/competitors/*-service.ts`; rule: handler = zod + service call + response, 60 lines max.
- verify: `wc -l apps/api/src/routes/competitors/*.ts` all under 400.

### Q-02 · P2 · open · Silent catches
- where: 160 `catch { return null|[]|false }` sites: scrapers 83, web 40, shared 12, api 11, workers 9, ai 3. Samples: packages/scrapers/src/blog/blog.scraper.ts:56,73; jobs/jsonld.ts:79,368,483; backfill/cdx.ts:77,85; content/parse.ts:53; apps/api/src/lib/landscape-data.ts:51,247; lib/signal-facts.ts:1898; apps/workers/src/core/ingest-audience-pages.ts:166,305
- impact: a failing scraper returns "nothing", the pipeline concludes "no change": invisible false negatives on the core feature, undiagnosable after the fact.
- fix: `catch (err) { logger.warn({ err, url, scraper }, "…"); return []; }`; oxlint `no-empty: error`; scrapers return `Result<T, E>` where the caller must branch.
- verify: `grep -rn -A1 'catch {' packages/scrapers/src | grep -c 'return'` trends to 0.

### Q-03 · P2 · open · Bodies and jsonb cast instead of parsed
- where: `(await c.req.json()) as { x?: unknown }` in apps/api/src/routes/auth.ts, routes/share.ts, routes/settings.ts:118; jsonb casts routes/share.ts:54,115, routes/public-report.ts:39,49; apps/web/src/lib/server-session.ts:11-21 (`[key: string]: unknown`)
- fix: zod schema + `safeParse` at every boundary (rule in .claude/rules/typescript.md); shared `SessionSchema` for the web gate.
- verify: `grep -rn "as {" apps/api/src/routes | wc -l` is 0.

### Q-04 · P2 · open · Duplicated libs, console.*, PII in logs
- where: apps/api/src/lib/{crm-webhook,resend,posthog,sentry}.ts vs apps/workers/src/lib/ same names (4 modules, all diverged); `console.*` in src: api 39, workers 40, ai 54; apps/api/src/routes/auth.ts:147 (`console.error` with the email)
- fix: move the 4 modules to `packages/shared/src/integrations/`; pino logger everywhere; oxlint `no-console: error` outside tests/scripts; log `emailHash` not email.
- verify: `grep -rn "console\." apps/api/src apps/workers/src packages/ai/src --include=*.ts | grep -v test | wc -l` is 0.

### Q-05 · P2 · open · Test gaps
- where: test files per package: scrapers 94, workers 56, api 53, shared 52, web 38, ai 29, db 2, queue 1; no test enumerates the exposed `/api/auth/*` surface
- fix: `apps/api/test/auth-surface.test.ts` (allow-list of auth endpoints); queue: `stopQueue` drain and deferral tests; db: migration journal monotonic test.
- verify: the three files exist and run in `pnpm test:local --filter`.

### A-01 · P2 · open · Two user tables synced by hand
- where: packages/db/src/schema/auth.ts `user` (Better Auth) and packages/db/src/schema/users.ts `users` (orgId, role); apps/api/src/lib/auth.ts:311-320 (`user.create.after` copies; nothing on update/delete)
- impact: `changeEmail` or a Better Auth delete leaves the app row stale: orphan roles/org, incomplete GDPR export.
- fix: short: `users.id REFERENCES user.id ON DELETE CASCADE` + `user.update.after` hook copying email; target: one table, `orgId`/`role` as Better Auth `additionalFields`.
- verify: change an email via Better Auth, `users.email` follows.

## Cleared (checked, no finding; do not re-audit without new evidence)
- IDOR: all 30 routers taking `:id` scope by org, via a competitor join (`monitors.ts:59-67` pattern, `resolveOwnedMonitor`) or `ownedSession` (onboarding-session.ts:125-130). Only S-12 (oracle) remains.
- `sql.raw` at apps/api/src/lib/ask/tools.ts:678,788 interpolates module constants only.
- No committed secrets (fixtures and `PHASES/07-monetisation.md:55-56` placeholders only); `.dockerignore` excludes `.env*`.
- `INTERNAL_API_SECRET` compared with `timingSafeEqual` (routes/internal.ts:15-21); OAuth state HMAC bound to orgId with 10 min TTL (token-store.ts:28,193-200; routes/oauth.ts:109-122).
- Step-up re-auth on set-password, 2FA enable/disable, backup codes, passkey registration, workspace delete.
- Module-level caches bounded: auth.ts (5000), translate.ts (500), favicon route (500), candidates `lastDetectAt` (deleted on completion). Exception P-04.
- `ensureUserOrg` (lib/org.ts:34-41) is race-safe through `ON CONFLICT (slug)` with `slug = org-<userId>`.
- Stripe signature verified on raw body (stripe-webhook.ts:103-126); subscription state re-read live before applying.
- Docker: api/web/worker images are multi-stage and run as `bun`/`node` (apps/api/Dockerfile:32-36, apps/web/Dockerfile:51-57, Dockerfile.worker:30-51); compose sets memory limits (light 1G, browser 4G, postgres 1.5G) and `shm_size`.
- Sentry `sendDefaultPii: false` in api, workers, web.
- Battle-card PDF: every interpolated value goes through `escapeHtml` (apps/workers/src/lib/battle-card-html.ts, 8 sites).
- Ask tools receive `orgId` from the server, never from the model (apps/api/src/lib/ask/tools.ts:14-23, `ownedCompetitor` L88-95).
- SSE routes set `X-Accel-Buffering: no` (routes/notifications.ts, routes/ask.ts); hono compress honors `no-transform`.
- Web: no middleware/proxy, no Server Actions, rewrites are static PostHog relays; dashboard layout redirects unauthenticated (apps/web/src/app/dashboard/layout.tsx:97); `NEXT_PUBLIC_*` carry no secret.
- R2 object keys are built from ids and timestamps only (`snapshots/<competitorId>/<source>/<iso>` at apps/workers/src/core/ingest-content-items.ts:911, scrape-ai-visibility.ts:437); no user string reaches `uploadToR2`.
- Worker job payloads are zod-parsed on entry: 33 `InputSchema` in apps/workers/src/core, 36 parse sites.
- Admin router applies `authMiddleware` then `adminMiddleware` on `*` (apps/api/src/routes/admin/index.ts:21-22); routes are read-only except DLQ redrive (admin/jobs.ts:37), audited via `logAudit`.
- pino `redact` rules in packages/shared/src/logger.ts:10; CI installs with `--frozen-lockfile` (ci.yml:18); auth cookie is cross-subdomain via `AUTH_COOKIE_DOMAIN` (lib/auth.ts:58-69) and JSON-only routes keep cross-site form POSTs out, so `csrf()` in S-05 is defense in depth.
- DB pool `max: 10`, `idle_timeout: 300` per process (packages/db/src/client.ts:6-12): 3 processes stay far under the Neon pooler cap.

## Remediation order
1. ~~S-01, S-02~~ done 54512f71. The auth-surface test (Q-05) stays open, see the S-01 note.
2. ~~S-03~~ done 54512f71. The UFW/origin-pull half does not apply, see the S-03 residual note.
3. D-01: CI gate, Trivy, gitleaks, 4 bumps. 1 day.
4. ~~S-05, S-04~~ done c68b516a. The `csrf()` half does not apply, see the S-05 note.
5. P-01 migration (staging first). ~~S-06~~ done c68b516a, migration 0086 not yet applied. Half a day.
6. S-07 key required + rotation + backfill. 1 day.
7. D-02 sha tag, health gate, Node 22, turbo pin, delete legacy Dockerfile. Half a day.
8. ~~S-08~~ done c68b516a. S-10: NODE_ENV done, Sentry build secret open. 1 hour.
9. P-02, S-09. 1 day.
10. Q-01, Q-02, Q-04, S-11, then the rest of P2. 1 week, one PR each.
