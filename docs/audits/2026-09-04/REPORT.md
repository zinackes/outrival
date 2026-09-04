# Audit 2026-09-04: codebase, docs, production

Read-only audit of the monorepo (`main` at `5136f9b6`, the sha deployed on api/web),
the docs tree and the two production boxes (OVH Coolify: web + api; Netcup: workers +
pg-boss Postgres) plus the Neon database. No file was changed and no outward-facing
action was taken. Follow-up of `docs/audits/2026-09-02/REPORT.md`: its 28 findings are
all still open and are not re-listed here (see "Still open from 2026-09-02").

Method: `pnpm typecheck`, `pnpm check:lint`, `pnpm test:fast`, `pnpm audit --prod
--json`, git/GitHub state, `ssh outrival-ovh` and `ssh outrival` (docker, disk, apt,
env key names only, backup logs), `psql` on the queue database (pg-boss archive) and on
Neon (`DATABASE_URL_PROD`).

## Headline

Two cron jobs have crashed on every run for weeks because a JS `Date` is interpolated
into a raw `sql` template (postgres.js has no serializer for `timestamp` OID 1114 and
dies in `Bind` because drizzle disables its date serializers): data retention has not been enforced and no `hiring_freeze` signal can
be emitted. The classify-change dead-letter queue holds 759 jobs nobody replays, so 60%
of last week's changes have no signal. `www.outrival.app` answers HTTP 526.

## Status index

| ID | Sev | Area | Finding | Status |
|---|---|---|---|---|
| P-01 | P0 | prod | `purge-retention` fails on every run (Date in raw sql) | fixed in #558, deploy pending |
| P-02 | P0 | prod | `detect-hiring-footprint` fails once it reaches `evaluateFreeze` | fixed in #558, deploy pending |
| P-03 | P0 | prod | `www.outrival.app` returns HTTP 526 | open |
| P-04 | P0 | prod | 759 jobs in `outrival-dlq`, nobody replays; AI pool 61% errors | open |
| P-05 | P1 | prod | 698 active monitors overdue > 24 h with no run since | open |
| P-06 | P1 | ops | Netcup box: kernel + libc6 pending, reboot required | open |
| P-07 | P1 | ops | OVH: 17.9 GB docker build cache + 5.4 GB dangling images | open |
| P-08 | P1 | ops | Backups: rclone 501 on attempt 1 of every run; Neon has no off-provider dump | open |
| P-09 | P1 | ops | Worker `.env` has 12 keys absent from `env.worker.example` | open |
| S-05 | P1 | security | api answers without HSTS / X-Content-Type-Options | fixed cac2e50b |
| S-06 | P2 | security | Browser worker runs as root with `--no-sandbox`; runtimes unpinned | open |
| D-03 | P1 | deps | 59 vulns (26 high): next, sharp, undici, postcss, hono; CI audit non-blocking | fixed 317fd537 |
| Q-06 | P1 | code | Raw-sql Date params have no guard; tests cannot catch them (PGlite) | open |
| Q-07 | P2 | code | 5 files over 1900 lines | open |
| G-01 | P1 | git | 106 untracked skill dirs (11.6 MB) will be swept by the next `git add -A` | resolved, committed in #558 |
| G-02 | P2 | git | 446 remote branches, 438 from merged PRs, no auto-delete | open |
| G-03 | P2 | git | `OUT-229` worktree: 16 unmerged commits, no PR, idle since 2026-08-29 | open |
| G-04 | P2 | env | `.env.example`: 7 dead vars, 12 live vars missing | open |
| C-01 | P1 | docs | `architecture.md` says Upstash is retired; `env.ts` boot-blocks prod without it | open |
| C-02 | P2 | docs | `architecture/env.md` claims to be complete, misses ~60 vars | open |
| C-03 | P2 | docs | Dead references: ClickHouse files, `.claude/rules/jobs.md` | open |
| C-04 | P2 | docs | 2026-09-02 audit: 28/28 still open; 35 historical files in `docs/` | open |

## Actions taken during this audit

- P-01, P-02: fixed in #558 (`caacc05c`). `cutoff` and `start` are bound as ISO strings;
  the helpers that go through the query builder keep the `Date`. Reproduced and verified
  through `db.execute` on the dev database. Deploy pending: worker image rebuild on
  `main`, then pull and restart on the Netcup box, then `completed` rows in `pgboss.job`.
