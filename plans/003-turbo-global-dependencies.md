# Plan 003: Editing the root `tsconfig.json` invalidates the typecheck cache

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 74888f6..HEAD -- turbo.json tsconfig.json`
> If either file changed since this plan was written, compare the "Current state"
> excerpts against the live files before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `74888f6`, 2026-07-25

## Why this matters

`pnpm typecheck` is the de-facto verification gate in this repo. A full
`pnpm build` exhausts the RAM on the WSL2 dev box, so typecheck plus tests is
what stands between a change and production.

`turbo.json` declares no `globalDependencies`. Turborepo hashes each package's
own files and the lockfile, but it does not know that all eight packages
`"extends": "../../tsconfig.json"`. That root file carries `strict`,
`noUncheckedIndexedAccess`, `target` and `lib`. Loosening any of them changes
what every `tsc --noEmit` in the monorepo accepts, and Turborepo will happily
replay a cached "successful" typecheck computed under the *old* compiler options.

This is not theoretical. While auditing this repo, the first `pnpm typecheck`
run reported `8 successful, 8 total / 8 cached / >>> FULL TURBO` in 42ms, and
the replayed logs showed a working directory of `/home/tmfzi/digests/apps/workers`.
`git worktree list` confirms `/home/tmfzi/digests` is a **different worktree of
this repository, checked out on a different branch**. So the cache can and does
serve results computed somewhere else. Combined with the missing
`globalDependencies`, "green" can mean "green somewhere else, under settings that
may since have changed".

## Current state

### `turbo.json` (complete, 30 lines)

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build":     { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "dev":       { "cache": false, "persistent": true },
    "typecheck": { "dependsOn": ["^typecheck"] },
    "test":      { "dependsOn": ["^build"], "cache": false },
    "db:push":   { "cache": false },
    "db:migrate":{ "cache": false },
    "db:studio": { "cache": false, "persistent": true },
    "trigger:dev": { "cache": false, "persistent": true }
  }
}
```

There is no `globalDependencies` key, no `globalEnv` key, and no per-task
`inputs` or `env`.

### Root `tsconfig.json`

Carries the compiler options every workspace inherits. Confirm with:

```bash
grep -n "strict\|noUncheckedIndexedAccess\|target\|lib" tsconfig.json
```

### Every workspace extends it

```bash
grep -l '"extends": "../../tsconfig.json"' apps/*/tsconfig.json packages/*/tsconfig.json
```

returns all eight.

### Repo rule this supports

`.claude/rules/typescript.md` states: "strict: true dans tous les tsconfig.json —
ne jamais désactiver" and "noUncheckedIndexedAccess: true". The cache currently
cannot detect a violation of that rule, which makes the rule unenforceable.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0, 8 tasks |
| Forced typecheck | `pnpm exec turbo typecheck --force` | exit 0, 8 tasks, 0 cached |
| Tests | `pnpm test` | exit 0 |
| Dry-run graph | `pnpm exec turbo typecheck --dry=json` | JSON, no error |

**Important**: `turbo` is **not** on `PATH` here. It must be invoked as
`pnpm exec turbo ...`. A bare `turbo typecheck --force` prints
`turbo: command not found` and, if piped, looks like silence rather than failure.
This exact mistake produced a false "green baseline" during the audit that
produced this plan.

## Scope

**In scope** (the only file you should modify):
- `turbo.json`

**Out of scope** (do NOT touch, even though they look related):
- Root `tsconfig.json` and every per-package `tsconfig.json`. This plan makes the
  cache *notice* changes to them; it does not change any compiler option.
- `turbo.json`'s `build` task `outputs` and the `test` task's
  `dependsOn: ["^build"]`. Six of eight packages define `build` as a duplicate of
  `typecheck`, which is real waste, but collapsing it changes what `pnpm build`
  means and needs its own change. Leave it.
- Adding `globalEnv`. It is tempting (the `NEXT_PUBLIC_*` set is build-time
  inlined) but it changes cache keys for `apps/web` builds and interacts with
  plan 008. Out of scope here; noted in Maintenance.

## Git workflow

- Branch: `fix/turbo-global-dependencies` off `main`.
- Commit message style, matching `git log`: `fix(ci): hash the root tsconfig in turbo`.
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Reproduce the stale-cache hole

Prove the defect exists before fixing it, so you can prove the fix works.

