# Plan 008: Bump `hono` past the CORS origin-reflection advisory (≥ 4.12.25)

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result. If anything in "STOP conditions" occurs,
> stop and report. When done, update this plan's row in `plans/README.md` unless a
> reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 81c4b75..HEAD -- apps/api/package.json pnpm-lock.yaml`
> If either changed, re-check the installed `hono` version before proceeding.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security / dependencies
- **Planned at**: commit `81c4b75`, 2026-07-07

## Why this matters

`apps/api` pins `hono@^4.12.22`; the lockfile resolves `hono@4.12.22`, which is below
`4.12.25` and subject to the Hono CORS-middleware origin-reflection advisory
(GHSA-88fw-hqm2-52qc). It is a **direct** runtime dependency and the API runs the CORS
middleware with `credentials: true`. The app uses a fixed origin allowlist (good, limits
exposure), but running a known-vulnerable CORS version on the authenticated API's
credentialed cross-origin surface is exactly the kind of latent issue to close with a
patch bump. The fix is within the existing `^4.12` range — no code changes.

## Current state

- `apps/api/package.json` (dependencies): `"hono": "^4.12.22"`.
- Installed/resolved: `hono@4.12.22` (below the patched `4.12.25`).
- The credentialed CORS middleware — `apps/api/src/index.ts:63-72` (approx):
  ```ts
  cors({
    origin: [ WEB_URL, /* localhost dev origins */ ],
    credentials: true,
    ...
  })
  ```
- `pnpm audit --prod` reports GHSA-88fw-hqm2-52qc (high) at path `apps__api > hono`,
  vulnerable range `< 4.12.25`.
- Package manager: `pnpm@10.11.0`. **Never run a bare `pnpm install`** — the repo has a
  documented drizzle peer-fork landmine; use targeted update commands.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Update hono | `pnpm --filter @outrival/api update hono@^4.12.25` | lockfile updates hono to ≥ 4.12.25 |
| Re-audit | `pnpm audit --prod` | GHSA-88fw-hqm2-52qc no longer listed |
| Typecheck | `pnpm typecheck` | exit 0 |
| API tests | `cd apps/api && bun test` (or `pnpm --filter @outrival/api test`) | all pass |

## Scope

**In scope**:
- `apps/api/package.json` (bump the `hono` range)
- `pnpm-lock.yaml` (updated by the pnpm command)

**Out of scope**:
- Any application code — this is a patch bump within the pinned major; the `cors()` call
  signature is unchanged. Do not "improve" the CORS config here.
- The transitive advisories (`undici`, `ws`, `systeminformation`) — they were assessed
  as not on reachable exploit paths; handle them separately if the operator wants, not here.
- `next-mdx-remote` — a separate, low-urgency bump (repo-authored MDX only).

## Git workflow

- Branch: `advisor/008-bump-hono`
- One commit: `fix(api): bump hono to ^4.12.25 (CORS advisory GHSA-88fw-hqm2-52qc)`.
- Do NOT push unless instructed.

## Steps

### Step 1: Bump hono in `apps/api`

Run: `pnpm --filter @outrival/api update hono@^4.12.25`

This updates `apps/api/package.json` to `"hono": "^4.12.25"` and refreshes the lockfile
entry. Confirm the resolved version:
```
pnpm --filter @outrival/api ls hono
```
Expected: `hono 4.12.25` (or a later 4.12.x).

**Verify**: `pnpm --filter @outrival/api ls hono` shows ≥ 4.12.25.

### Step 2: Confirm the advisory is gone and nothing broke

**Verify**:
- `pnpm audit --prod` → GHSA-88fw-hqm2-52qc (hono CORS) no longer appears.
- `pnpm typecheck` → exit 0.
- `pnpm --filter @outrival/api test` → all pass (the API PGlite suite must stay green;
  Hono's route/handler API is unchanged across this patch range).

## Test plan

- No new tests. This is a dependency patch; the existing `apps/api` suite (PGlite-based
  route/auth tests) is the regression guard that Hono's request handling still works.
- If the API suite has any CORS-specific assertion, confirm it still passes; if none
  exists, that gap is noted for a future test plan (not required here).

## Done criteria

ALL must hold:

- [ ] `apps/api/package.json` has `"hono": "^4.12.25"` (or later)
- [ ] `pnpm --filter @outrival/api ls hono` resolves to ≥ 4.12.25
- [ ] `pnpm audit --prod` no longer lists the hono CORS advisory
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm --filter @outrival/api test` passes
- [ ] Only `apps/api/package.json` and `pnpm-lock.yaml` changed (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- The pnpm update pulls hono past `4.12.x` into a different minor/major (unexpected) or
  bumps unrelated packages — report the lockfile diff instead of proceeding.
- `pnpm typecheck` or the API tests fail after the bump — report the failure (a patch
  bump should not break either; a failure means something else).
- `pnpm audit --prod` cannot run in the environment — report; do not fall back to a bare
  `pnpm install`.

## Maintenance notes

- Keep the explicit origin allowlist in `apps/api/src/index.ts` as defense in depth even
  after the bump — do not relax it.
- Consider adding `pnpm audit --prod` (fail on critical/high, reachable) as a CI step
  once plan 006 lands, so a future vulnerable direct dep is caught automatically.
- Follow-ups the operator may want separately: `next-mdx-remote@^6` (latent MDX RCE,
  not reachable today) and `pnpm.overrides` for the transitive `undici`/`ws`/
  `systeminformation` advisories if a deeper audit deems them reachable.
