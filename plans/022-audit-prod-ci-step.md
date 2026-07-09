# Plan 022: Fail CI on a NEW reachable high/critical advisory in production deps (`pnpm audit --prod`)

> **Executor instructions**: Follow this plan step by step. Run every verification command.
> If a STOP condition occurs, stop and report. When done, update this plan's row in
> `plans/README.md` unless a reviewer maintains the index.
>
> **Drift check (run first)**: `git show HEAD:.github/workflows/ci.yml` and
> `git show HEAD:package.json | grep -A6 '"pnpm"'`. If a `pnpm audit` step or a
> `pnpm.auditConfig` already exists, re-read before editing.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: 021 (lands first; both edit the CI job) — soft, not hard
- **Category**: security / dx
- **Planned at**: commit `bf3a0ce`, 2026-07-09

## Why this matters

Plan 008 (#128) bumped `hono` past a **high** CORS advisory that had sat in a direct
production dependency undetected — there was no automated gate. Now that CI exists (#126), a
`pnpm audit --prod` step would catch the *next* vulnerable direct/prod dep automatically,
instead of relying on a manual audit. The catch: a naive `pnpm audit` fails on transitive
advisories the team has already assessed as **not on a reachable exploit path** (documented in
`plans/README.md`'s "considered and rejected"), so it must be scoped to fail only on **new,
non-allowlisted** high/critical advisories.

## Current state

- No audit step in `.github/workflows/ci.yml`; no `pnpm.auditConfig` in root `package.json`.
- **Accepted-as-not-reachable advisories** (from `plans/README.md`, security pass 2026-07-07 —
  keep these ignored, with rationale):
  - `undici` — reached via `cheerio` HTML *parsing*, not fetching.
  - `ws`, `systeminformation` — via Trigger host-metrics, no user input.
  - `dompurify` (via `posthog-js`) — analytics client, not an XSS sink for scraped content.
  - `next-mdx-remote` — MDX is repo-authored (read from disk), not attacker-reachable.
  These are transitive and low-urgency; ignoring them is deliberate, not negligence.
- pnpm supports an allowlist via `package.json` → `"pnpm": { "auditConfig": { "ignoreGhsas":
  [...] , "ignoreCves": [...] } }` and severity filtering via `--audit-level`.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| See current prod advisories | `pnpm audit --prod` | lists advisories (note the GHSA ids + severities) |
| Gate at high+ | `pnpm audit --prod --audit-level=high` | after the allowlist, exit 0 (no un-ignored high/critical) |
| YAML valid | `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` | exit 0 |

## Scope

**In scope**:
- root `package.json` — add a `pnpm.auditConfig` allowlist (the accepted advisories) with a
  brief inline rationale comment isn't possible in JSON, so record the rationale in this plan
  and in the CI step name / a short `docs` note if the file already has a docs pointer.
- `.github/workflows/ci.yml` — add one step: `pnpm audit --prod --audit-level=high` after
  `pnpm install --frozen-lockfile` (before or after typecheck; put it right after install).

**Out of scope**:
- Fixing/bumping any advisory (that's a per-dep plan like 008). This plan only ADDS the gate +
  allowlists the already-assessed ones.
- Dev-only advisories (`--prod` scopes to production deps — keep it that way).
- Restructuring the job or other steps.

## Git workflow

- Branch: `advisor/022-audit-ci-step`
- One commit: `ci: gate on new high/critical prod advisories (pnpm audit --prod)`.
- Do NOT push unless instructed.

## Steps

### Step 1: Enumerate the current prod advisories

Run `pnpm audit --prod` and record every advisory's **GHSA id + severity + top package**.
Cross-check each high/critical against the accepted list above. Expected: every current
high/critical maps to one of the accepted transitive advisories (undici/ws/systeminformation/
dompurify/next-mdx-remote family).

**STOP** if a current **high/critical** advisory is NOT in the accepted list (a new reachable
one exists) — report it; it needs a real bump (a separate plan), not an allowlist entry.

**Verify**: you have the exact GHSA ids to ignore.

### Step 2: Add the allowlist to `package.json`

Add (or extend) the root `package.json` `pnpm` block:
```jsonc
"pnpm": {
  "auditConfig": {
    "ignoreGhsas": [
      "GHSA-xxxx-...",   // undici via cheerio parsing — not a fetch path
      "GHSA-...",        // ws / systeminformation via Trigger host-metrics — no user input
      "GHSA-...",        // dompurify via posthog-js — analytics client, not a scraped-content sink
      "GHSA-..."         // next-mdx-remote — repo-authored MDX, not attacker-reachable
    ]
  }
}
```
Use the ACTUAL GHSA ids from Step 1 (JSON has no comments — put the ids only; keep the
rationale in this plan / the PR body). If there's already a `pnpm` block (e.g. `overrides`),
merge `auditConfig` into it rather than duplicating the key.

**Verify**: `pnpm audit --prod --audit-level=high` → **exit 0** (all remaining high/critical
are ignored; a NEW one would make it non-zero). `pnpm typecheck` still exit 0 (sanity — the
`pnpm` block edit shouldn't affect anything else).

### Step 3: Add the CI step

In `.github/workflows/ci.yml`, add after `- run: pnpm install --frozen-lockfile`:
```yaml
      - run: pnpm audit --prod --audit-level=high
```
Keep 2-space indent, no tabs.

**Verify**: YAML validates; `git diff --stat HEAD` shows only `package.json` + `ci.yml`.

## Test plan

- No unit test. The gate itself is the deliverable: `pnpm audit --prod --audit-level=high`
  exits 0 today (allowlisted) and will exit non-zero when a new un-allowlisted high/critical
  prod advisory appears — which is exactly the regression guard.

## Done criteria

ALL must hold:
- [ ] `pnpm audit --prod --audit-level=high` exits 0 locally (allowlist covers current highs)
- [ ] `package.json` has a `pnpm.auditConfig.ignoreGhsas` with the accepted advisories' real GHSA ids
- [ ] `ci.yml` runs `pnpm audit --prod --audit-level=high` after install
- [ ] `pnpm typecheck` still exits 0; only `package.json` + `ci.yml` changed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:
- Step 1 finds a high/critical advisory NOT in the accepted list — a new reachable vuln; report
  for a real fix, do not silently allowlist it.
- `pnpm audit` cannot run in the environment (no registry/network) — report; do not weaken the
  gate to `--audit-level=critical`-only to make it "pass".
- The accepted advisories no longer appear (already fixed upstream by a dep refresh) — then the
  `ignoreGhsas` list should be empty/trimmed; note which were dropped.

## Maintenance notes

- Each `ignoreGhsas` entry is a deliberate "assessed not reachable" decision — when a dep
  refresh (plan 024) removes one, drop it from the list so it can re-trigger if it returns.
- If a future advisory IS reachable, fix it (bump/override) rather than adding it here.
- Consider a scheduled (weekly `cron`) audit run in addition to per-PR, so a newly-published
  advisory on an unchanged dep is caught without waiting for the next PR.
