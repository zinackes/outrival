# Plan 021: Make CI resilient — pin Bun, bump the deprecated Node-20 GitHub Actions

> **Executor instructions**: Follow this plan step by step. This edits ONE CI workflow
> file — no source code. If a STOP condition occurs, stop and report. When done, update
> this plan's row in `plans/README.md` unless a reviewer maintains the index.
>
> **Drift check (run first)**: `git show HEAD:.github/workflows/ci.yml`
> If the file's `uses:` action versions differ from the "Current state" below, re-read
> before editing (they may have already been bumped).

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: — (CI landed via #126)
- **Category**: dx / tooling
- **Planned at**: commit `bf3a0ce`, 2026-07-09

## Why this matters

The CI `verify` job (from plan 006 / #126) has two avoidable weaknesses seen in real runs:
1. **Flaky Bun download** — `oven-sh/setup-bun@v2` downloads the *latest* Bun each run from
   GitHub's release server; a transient **HTTP 504** there fails the whole job (observed on
   PR #144, which was otherwise green). Pinning a specific `bun-version` makes the install
   deterministic and cacheable, and removes the "resolve latest" round-trip.
2. **Deprecated action runtimes** — every run logs *"Node.js 20 is deprecated. actions/
   checkout@v4, actions/setup-node@v4, pnpm/action-setup@v4 are being forced to run on
   Node.js 24"* (GitHub is retiring the Node-20 action runtime). Bumping to the current
   majors removes the warning and future-proofs the job before the forced-migration date.

This is pure CI hygiene — no product code, low risk, prevents red builds that aren't real
failures (a 504 on a security/feature PR reads as "your change broke CI").

## Current state

`.github/workflows/ci.yml` (verbatim):
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
      - uses: oven-sh/setup-bun@v2
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
```
- Local Bun (`bun --version`) is **1.3.13** (what the repo's tests are validated against).
  CI last downloaded 1.3.14. Pin to a known-good `1.3.x` so CI and local match.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Validate YAML | `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"` | prints nothing, exit 0 |
| No tabs | `grep -Pn "\t" .github/workflows/ci.yml` | no matches (2-space indent) |

(There is no way to fully run GitHub Actions locally; correctness is verified when the
workflow runs on the PR. Keep the change minimal and YAML-valid.)

## Scope

**In scope**:
- `.github/workflows/ci.yml` — bump action majors + pin `bun-version`.

**Out of scope**:
- The job's steps/commands (`pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm test`)
  — unchanged. Do NOT add new steps here (lint/audit are separate plans 022/023).
- Any source or config file. Do NOT change `packageManager`, `node-version` value, or
  `pnpm` pin (`10.11.0`).

## Git workflow

- Branch: `advisor/021-ci-resilience`
- One commit: `ci: pin Bun and bump deprecated GitHub Actions`.
- Do NOT push unless instructed.

## Steps

### Step 1: Bump the action majors + pin Bun

Edit `.github/workflows/ci.yml`:
- `actions/checkout@v4` → `actions/checkout@v5`
- `actions/setup-node@v4` → `actions/setup-node@v5` (keep `with: { node-version: 20, cache: pnpm }`
  — the deprecation is about the *action's* runtime, not the app's Node; v5 runs on Node 24)
- `pnpm/action-setup@v4` — keep `@v4` UNLESS a newer major is current stable; if unsure, leave
  `@v4` (it is not part of the Node-20 deprecation warning text, but confirm from its README
  whether a v5 exists — if it does and is stable, bump; otherwise leave it and note why)
- `oven-sh/setup-bun@v2` → keep `@v2` but add a pinned version:
  ```yaml
  - uses: oven-sh/setup-bun@v2
    with:
      bun-version: 1.3.13
  ```
  (matches the local Bun the tests are validated against; makes the install deterministic and
  avoids the "download latest" 504.)

Preserve exact indentation (2 spaces, no tabs) and the rest of the file byte-for-byte.

**Verify**:
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` → exit 0.
- `grep -Pn "\t" .github/workflows/ci.yml` → no matches.
- `git diff --stat HEAD` shows only `.github/workflows/ci.yml`.

## Test plan

- No automated test (a workflow file). Verification is YAML validity + the reviewer reading
  the diff. The real proof is the next PR's CI run going green without the deprecation warning
  and without re-downloading Bun's latest.

## Done criteria

ALL must hold:
- [ ] `ci.yml` uses `actions/checkout@v5`, `actions/setup-node@v5`, and `oven-sh/setup-bun@v2`
      with a pinned `bun-version: 1.3.13`
- [ ] The job's install/typecheck/test steps are unchanged
- [ ] YAML validates; no tabs; only `ci.yml` changed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:
- `actions/checkout@v5` or `actions/setup-node@v5` is NOT a real published major (verify on
  the GitHub Marketplace / the action repo) — report; do not invent a version.
- Pinning `bun-version: 1.3.13` is rejected by `setup-bun@v2`'s schema (unlikely; it's the
  documented input) — report the correct input name.

## Maintenance notes

- When GitHub finalizes the Node-20 runtime retirement, re-check all `uses:` majors.
- If CI later needs a specific Bun for a new feature, bump `bun-version` here in lockstep with
  the local dev version so CI and local always match.
- This pairs with plans 022 (add `pnpm audit --prod` step) and 023 (add a Biome lint step) —
  both add steps to this same job; land 021 first so those build on the resilient base.