- G-01: the third-party skills are tracked on purpose, committed in #558.
  `.agents/skills/` is the canonical copy written by the skills CLI, `.claude/skills/*`
  are symlinks into it, `agent/skills/` is a second full copy (3.6 MB) whose consumer is
  unknown. No secret and no file over 500 KB in the set. Follow-up: find which tool reads
  `agent/skills/`, delete it if none does.
- This report: committed in #558.

## Gates (all green)

- `pnpm typecheck`: 8/8 packages.
- `pnpm check:lint`: 77 warnings, 0 errors (unused imports; one `no-thenable` false
  positive at `apps/api/src/routes/competitors.ts:3406`, the key is a "previous count").
- `pnpm test:fast`: 13 tasks green (workers 513 pass).
- CI on `main` green at `5136f9b6`, the sha running on api and web. Worker image
  `ghcr.io/zinackes/outrival-worker:latest` built 2026-09-04 07:44Z, containers restarted
  07:46Z. Neon holds 86 migrations, last `0085_silky_stick`, hashes match `origin/main`.
- No cross-app imports, no secrets in tracked files, `.env.example` is the only env file
  committed. 28 TODOs, 1 `@ts-ignore` (a test), 6 `any` in source.

## Production

### P-01 `purge-retention` fails on every run (P0)

- Place: `apps/workers/src/core/purge-retention.ts:45`, `cutoff` is a `Date` interpolated
  as `${cutoff}` into `db.execute(sql\`...\`)` in nine DELETE statements (lines 52 to 114).
- Evidence: pg-boss archive shows 8 failed / 0 completed (2026-08-28 to 09-04, the whole
  visible window). Error: `TypeError: The "string" argument must be of type string or an
  instance of Buffer or ArrayBuffer. Received an instance of Date` at
  `postgres@3.4.9/src/bytes.js:22 str()` during `Bind`. The line dates from 2026-07-19
  (`2f85ced9`), so retention has most likely not run since then.
- Cause: drizzle's query builder maps a `Date` through the column (`toISOString()`), a raw
  `sql` template passes it as is. `drizzle-orm/postgres-js` replaces the postgres.js date
  serializers (OIDs 1082, 1083, 1114, 1184) with the identity function, so the `Date`
  object reaches `str()` on the wire and throws. Bare postgres.js serializes a Date fine
  (verified on the dev database), which is why it only shows through `db.execute`.
- Effect: free-plan history past `historyRetentionDays` is never deleted (Neon 146 MB).
- Fix (about 20 minutes): build the cutoff as a string,
  `const cutoff = new Date(...).toISOString()`, or cast `${cutoff}::timestamptz`. Then
  `docker exec outrival-worker-light` a one-off `purge-retention` and check the archive
  shows `completed`.

### P-02 `detect-hiring-footprint` fails in `evaluateFreeze` (P0)

- Place: `apps/workers/src/core/detect-hiring-footprint.ts:261-268`, `${start}` (a `Date`)
  four times inside `sql\`count(*) filter (where ...)\``.
- Evidence: 71 failed / 11 completed (2026-08-29 to 09-04). The 11 completions are runs
  that returned before reaching `evaluateFreeze` (no hiring history). Line dates from
  2026-07-31 (`fad9e0b0`).
- Effect: `hiring_freeze` has never been emitted; every extract-jobs run for a competitor
  with history burns its retries. `first_role_in_country` and `new_department_opened`
  are emitted before the crash and dedup on content hash, so no duplicates.
- Fix: same as P-01, `const start = new Date(...).toISOString()`; `hasJobsCaptureAfter`
  and `isBoardStable` take a `Date`, so keep both forms or pass the string through
  `new Date()` there. Drop the unused `isNull, lte, or` imports at line 4 while there.

### P-03 `www.outrival.app` returns HTTP 526 (P0)

- Cloudflare 526 = origin certificate invalid for that hostname: Traefik on OVH only
  holds a certificate for the apex, `www` is proxied but not configured in Coolify.
- Confirmed 2026-09-04 while fixing S-03: `www` resolves to 188.114.96.2 / 188.114.97.2
  (Cloudflare) while the apex and `api.outrival.app` both resolve to 151.80.58.65 (OVH,
  DNS-only). Only `www` is orange-clouded, which is also why the api never sees a
  `cf-connecting-ip` header.
- Fix (5 minutes): Cloudflare Redirect Rule `www.outrival.app/*` to
  `https://outrival.app/$1` (301). Alternative: add `www.outrival.app` to the web
  service's domains in Coolify so Traefik issues a certificate.

### P-04 Dead-letter queue and AI pool (P0)

