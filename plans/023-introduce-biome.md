# Plan 023: Introduce Biome (format + conservative lint) and gate it in CI

> **Executor instructions**: Follow this plan step by step. Run every verification command.
> This is the highest-churn plan in the DX batch — respect the STOP conditions (especially the
> "too many lint findings" one). When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git show HEAD:package.json | grep -iE "biome|eslint|prettier"`
> and `ls biome.json biome.jsonc .eslintrc* .prettierrc* 2>/dev/null`. If any linter/formatter
> tooling already exists, STOP — the premise changed.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW–MED (a repo-wide format sweep is a large mechanical diff)
- **Depends on**: 021 (CI base). **Land when there are NO other open PRs** (a format sweep
  conflicts with every open branch) — coordinate timing with the operator.
- **Category**: dx / tooling
- **Planned at**: commit `bf3a0ce`, 2026-07-09

## Why this matters

The repo has **no linter or formatter** (no biome/eslint/prettier in `package.json`, no config
file) — style is maintained by hand and there is no automated catch for unused imports/vars,
obvious foot-guns, or inconsistent formatting. Now that CI exists (#126), adding Biome (one
fast tool for both lint + format) gives a cheap, enforceable baseline. Biome is chosen over
eslint+prettier for speed and zero-config-ish setup; it is a devDependency only.

## Current state

- Root `package.json`: no `lint`/`format` scripts; no biome/eslint/prettier devDeps; no config.
- Observed code style (match it so the format sweep is minimal): TypeScript, **2-space indent,
  double quotes, semicolons, trailing commas, ~100 char line width**, ES modules. Confirm by
  reading a few files (`apps/api/src/index.ts`, `packages/shared/src/index.ts`).
- `pnpm typecheck` (8/8) and `pnpm test` (12/12 tasks) are green on `HEAD` — this is the
  behavior-preservation baseline the format sweep must not break.
- Monorepo: pnpm workspaces + turbo. Biome runs at the repo root over `apps/**` + `packages/**`.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Add Biome (root devDep) | `pnpm add -D -w @biomejs/biome` | added to root `package.json` devDeps + lockfile |
| Count lint findings | `pnpm exec biome lint . 2>&1 | tail -5` | a finite count (see STOP threshold) |
| Apply format + safe fixes | `pnpm exec biome check --write .` | reformats + applies safe fixes |
| Verify nothing broke | `pnpm typecheck && pnpm test` | typecheck 8/8, test 12/12 (unchanged) |
| CI-style check | `pnpm exec biome ci .` | exit 0 after the sweep |

## Scope

**In scope**:
- root `package.json` (add `@biomejs/biome` devDep + `lint`/`format` scripts) + `pnpm-lock.yaml`
- `biome.json` (create — config tuned to the existing style)
- `.github/workflows/ci.yml` (add a `biome ci` step)
- The mechanical formatting diff across `apps/**` + `packages/**` from `biome check --write`
- A `.biomeignore` (or `files.ignore` in `biome.json`) for generated/vendored paths:
  `**/dist`, `**/.next`, `**/node_modules`, `packages/db/migrations/**` (generated SQL/snapshots),
  any `*.snapshot.json`.

**Out of scope**:
- Turning on Biome's *entire* recommended lint rule set as errors if it produces a large
  finding count (see STOP) — start conservative.
- Hand-fixing lint findings beyond what `biome check --write` safely auto-fixes — if manual
  fixes balloon, STOP and report (the operator ratchets rule-by-rule).
- Changing any runtime behavior. The sweep is formatting + safe fixes only.

## Git workflow

- Branch: `advisor/023-introduce-biome`
- Two commits: `build(biome): add Biome config + scripts + CI step` (config/scripts/CI/ignore),
  then `style: apply Biome formatting across the repo` (the mechanical sweep) — keeping the
  large mechanical diff in its own commit makes review tractable.
- Do NOT push unless instructed.

## Steps

### Step 1: Add Biome + config tuned to the existing style

`pnpm add -D -w @biomejs/biome`. Create `biome.json` with formatter settings matching the repo
(2-space, double quotes, semicolons always, trailing commas, line width 100), and a
**conservative** linter: start from `recommended` but if that explodes (Step 2), scope down to
`correctness` + `noUnusedImports`/`noUnusedVariables` as the initial enforced set and leave the
rest as warnings. Add the ignore globs (see Scope). Add scripts: `"lint": "biome check ."`,
`"format": "biome check --write ."`.

**Verify**: `pnpm exec biome --version` works; `biome.json` parses.

### Step 2: Measure the lint blast radius BEFORE sweeping

Run `pnpm exec biome lint .` and count findings.
- If findings are **≤ ~30** and all are safely auto-fixable or trivially correct → proceed.
- If findings are **> ~30**, or any require non-trivial manual judgment (real logic changes) →
  **STOP and report the counts by rule.** The operator decides which rules to enable now vs
  ratchet later. Do NOT mass-edit source to satisfy a noisy rule.

**Verify**: you can state the finding count and that Step 3 will only apply safe fixes.

### Step 3: Apply the format + safe fixes, prove nothing broke

`pnpm exec biome check --write .` (formats + applies *safe* fixes only). Then the
behavior-preservation gate:
- `pnpm typecheck` → 8/8 (a format/safe-fix must not break types).
- `pnpm test` → 12/12 tasks green.
If typecheck or tests go red, the "safe fix" wasn't safe — **STOP**, revert, and report which
file/rule caused it.

**Verify**: `pnpm exec biome ci .` → exit 0 (the repo is now clean under the config).

### Step 4: Add the CI step

In `.github/workflows/ci.yml`, add a step (after install, before or alongside typecheck):
```yaml
      - run: pnpm exec biome ci .
```

**Verify**: YAML validates (no tabs); `git diff --stat HEAD` = the two commits' files only.

## Test plan

- No new unit tests. The guarantee is: the existing `pnpm typecheck` (8/8) + `pnpm test`
  (12/12) stay green *after* the sweep — that's the behavior-preservation proof for a
  formatting change. The `biome ci` step is itself the ongoing regression guard.

## Done criteria

ALL must hold:
- [ ] `@biomejs/biome` is a root devDep; `biome.json` exists tuned to the repo style
- [ ] `pnpm exec biome ci .` exits 0 on the whole repo
- [ ] `pnpm typecheck` (8/8) and `pnpm test` (12/12) are **still green** after the sweep
- [ ] `ci.yml` runs `biome ci` on every PR/push
- [ ] Generated/vendored paths (dist, .next, migrations, snapshots) are ignored
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:
- `biome lint .` reports **> ~30** findings or any needing real logic changes — report by rule;
  do not mass-edit source.
- `biome check --write` makes `pnpm typecheck` or `pnpm test` go red — revert, report the cause.
- Other open PRs exist at execution time — a repo-wide sweep will conflict with them; report and
  wait until the queue is clear.

## Maintenance notes

- Ratchet: once the conservative set is green, enable more Biome rules incrementally in their own
  small PRs (each keeping CI green) rather than all at once.
- Keep the formatter settings in `biome.json` as the single source of style truth; drop any
  ad-hoc style notes from `.claude/rules/typescript.md` that Biome now enforces (a tiny docs
  follow-up).
- Reviewer: skim the `style:` commit for any *non*-whitespace change (a safe-fix that altered
  logic) — there should be none.
