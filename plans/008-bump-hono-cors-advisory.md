# Plan 008: Bump `hono` past the CORS origin-reflection advisory (≥ 4.12.25)

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result. If anything in "STOP conditions" occurs,
> stop and report. When done, update this plan's row in `plans/README.md` unless a
> reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 413a153..HEAD -- apps/api/package.json pnpm-lock.yaml`
> If either changed, re-check the installed `hono` version before proceeding.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security / dependencies
- **Planned at**: commit `413a153` (`origin/main`), refined 2026-07-08
- **History**: first execution (against `9f4afd3`) STOPPED — the plan's original
  `pnpm --filter @outrival/api update hono@^4.12.25` command re-resolved the ENTIRE
  workspace (drizzle/pglite peer, next, react, stripe, sentry, playwright, radix… ~1967/2653
  lockfile churn), tripping the scope guard. This revision replaces `pnpm update` with a
  conservative edit-then-`install --lockfile-only`, which the reviewer verified stays minimal.

## Why this matters

`apps/api` pins `hono@^4.12.22`; the lockfile resolves `hono@4.12.22`, below `4.12.25` and
subject to the Hono CORS-middleware origin-reflection advisory **GHSA-88fw-hqm2-52qc** (high:
"CORS Middleware reflects any Origin with credentials"), plus four moderate hono advisories
(GHSA-wwfh-h76j-fc44, -j6c9-x7qj-28xf, -rv63-4mwf-qqc2, -wgpf-jwqj-8h8p), all `< 4.12.25`. Hono
is a **direct** runtime dep and the API runs CORS with `credentials: true`. The app uses a fixed
origin allowlist (limits exposure), but running a known-vulnerable CORS version on the
authenticated API's credentialed cross-origin surface is exactly the kind of latent issue to
close with a patch bump. The fix is within the existing `^4.12` major — no application code.

## Current state (on `origin/main` `413a153`)

- `apps/api/package.json` (dependencies): `"hono": "^4.12.22"`.
- Installed/resolved: `hono@4.12.22` (below the patched `4.12.25`).
- The credentialed CORS middleware lives in `apps/api/src/index.ts` (`cors({ origin: [...],
  credentials: true, ... })`) — **do not touch it**; it is unchanged across this patch range.
- `pnpm audit --prod` reports GHSA-88fw-hqm2-52qc (high) at path `apps__api>hono`, vulnerable
  `< 4.12.25`, patched `>= 4.12.25`.
- Package manager: `pnpm@10.11.0`.

## Method note — READ THIS (why not `pnpm update`)

**Do NOT use `pnpm update` or `pnpm add` for this bump.** In this repo, with a lockfile that is
internally consistent but behind the registry and all specifiers using `^`, `pnpm update hono@…`
re-resolves *every* in-range dependency to its newest version — a huge, unreviewable, risky diff
(and it forks the drizzle/pglite peer, a documented landmine). Instead, do a **conservative**
change: hand-edit only hono's range in `apps/api/package.json`, then `pnpm install --lockfile-only`,
which keeps every existing lockfile resolution that still satisfies its range and only re-pins hono.

The reviewer verified this conservative path produces a **~74-line lockfile diff** whose ONLY
package changes are `hono 4.12.22 → 4.12.28` (+ its `@hono/node-server` peer line) and an incidental
`turbo 2.10.3 → 2.10.4` patch of the root build tool (+ its `@turbo/*` platform packages). The turbo
patch is benign collateral (root devDependency, patch within its existing `^` range) and is the ONLY
non-hono change permitted. Anything beyond hono + turbo is a STOP.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Seed deps | `pnpm install --frozen-lockfile` | exit 0 (base lockfile is consistent) |
| Edit range | (hand-edit `apps/api/package.json` `hono` → `^4.12.25`) | — |
| Re-pin lockfile | `pnpm install --lockfile-only` | lockfile updates; small diff |
| Sync node_modules | `pnpm install --frozen-lockfile` | exit 0 (pkg + lockfile now consistent) |
| Check resolved | `pnpm --filter @outrival/api ls hono` | `hono 4.12.28` (or later 4.12.x ≥ 4.12.25) |
| Re-audit | `pnpm audit --prod` | GHSA-88fw-hqm2-52qc no longer listed |
| Typecheck | `pnpm typecheck` | exit 0 (8/8) |
| API tests | `pnpm --filter @outrival/api test` | all pass (72/0 at time of writing) |

## Scope

**In scope**:
- `apps/api/package.json` (bump the `hono` range to `^4.12.25`)
- `pnpm-lock.yaml` (updated by `pnpm install --lockfile-only`)

**Out of scope**:
- Any application code — patch bump within the pinned major; the `cors()` signature is unchanged.
- The transitive advisories (`undici`, `ws`, `systeminformation`) and `next-mdx-remote` — separate.
- Deliberately broad dependency refreshes — this PR is the hono security patch only.

## Git workflow

- Branch: `advisor/008-bump-hono` (created off `origin/main` per base setup)
- One commit: `fix(api): bump hono to ^4.12.25 (CORS advisory GHSA-88fw-hqm2-52qc)`.
- Do NOT push.

## Steps

### Step 1: Seed deps, then bump hono conservatively

1. `pnpm install --frozen-lockfile` (fresh worktree has no node_modules; this also proves the
   base lockfile is consistent — it must exit 0 with no changes).
2. Hand-edit `apps/api/package.json`: change `"hono": "^4.12.22"` to `"hono": "^4.12.25"`. Change
   nothing else in the file.
3. `pnpm install --lockfile-only` (re-pins ONLY what the edit requires; does not touch node_modules).
4. `pnpm install --frozen-lockfile` (installs node_modules per the updated lockfile; must exit 0 —
   confirms package.json + lockfile are now consistent).

**Verify**: `pnpm --filter @outrival/api ls hono` shows `hono 4.12.28` (or later ≥ 4.12.25).

### Step 2: SCOPE GUARD — confirm the lockfile diff is hono + turbo ONLY

Run `git diff pnpm-lock.yaml` and inspect which resolved package versions changed. The ONLY
allowed changes are:
- `hono@4.12.22 → hono@4.12.28` (and its `@hono/node-server` entry line), and
- `turbo@2.10.3 → turbo@2.10.4` (and its `@turbo/*` platform sub-packages).

**If ANY other package re-resolved** — especially `drizzle-orm` / `drizzle-kit` / `@electric-sql/pglite`,
`next`, `react`, `react-dom`, `stripe`, `better-auth`, `@sentry/*`, `playwright`, `patchright`,
`radix-ui`, `recharts`, `motion`, `posthog-*`, `@aws-sdk/*` — you used the wrong command (likely
`pnpm update`/`pnpm add` instead of the conservative flow). **STOP**, revert both files
(`git checkout -- apps/api/package.json pnpm-lock.yaml`), and report the diff. Do not commit it.

Quick check helper:
```
git diff pnpm-lock.yaml | grep -E "^[+-]" | grep -E "@[0-9]" | grep -vE "^[+-]{3}" \
  | sed -E "s/\(.*//" | sort -u