- `outrival-dlq` holds 759 jobs (519 `created`, 240 `retry`), oldest 2026-08-26, all
  `classify-change` payloads `{changeId, __deferrals: 5}` (the `QUEUE_MAX_DEFERRALS`
  cap in `packages/queue/src/boss.ts:47-53`). Nothing consumes the DLQ.
- Effect: last 7 days, 449 of 746 changes (60%) have no signal and are not suppressed
  as cosmetic; last 30 days, 1712 of 2577. Signals per day, last 7 days:
  62, 4, 61, 49, 55, 57, 15.
- AI pool, last 24 h: 481 errors / 311 successes (61% errors); cerebras 223 errors / 0
  success. Since the wave-2 deploy (07:46Z): mistral `rate_limited` 71, groq
  `no_providers` 48, `breaker_open` 21, 8 successes.
- Decision needed: replay the DLQ (re-enqueue `classify-change` with `__deferrals`
  reset, throttled, once the pool recovers) or purge it. Belongs to wave 3 of
  `docs/plans/ai-pool-reliability-audit.md`. Replay is an outward-facing action.

### P-05 698 monitors overdue with no run (P1)

- Active, not unscrapable, not refused, `next_run_at` more than 24 h in the past and no
  `scrape_runs` row since: 698 of 3345 monitors (21%). By source: homepage 98,
  pricing 95, blog 76, news 75, subdomains 51, jobs 51, wellknown 50, hackernews 49.
- Throughput last 24 h: `no_change` 265, `success` 249, `failed` 72. Top failure reasons
  over 7 days: `cloudflare_challenge` 139, `no_roadmap_portal` 104,
  `crtsh_unavailable` 93. Blog: 128 of 359 monitors flagged unscrapable. Docs source:
  `no_docs_surface` 57, `no_docs_index` 18, `No scraper for source type: docs` 4
  (`packages/scrapers/src/index.ts:67`, the 3-strike pause documented in
  `packages/shared/src/sources/catalog.ts:222-231` handles it).
- To check: the enqueue budget of `schedule-scraping` versus the browser worker's daily
  capacity (~600 runs/day). Either raise the budget or lower frequencies per plan.

### P-06 Netcup box needs a reboot (P1)

Kernel `6.8.0-137` and `libc6` pending, uptime 46 days, `/run/reboot-required` set.
About 2 minutes of downtime for `outrival-pg`, `outrival-worker-light`,
`outrival-worker-browser`. Outward-facing: needs a go.

### P-07 OVH disk (P1)

Docker build cache 17.9 GB (14.6 GB reclaimable) plus 5.4 GB dangling images on a 72 GB
disk at 46%. `docker builder prune -af --filter until=168h && docker image prune -f`.
Needs a go.

### P-08 Backups (P1)

- Queue Postgres: `infra/queue-box/backup.sh` (`pg_dump | age | rclone copy`, 30 days)
  lands a dump every day (last `queue-20260904-0417.dump.age`). Every run (35 of 35)
  fails attempt 1 with `501 NotImplemented` from R2 and succeeds on retry: the log is
  permanently red, a real failure would not stand out. Run once with `rclone -vv` to
  find the unsupported call and disable it (`--s3-no-check-bucket` is the usual one).
- Neon (the business database, 146 MB) is covered only by Neon's own point-in-time
  restore; there is no off-provider dump. Adding a nightly `pg_dump` of
  `DATABASE_URL_PROD` to the same script is about 30 minutes.

### P-09 Worker env drift (P1)

`/opt/outrival/.env.worker` holds 12 keys that `infra/queue-box/env.worker.example` does
not: `R2_ACCESS_KEY_ID R2_ACCOUNT_ID R2_BUCKET_NAME R2_SECRET_ACCESS_KEY
GEMINI_API_KEY OAUTH_TOKEN_ENCRYPTION_KEY AI_DEFER_BASE_SEC AI_DEFER_JITTER_FRACTION
AI_VISIBILITY_GEMINI_MODEL PRUNE_HTML_MAX_CHARS QUEUE_MAX_DEFERRALS
SCRAPING_LEVEL_1_ENABLED`. `FAITHFULNESS_MIN_RATIO` is in the example but not on the
box. A rebuild from the runbook would silently drop the OAuth encryption key and R2.
On the api container, `INTERNAL_API_SECRET` is unset (internal routes answer 404,
`apps/api/src/routes/internal.ts:10-16`) and `TRUSTPILOT_API_KEY` is unset (the
trustpilot source is dead in prod).

## Security

### S-05 api security headers (P1) — fixed cac2e50b