```bash
pnpm typecheck                       # warm the cache
touch tsconfig.json                  # touch only; do NOT change contents
pnpm typecheck 2>&1 | tail -4
```

**Verify**: the second run still reports cache hits (`FULL TURBO` or
`N cached`). That is the bug: a change to the file every package inherits from
did not invalidate anything.

If the second run instead re-executes all 8 tasks, STOP — the behaviour differs
from what this plan describes.

### Step 2: Declare the root config as a global dependency

Edit `turbo.json`, adding a `globalDependencies` array at the top level (a
sibling of `tasks`, not inside it):

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["tsconfig.json"],
  "tasks": {
    ...unchanged...
  }
}
```

Keep the list minimal. `tsconfig.json` is the file with a proven effect on every
task's correctness. Do **not** add `.env.example` here: it changes no compiler
behaviour, and adding it means every documentation edit busts the whole cache.

**Verify**: `pnpm exec turbo typecheck --dry=json > /dev/null` exits 0 (the
config still parses).

### Step 3: Prove the hole is closed

```bash
pnpm typecheck                       # warm
touch tsconfig.json
pnpm typecheck 2>&1 | tail -4
```

**Verify**: the second run now re-executes the tasks (0 cached, no `FULL TURBO`).

Then confirm the cache still works when nothing relevant changed:

```bash
pnpm typecheck 2>&1 | tail -4
```

**Verify**: this third run is cached again. If it is not, the entry is being
invalidated by something else and you have made the cache useless rather than
correct. STOP and report.

### Step 4: Establish an honest baseline

```bash
pnpm exec turbo typecheck --force 2>&1 | tail -6
pnpm test 2>&1 | tail -4
```

**Verify**: typecheck exits 0 with 8 tasks and 0 cached; tests exit 0.
Note the task count: it is 13 if plan 002 has already landed, 12 otherwise.
Either is fine; just report which you saw.

## Test plan

There is no unit test for a build-tool config. The verification is the
before/after pair in steps 1 and 3, which is a genuine behavioural test:
the same command sequence produces a cache hit before the change and a cache
miss after it.

Record both outputs in your report so the change is auditable.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c globalDependencies turbo.json` returns 1
- [ ] `pnpm exec turbo typecheck --dry=json > /dev/null` exits 0
- [ ] After `pnpm typecheck && touch tsconfig.json && pnpm typecheck`, the second
      run reports 0 cached tasks
- [ ] A third consecutive `pnpm typecheck` with no file change reports cache hits
- [ ] `pnpm exec turbo typecheck --force` exits 0
- [ ] `pnpm test` exits 0
- [ ] `git diff --name-only` lists only `turbo.json`
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 does **not** reproduce the stale hit (the cache already invalidates on a
  root `tsconfig.json` touch). The premise of this plan would be wrong; report
  the Turborepo version (`pnpm exec turbo --version`) and what you observed.
- After step 2 the cache never hits again, even with no changes. You have made
  every run a full run. Report it rather than adding more keys to compensate.
- `pnpm exec turbo` itself fails. Do not fall back to a bare `turbo` invocation:
  it is not on `PATH` and will silently do nothing.
- You find yourself wanting to add `globalEnv` or per-task `env` to make
  something pass. That is a different change with different blast radius; report
  the need instead of widening this plan.

## Maintenance notes

- **The unpinned orchestrator**: root `package.json` declares `"turbo": "latest"`,
  the only unpinned specifier in the repo. Cache semantics and `turbo.json`
  schema have changed across Turborepo majors, so a `pnpm update` could move the
  orchestrator across a major with no version in the diff. Pinning it is a
  separate one-line change worth doing next.
- **`globalEnv` is the obvious follow-up.** `apps/web`'s `next build` inlines
  `NEXT_PUBLIC_*` values at build time, so two builds with different values
  currently share a cache key. Plan 008 fixes which of those vars reach the
  Docker build; deciding whether they belong in `globalEnv` is best done after it.
- **Cross-worktree cache sharing is the real hazard behind this plan.** Several
  worktrees of this repo exist (`git worktree list` shows five). Anything that
  makes two checkouts agree on a hash while disagreeing on inputs produces a
  false green. When adding a new root-level file that affects compilation or
  test behaviour, add it to `globalDependencies` in the same change.
- A reviewer should check that the list stays short. Every entry added busts the
  entire cache on every change to that file; the bar is "does this file change
  what a task would output".