```
Every line in that output must be a `hono`, `@hono/node-server`, `turbo`, or `@turbo/*` entry.

### Step 3: Confirm the advisory is gone and nothing broke

**Verify**:
- `pnpm audit --prod` → GHSA-88fw-hqm2-52qc (hono CORS) no longer appears
  (`pnpm audit --prod | grep -c GHSA-88fw-hqm2-52qc` → `0`).
- `pnpm typecheck` → exit 0 (8/8 tasks).
- `pnpm --filter @outrival/api test` → all pass (the API PGlite suite; 72/0 at time of writing).

## Test plan

- No new tests. This is a dependency patch; the existing `apps/api` PGlite route/auth suite is the
  regression guard that Hono's request handling still works across the patch range.

## Done criteria

ALL must hold:

- [ ] `apps/api/package.json` has `"hono": "^4.12.25"`
- [ ] `pnpm --filter @outrival/api ls hono` resolves to ≥ 4.12.25 (expect `4.12.28`)
- [ ] `pnpm audit --prod` no longer lists GHSA-88fw-hqm2-52qc
- [ ] `pnpm typecheck` exits 0 (8/8)
- [ ] `pnpm --filter @outrival/api test` passes (72/0)
- [ ] The lockfile diff contains ONLY hono + turbo (+ their sub-packages) — nothing else
- [ ] Only `apps/api/package.json` and `pnpm-lock.yaml` changed (`git diff --stat 413a153..HEAD`)

## STOP conditions

Stop and report if:

- The lockfile diff includes ANY package beyond hono + turbo (Step 2 scope guard). Revert and report.
- `pnpm typecheck` or the API tests fail after the bump — report the failure (a patch bump should
  not break either).
- `pnpm install --lockfile-only` or `pnpm audit --prod` hits an actual offline/registry error —
  report; do not fall back to a `pnpm update`/`pnpm add`.
- `pnpm --filter @outrival/api ls hono` resolves outside 4.12.x (a different minor/major) — report.

## Maintenance notes

- Keep the explicit origin allowlist in `apps/api/src/index.ts` as defense in depth.
- The repo lockfile is broadly behind the registry (many `^` deps have newer in-range versions).
  A deliberate, separately-reviewed `pnpm update` refresh PR is worth doing on its own — but NOT
  folded into a security patch. Track it as its own housekeeping task.
- Now that CI (plan 006) is live, consider adding `pnpm audit --prod` (fail on reachable high) as
  a CI step so a future vulnerable direct dep is caught automatically.