`api.outrival.app` answers without `Strict-Transport-Security` and
`X-Content-Type-Options`; the web app sends both. Add hono's `secureHeaders()` in
`apps/api/src/index.ts`.

Fixed cac2e50b together with S-05 of the 2026-09-02 report: `secureHeaders({
crossOriginResourcePolicy: "same-site" })` runs on every response, plus a 1 MB
global `bodyLimit` with the two document-upload routes exempted by path.

### S-06 Browser worker as root, unpinned runtimes (P2)

- `apps/workers/Dockerfile.queue-browser:27` runs as root ("for parity with the Trigger
  runners", Trigger is gone) and `packages/scrapers/src/lib/proxy.ts:57` passes
  `--no-sandbox`. api, web and queue-light run as `bun` / `node`.
- Worker image is pulled by the mutable `:latest` tag; `Dockerfile.queue-light:26` uses
  `oven/bun:1-slim`, so prod runs Bun 1.4.0 while local is 1.3.13. Pin both.

### Still open from 2026-09-02 (verified today)

- ~~S-01~~ `requireEmailVerification: false`: fixed `54512f71`.
- ~~S-02~~ sign-in on GET with the OTP in the URL: fixed `54512f71`.
- ~~S-03~~ rate limits keyed on spoofable headers: fixed `54512f71`. Note for P-03
  below: that work established the api is *not* behind Cloudflare, only `www` is.
- ~~S-04~~ billing had no role check: fixed `cac2e50b`.
- ~~S-05~~ no global hardening, localhost trusted in prod: fixed `cac2e50b`.
- ~~S-06~~ share links never expired, report cached `public`: fixed `cac2e50b`;
  migration 0086 applied on prod 2026-09-04.
- ~~S-08~~ session cache keyed by the raw token, revocation lagged 30 s: fixed
  `cac2e50b`; the multi-instance half stays open.
- S-10 fail-open guards: `NODE_ENV` now defaults to production (`cac2e50b`); the Sentry
  build-token half is still open.
- ~~D-01~~ vulnerable deps and the non-blocking CI audit: fixed `317fd537` (the same work
  as D-03 below).
- The other 18 findings: none has a commit since `70013d0a` (#551).

## Dependencies

### D-03 59 vulnerabilities, CI audit non-blocking (P1) — fixed 317fd537

`pnpm audit --prod`: 0 critical, 26 high, 10 moderate. High, by package: `next`
^16.2.6 needs >= 16.2.11, `sharp` ^0.33.5 / ^0.34.5 needs >= 0.35.0, `undici`,
`postcss`, `js-yaml` (via gray-matter), `nanoid`, `fast-uri`, `browserslist`,
`brace-expansion`. Moderate: `hono` ^4.12.25 needs >= 4.12.34, `dompurify` via
posthog-js. `.github/workflows/ci.yml:23` runs `pnpm audit --prod --audit-level=high ||
true`; its comment says the npm endpoint returns 410, but it answers today (retry on
`ERR_SOCKET_TIMEOUT`). `package.json` ignores 11 GHSAs via `pnpm.auditConfig`.

Fixed 317fd537, together with D-01 of 2026-09-02: same finding, seen from the other
report. The ignore list held 17 ids, not the 11 counted here; the 2026-09-02 report had
it right, and all 17 are gone. Detail, deviations and the residual trivy risk live under
D-01 in `docs/audits/2026-09-02/REPORT.md`; the standing policy is
`docs/security/audit-ignores.md`.

## Codebase

### Q-06 Raw-sql Date params have no guard (P1)

Only the two sites above interpolate a `Date` into `sql` (grep over `apps/*`). The
worker tests run on PGlite (`test/db-harness.ts`), which serializes Dates fine, so the
suite is green while prod crashes. Options: a `sqlTimestamp(d: Date)` helper in
`@outrival/db` returning `sql\`${d.toISOString()}::timestamptz\``, or an oxlint
`no-restricted-syntax` rule on `${...}` of Date type (not typed-aware; the helper is the
realistic guard).

### Q-07 Large files (P2)

`apps/web/src/lib/api.ts` 4984 lines, `apps/api/src/routes/competitors.ts` 3922,
`apps/workers/src/core/scrape-monitor.ts` 2784,
`apps/web/src/components/onboarding/onboarding-form.tsx` 2226,
`apps/web/src/components/dashboard/signals-view.tsx` 1932. Already Q-01 in the previous
audit.

## Git and environment

### G-01 Untracked skill directories (P1)

106 untracked directories from third-party skill installs at 10:20 today:
`.agents/skills/*` (5.1 MB), `.claude/skills/*` (2.9 MB, only `impeccable/` is
gitignored), `agent/skills/*` (3.6 MB), plus `.claude/skills/programmatic-seo/` deleted
and `skills-lock.json` +318 lines. Under the `git add -A` rule the next commit on any
branch sweeps 11.6 MB of MIT-licensed skills into the repo. Decide before committing:
gitignore `.agents/`, `agent/` and the new `.claude/skills/*`, or commit them on purpose.
Resolution: committed on purpose in #558 (see "Actions taken").

### G-02 Remote branches (P2)

446 remote branches, 438 belong to merged PRs. Repository setting
`delete_branch_on_merge` is `false`. Enable it and prune once (outward-facing).

### G-03 Worktrees (P2)

8 worktrees. `wt-probe`: merged, delete. `seo`: 159 commits behind `main`, last touch
2026-08-01. `OUT-229`: 16 commits ahead, 34 behind, no PR, last commit 2026-08-29; push
it or open a draft PR so the work is not local-only.

### G-04 `.env.example` drift (P2)

Dead (in the example, read nowhere): `AXIOM_DATASET AXIOM_TOKEN
RELEVANCE_RECALC_INTERVAL_HOURS AI_CACHE_TTL_ANALYZE_DAYS SECTORAL_ANALYSIS_DAY
SPA_DETECTION_HTML_MIN_TEXT_LENGTH AI_VISIBILITY_MIN_PROMPTS_FOR_SIGNAL`.
Live but missing from the example: `AI_INTENSIVE_RATE_LIMIT RESEND_FROM RESEND_AUTH_FROM
SIGNUP_IP_DAILY_CAP SIGNUP_MX_CHECK_ENABLED SCRAPER_REGION HIRING_FREEZE_CLOSED_RATIO
HIRING_FREEZE_MAX_OPENED HIRING_FREEZE_MIN_OPEN HIRING_FREEZE_WINDOW_DAYS
AI_VISIBILITY_MIN_RUNS_FOR_SIGNAL AI_CACHE_TTL_NAME_DAYS`.

## Docs

### C-01 Upstash contradiction (P1)

`docs/architecture.md:75` says Upstash was retired. `apps/api/src/env.ts:43-47` makes
`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` required in production and
`docs/deployment.md:29,242` lists them as managed. The prod api container has them.
Fix the line in `architecture.md`.

### C-02 `docs/architecture/env.md` incomplete (P2)

Announces a complete list (485 lines) but about 60 variables present in `.env.example`
are absent (`AUTH_COOKIE_DOMAIN`, `UPSTASH_*`, `ADMIN_EMAILS`, `SENTRY_*`, `POSTHOG_*`,
`SCRAPE_*`, `PIVOT_*`, ...). Either generate the table from `.env.example` or drop the
"complete" claim.

### C-03 Dead references (P2)

`docs/staged-extraction.md:143,234,261` describe ClickHouse files that were retired.
`.claude/skills/outrival-new-source/SKILL.md:136` points to `.claude/rules/jobs.md`,
which does not exist.

### C-04 Audit debt and archive (P2)

`docs/audits/2026-09-02/REPORT.md`: 28 findings, all `open`; the remediation commit
`70013d0a` addressed the 2026-08-16 audit, not this one. `docs/` holds 47 files including
10 dated audits and 25 `PHASES` files; move the historical ones under `docs/archive/`.

## Business snapshot (Neon, 2026-09-04)

49 organizations (35 free, 10 pro, 4 business), 49 users, 418 competitors, 3345
monitors. Signups: 6 in 7 days, 10 in 30 days. 4 organizations have no competitor.
Database 146 MB; queue database 16 MB.

## Appendix: reproduce

```sql
-- pg-boss archive, failed vs completed per job (queue database)
select name, state, count(*), min(created_on), max(created_on)
from pgboss.job where name in ('purge-retention','detect-hiring-footprint')
group by 1,2 order by 1,2;

-- dead-letter queue
select state, count(*), min(created_on) from pgboss.job
where name = 'outrival-dlq' group by 1;

-- changes without signal, last 7 days (Neon)
select count(*) filter (where s.id is null and c.suppression_reason is null), count(*)
from changes c left join signals s on s.change_id = c.id
where c.detected_at > now() - interval '7 days';
```

```bash
pnpm audit --prod --json | jq '.metadata.vulnerabilities'
ssh outrival 'cat /var/run/reboot-required; grep -c 501 /var/log/outrival-backup.log'
ssh outrival-ovh 'docker system df'
curl -sI https://www.outrival.app | head -1
```
