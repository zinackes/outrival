# Plan 006: A CI gate runs typecheck + tests on every PR, and `turbo test` can't replay a stale pass

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving on. If anything in "STOP
> conditions" occurs, stop and report. When done, update this plan's row in
> `plans/README.md` unless a reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 81c4b75..HEAD -- turbo.json .github`
> If `turbo.json` changed or a `.github/workflows` dir now exists, compare against
> "Current state" before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/005-run-orphaned-test-files.md (wire the suites first)
- **Category**: dx / tests
- **Planned at**: commit `81c4b75`, 2026-07-07

## Why this matters

`main` auto-deploys to production via Coolify on push, and there is **no CI** —
`.github/workflows` does not exist. The only "does it work?" gate is a developer
running `pnpm test` locally, opt-in. Worse, the one command that exists can lie:
`turbo.json` declares the `test` task with `outputs: []` and no `cache: false`, so
turbo caches the task's exit code and, on an input-hash hit, **replays a recorded
PASS without running the tests**. Several suites depend on runtime state turbo's file
hashing doesn't capture (PGlite/`postgres` in `apps/api`, migrations in `packages/db`,
env-driven behavior) — exactly the "turbo cache masked a test failure" class the team
has already hit. This plan adds a real gate and makes test runs honest.

## Current state

- No CI of any kind: `.github/workflows`, `.gitlab-ci.yml`, `Jenkinsfile`,
  `.circleci`, `.pre-commit-config.yaml` are all absent. `.git/hooks/` is empty.
- `turbo.json` `test` task (verbatim):
  ```json
  "test": {
    "dependsOn": ["^build"],
    "outputs": []
  }
  ```
- Root scripts: `"test": "turbo test"`, `"typecheck": "turbo typecheck"`,
  `"build": "turbo build"`. Package manager is `pnpm@10.11.0`.
- **Constraint**: the dev host is a memory-constrained WSL2 VM that OOMs on
  `next build`; CI runs on GitHub's runners (not memory-constrained), so CI **may**
  run `next build` if desired — but the minimal, high-value gate is typecheck + test.
  Keep the first CI cheap and reliable; do not block on a flaky heavy build.
- After plan 005, `packages/shared` and `packages/scrapers` both have runnable `test`
  scripts.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install (frozen) | `pnpm install --frozen-lockfile` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests (forced, no cache) | `pnpm test -- --force` or `turbo test --force` | exit 0, tasks actually execute |
| Verify cache off | run `pnpm test` twice | second run still executes tests (no `>>> FULL TURBO`) on the `test` task |

## Scope

**In scope**:
- `turbo.json` (set `test` to `cache: false`)
- `.github/workflows/ci.yml` (create)

**Out of scope**:
- Any test or source file. If CI/`--force` surfaces a pre-existing failing test, that
  is a STOP condition — report it, don't fix it here.
- Making the CI a *required* status check / branch protection — that is a GitHub repo
  setting the operator applies, not a file change. Note it in the PR description.
- Adding a linter (that's plan 016-adjacent / a separate DX plan).

## Git workflow

- Branch: `advisor/006-ci-and-test-cache`
- One or two commits (conventional: `ci: run typecheck + tests on PR and main`,
  `build: stop caching the test task so a stale pass can't replay`).
- Do NOT push unless instructed.

## Steps

### Step 1: Make the `test` task non-cacheable

In `turbo.json`, change the `test` task to:
```json
"test": {
  "dependsOn": ["^build"],
  "cache": false
}
```
Tests are the release gate — they must always actually run. (If a future maintainer
wants caching for speed, the correct alternative is explicit `inputs` covering the
test dirs and env files, but `cache: false` is the safe default given there is no CI
today. Do not add `inputs` in this plan.)

**Verify**: run `pnpm test` twice in a row. On the second run, the `test` tasks must
still execute — turbo must **not** print `>>> FULL TURBO` / a cache hit for any
`#test` task.

### Step 2: Add the CI workflow

Create `.github/workflows/ci.yml` that, on `pull_request` and `push` to `main`:
1. checks out the repo,
2. installs pnpm (pin to `10.11.0` to match `packageManager`) and Node,
3. runs `pnpm install --frozen-lockfile` (frozen — never a bare install; the repo has
   a documented drizzle peer-fork landmine on unpinned installs),
4. runs `pnpm typecheck`,
5. runs `pnpm test`.

Target shape (adapt action versions to current stable):
```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.11.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
```
Note: `bun test` is invoked by the package `test` scripts; the GitHub runner has Bun
available via `oven-sh/setup-bun` if `pnpm test` → `bun test` needs the `bun` binary.
If `pnpm test` fails in CI because `bun` is missing, add a `oven-sh/setup-bun@v2` step
before the test step — verify locally which is needed and wire accordingly.

**Verify**: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` all exit 0
locally (this mirrors what CI will run). YAML is valid (no tab characters; 2-space
indent).

## Test plan

- No unit tests. Verification is: (a) the double-run in Step 1 proves the cache is off,
  and (b) the local mirror of the CI commands in Step 2 passes.

## Done criteria

ALL must hold:

- [ ] `turbo.json` `test` task has `cache: false` and no `outputs` key
- [ ] `pnpm test` run twice still executes tests the second time (no cache hit on `#test`)
- [ ] `.github/workflows/ci.yml` exists and runs `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm test`
- [ ] `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` all exit 0 locally
- [ ] Only `turbo.json` and the new workflow file are modified/created (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- `pnpm typecheck` or `pnpm test` fails on the current tree (that's a pre-existing
  failure CI would have caught — report the exact failure; do not fix source here).
- `pnpm install --frozen-lockfile` fails due to lockfile drift — report it (a bare
  `pnpm install` is the documented drizzle-peer-fork landmine; do not run it to "fix").
- You cannot determine whether the runner needs a separate Bun setup step — report and
  let the operator decide rather than guessing.

## Maintenance notes

- The operator should make this workflow a **required status check** on `main` in
  GitHub branch-protection settings so a red build blocks the Coolify auto-deploy —
  note this in the PR body (it's outside the repo files).
- When a lint/format tool is added later (separate plan), add its check as a step here.
- Reviewer should confirm the workflow triggers on both `pull_request` and `push: main`,
  and that `--frozen-lockfile` is used (not a bare install).
