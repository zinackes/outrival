# Plan 005: Every written test file actually executes (`packages/shared` + `packages/scrapers`)

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving on. If anything in "STOP
> conditions" occurs, stop and report — do not improvise. When done, update this
> plan's row in `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 81c4b75..HEAD -- packages/shared/package.json packages/scrapers/package.json`
> If either file changed since this plan was written, compare the "Current state"
> excerpts against the live files before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none for the shared half; **019** for the scrapers half to reach a green suite
- **Category**: tests
- **Planned at**: commit `81c4b75`, 2026-07-07

## Reviewer note (2026-07-07, after `execute`)

An executor implemented this plan verbatim; the diff is **correct and exactly in scope**
(only the two `package.json` files, exactly the two edits below). Independently re-verified:

- **Shared half — DONE & GREEN.** `bun test src` in `packages/shared` → **162 pass / 0 fail**
  across the 11 files. Landable on its own right now.
- **Scrapers half — correct change, but exposes a PRE-EXISTING red suite.** `bun test src`
  now runs 44 files (the +4 target dirs `feeds/news/reddit/sitemap` are **23 pass / 0 fail**),
  but the suite reports **2 fail** — in `src/lib/__tests__/scrape-first-success.test.ts`.
  Those failures are **not caused by this plan**: they reproduce under the *original* explicit
  test command (`358 pass / 2 fail`), because both `src/lib` and `src/jobs` were already listed.
  Root cause: a `mock.module("../../lib/crawler", …)` leak in `src/jobs/__tests__/jobs-scraper.test.ts`
  (process-global, never restored) poisons the real `scrapeFirstSuccess` when both files share a
  `bun test` process. `pnpm test` is therefore **already red on `main`**, masked by turbo cache
  + no CI.

**Consequence for this plan's Done criteria**: the two exit-0 criteria (`bun test src` for
scrapers, and `pnpm test`) were written against a false premise (suite assumed green). They
were unreachable in scope until the leak was fixed — **plan 019 is now DONE** (executed &
approved 2026-07-07, commit `5594447`, awaiting merge). The executor's worktree diff for this
plan is preserved (nothing merged). **Merge 019 + 005 together** for a green `pnpm test`, then
re-run this plan's criteria; they should pass.

## Why this matters

19 test files are checked into the repo but **never run**. `packages/shared` ships
11 `*.test.ts` files (including `constants/plans.test.ts`, which guards the paid
plan-limit grid) yet has **no `test` script**, so `turbo test` skips the whole
package. `packages/scrapers` has a `test` script that hard-lists directories and
omits four that contain tests (`feeds/`, `news/`, `reddit/`, `sitemap/`). The team
believes these paths are covered; they are not. A green `pnpm test` is currently a
false signal on money and core-scraping logic. This plan makes those files run —
nothing more.

## Current state

- `packages/shared/package.json` — scripts are only `build` and `typecheck`; **no `test`**:
  ```json
  "scripts": { "build": "tsc --noEmit", "typecheck": "tsc --noEmit" }
  ```
  The 11 test files that never run (all pure, no network/DB):
  `src/analysis-status.test.ts`, `src/constants/competitor-colors.test.ts`,
  `src/constants/plans.test.ts`, `src/diff/index.test.ts`, `src/monitor-url.test.ts`,
  `src/pricing.test.ts`, `src/reviews.test.ts`, `src/scoring/threat.test.ts`,
  `src/social-proof/logo-name.test.ts`, `src/validation/email.test.ts`,
  `src/validation/password.test.ts`.

- `packages/scrapers/package.json` — the `test` script lists dirs explicitly:
  ```
  "test": "bun test src/pricing src/lib src/parsers src/diff src/scoring src/learning src/tech-stack src/structural src/spa src/jobs src/structured-data src/platform src/status src/discovery"
  ```
  Dirs that contain a `*.test.ts` but are **absent** from that list:
  `src/feeds/rss.test.ts`, `src/news/news.test.ts`, `src/reddit/reddit.test.ts`,
  `src/sitemap/parse.test.ts` — all four are pure string-fixture tests (inline
  fixtures, no network).

- Test runner is **`bun test`** (there is no vitest/jest). `turbo test` runs the
  `test` script of every package that defines one; packages without a `test` script
  are silently skipped. Root `pnpm test` → `turbo test`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `pnpm typecheck` | exit 0 |
| Shared tests | `cd packages/shared && bun test src` | all pass, N > 0 tests |
| Scrapers tests | `cd packages/scrapers && bun test src` | all pass |
| Full suite | `pnpm test` | exit 0, shared + scrapers both execute |

## Scope

**In scope** (the only files you may modify):
- `packages/shared/package.json` (add a `test` script)
- `packages/scrapers/package.json` (broaden the `test` glob)

**Out of scope** (do NOT touch):
- Any `*.test.ts` file or any source file. If a newly-running test **fails**, that is
  a STOP condition (see below) — do not edit the test or the code it exercises.
- `turbo.json` — CI/cache handling is plan 006, not this one.

## Git workflow

- Branch: `advisor/005-run-orphaned-tests`
- One commit; conventional-commit style (e.g. `test: run the shared + scraper suites that never executed`).
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1: Add a `test` script to `packages/shared`

In `packages/shared/package.json`, add to `scripts`:
```json
"test": "bun test src"
```
Using the `src` glob (not an explicit dir list) means future test dirs auto-enroll.

**Verify**: `cd packages/shared && bun test src` → all tests pass, output shows > 0 tests run (expect the 11 files above to execute).

### Step 2: Broaden the `packages/scrapers` test glob

Replace the explicit directory list with the `src` glob so no dir is ever forgotten again:
```json
"test": "bun test src"
```

**Verify**: `cd packages/scrapers && bun test src` → all tests pass, and the run now
includes `feeds/`, `news/`, `reddit/`, `sitemap/` (previously omitted).

### Step 3: Confirm the full suite runs both packages

**Verify**: `pnpm test` from the repo root → exit 0, and turbo's output lists
`@outrival/shared#test` and `@outrival/scrapers#test` as executed tasks.

## Test plan

No new tests are written in this plan — the deliverable is that **existing** tests
execute. Success = the 11 shared files and the 4 previously-omitted scraper files run
and pass under `bun test`.

## Done criteria

ALL must hold:

- [ ] `cd packages/shared && bun test src` exits 0 with > 0 tests
- [ ] `cd packages/scrapers && bun test src` exits 0 and includes the four previously-omitted dirs
- [ ] `pnpm test` exits 0 and turbo shows both `@outrival/shared#test` and `@outrival/scrapers#test`
- [ ] `pnpm typecheck` exits 0
- [ ] Only the two `package.json` files are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any newly-running test **fails**. This is a real signal — the hidden test may have
  been catching a regression, or it may be stale. Report which test(s) failed with
  their output; do **not** edit the test or source to make it pass in this plan.
- A scraper test in `feeds/`/`news/`/`reddit/`/`sitemap/` turns out to require network
  or environment (it should not) — report it rather than adding skips.
- `bun` is not available in the environment (the scrapers suite already relies on it,
  so this would be an environment problem, not a plan problem).

## Maintenance notes

- Plan 006 (CI + turbo `test` cache) depends on this landing first — there is no point
  wiring CI to a suite that only half-runs.
- Future rule of thumb: every `packages/*` that ships `*.test.ts` needs a `test`
  script; the `bun test src` glob added here keeps new dirs from being forgotten.
- Reviewer should scrutinize: whether any newly-surfaced failure was silenced instead
  of reported.
