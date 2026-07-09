# Plan 024: Deliberate in-range dependency refresh (bring the stale lockfile current)

> **Executor instructions**: Follow this plan step by step. This produces a large lockfile
> diff by design — the gate is that the FULL suite stays green. If a STOP condition occurs,
> stop and report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: none needed for specific files — this refreshes the whole
> lockfile. But confirm `pnpm test` (12/12) and `pnpm typecheck` (8/8) are green on `HEAD`
> BEFORE touching anything, so any red after the refresh is attributable to the refresh.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED (many in-range minor/patch bumps at once)
- **Depends on**: — . **Land when the PR queue is otherwise clear** and after 021/023 (a huge
  lockfile diff conflicts with other branches; 023's Biome sweep should land first or after,
  not concurrently).
- **Category**: dependencies / maintenance
- **Planned at**: commit `bf3a0ce`, 2026-07-09

## Why this matters

Plan 008 surfaced that the repo lockfile is **broadly behind the registry** — nearly every
`^`-ranged dependency has a newer in-range version, and a single `pnpm update <pkg>` re-resolves
~2600 lockfile lines (that's why single-dep bumps must use the conservative flow, per
`reference: pnpm single-dep bump`). Letting the lockfile drift accumulates silent risk: security
patches within range aren't picked up, and each future single-dep bump drags an unrelated
mass-resolution behind it. A **deliberate, reviewed, one-shot in-range refresh** resets the
baseline so subsequent single-dep bumps stay small, and pulls in patch-level security fixes for
free. This is the "own PR" plan 008's notes called for.

## Current state

- `pnpm@10.11.0`; monorepo (pnpm workspaces + turbo). Lockfile at `pnpm-lock.yaml` (root).
- `pnpm test` = `turbo test` → 12/12 tasks (api PGlite suite, workers, scrapers, shared, db,
  ai, web) green on `HEAD`. `pnpm typecheck` = 8/8. These are the refresh's pass/fail oracle.
- Known-sensitive deps to watch in the diff (behavior-bearing): `drizzle-orm`/`drizzle-kit`
  (+ its `@electric-sql/pglite` peer — the documented fork point), `better-auth`, `stripe`,
  `next`/`react`/`react-dom`, `patchright`/`camoufox-js`/`playwright` (scraping cascade),
  `@trigger.dev/sdk`, `resend`, `hono`.
- WSL2 dev host OOMs on `next build`; do NOT run it. `pnpm typecheck` + `pnpm test` (bun/tsc,
  no browser) are the gates and run fine.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Baseline green | `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` | all green BEFORE refresh |
| In-range refresh | `pnpm update -r` | updates every workspace pkg to latest **in-range**; big lockfile diff |
| Re-verify | `pnpm typecheck && pnpm test` | still 8/8 + 12/12 |
| See what moved | `git diff pnpm-lock.yaml | grep -E "^[+-]" | grep -E "@[0-9]" | sed -E "s/\(.*//" | sort -u` | the set of bumped packages |

## Scope

**In scope**:
- `pnpm-lock.yaml` (rewritten by `pnpm update -r`)
- any `package.json` whose `^` range's *floor* pnpm bumps (usually none for `-r` in-range; if a
  `package.json` changes, it's because the resolved version moved the recorded range — review it)

**Out of scope**:
- **Cross-major upgrades** (`pnpm update --latest`, or manually bumping a `^4` → `^5`). Each
  major is its own reviewed plan (breaking changes, migration notes). This plan is **in-range
  only**.
- Changing any dependency's declared range in `package.json` by hand.
- Source code changes. If a bump requires a code change to compile/pass, that dep is NOT a safe
  in-range refresh — STOP and report it (it likely shipped a behavior change).

## Git workflow

- Branch: `advisor/024-lockfile-refresh`
- One commit: `chore(deps): refresh lockfile to latest in-range versions`.
- Do NOT push unless instructed.

## Steps

### Step 1: Establish the green baseline

`pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`. All must be green. If anything
is red on `HEAD` before you touch the lockfile, STOP — that's a pre-existing failure, not this
plan's to fix.

### Step 2: Refresh in-range

`pnpm update -r`. This rewrites `pnpm-lock.yaml` to the newest in-range versions across the
workspace. Do NOT pass `--latest`.

**Verify**: `git diff --stat pnpm-lock.yaml` shows a large diff (expected). List the bumped
packages with the "See what moved" command and eyeball the sensitive ones (drizzle/pglite peer,
next/react, stripe, better-auth, patchright) — note any **major** jump (there shouldn't be one
under `-r`; if there is, STOP — a range allowed a major and it needs deliberate review).

### Step 3: Re-verify the full suite

`pnpm typecheck` → 8/8. `pnpm test` → 12/12 tasks green.
- If ANY package goes red: identify the culprit bump from the diff, and **STOP + report** which
  dep + which test broke. Do NOT patch source to accommodate a bump in this plan (that turns a
  mechanical refresh into a behavior change needing its own review).

### Step 4: Sanity-scan the diff for surprises

Confirm `pnpm install --frozen-lockfile` is now a no-op (lockfile consistent). Confirm no
`package.json` gained an unexpected new dependency (a refresh should only move versions).

**Verify**: `git diff --stat HEAD` = `pnpm-lock.yaml` (+ possibly minor `package.json` range
bumps pnpm recorded), nothing else.

## Test plan

- The full existing suite IS the test plan: `pnpm typecheck` (8/8) + `pnpm test` (12/12) must be
  green after the refresh. That's the behavior-preservation oracle for a version-only change.
- **Residual risk the suite can't cover** (flag in the PR body, for the operator's post-deploy
  smoke test): the browser scraping cascade (patchright/camoufox), real email rendering
  (resend), and Stripe live webhooks aren't exercised by `bun test`. The operator should run the
  deployment smoke test (`docs/deployment.md`) after this lands.

## Done criteria

ALL must hold:
- [ ] `pnpm update -r` applied; the lockfile is refreshed (large diff), **no major-version jumps**
- [ ] `pnpm typecheck` → 8/8 and `pnpm test` → 12/12 still green after the refresh
- [ ] `pnpm install --frozen-lockfile` is a no-op (lockfile consistent with package.json)
- [ ] No source code changed; no unexpected new dependency added
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:
- Any package's tests/typecheck go red after the refresh — report the culprit bump + failure;
  do not patch source.
- `pnpm update -r` pulls a **major** version (a range like `>=x` or `*` allowed it) — report it
  for a deliberate per-dep review; do not ship a silent major bump.
- The baseline (Step 1) is already red on `HEAD` — report; not this plan's fix.

## Maintenance notes

- After this lands, single-dep bumps (plan-008-style) will produce small diffs again — keep using
  the conservative edit-then-`install --lockfile-only` flow for those; use THIS `-r` refresh only
  as a periodic, deliberately-reviewed batch.
- Pair with plan 022: once the lockfile is fresh, re-run `pnpm audit --prod` and trim any
  `ignoreGhsas` entries that a bump resolved.
- Cross-major upgrades (Next, React, Stripe SDK, drizzle) remain separate per-dep plans with
  their own migration notes.
