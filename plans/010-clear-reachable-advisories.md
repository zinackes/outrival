# Plan 010: Clear the reachable high advisories that a version bump fixes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 74888f6..HEAD -- apps/web/package.json apps/api/package.json packages/scrapers/package.json pnpm-lock.yaml`
> If any changed since this plan was written, re-run the audit in step 1 and
> compare against the counts below before proceeding.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW-MED
- **Depends on**: none (but plan 011 depends on this one)
- **Category**: security
- **Planned at**: commit `74888f6`, 2026-07-25

## Why this matters

`pnpm audit --prod --audit-level=high` reports, at `74888f6`:

```
46 vulnerabilities found
Severity: 7 low (4 ignored) | 16 moderate (4 ignored) | 23 high (9 ignored)
```

Three groups of high advisories are both **reachable** and **cheap to clear**:

1. **`next@16.2.6`** carries four high advisories, all `>=16.0.0 <16.2.11`,
   patched in `16.2.11`. One of them is an SSRF in rewrites, and
   `apps/web/next.config.ts` does define rewrites (the PostHog relay). The
   declared range is already `^16.2.6`, so `16.2.11` is **inside the existing
   caret**: this is a lockfile change, not a version-policy decision. Two
   transitive `postcss` highs clear with the same bump.
2. **`@trigger.dev/sdk` in `apps/api`** is a dead dependency. `apps/api` has
   zero `@trigger.dev` imports, and the old `apps/api/src/lib/trigger.ts` shim
   no longer exists. It is nonetheless the **sole path** for two high advisories
   (`systeminformation` OS command injection, `engine.io` connection
   exhaustion). Deleting one manifest line removes both.
3. **`sharp`** is a high advisory (`<0.35.0`) on the path that processes
   screenshots fetched from monitored third-party sites, which is the one high
   in the tree whose input is untrusted by design. It is also installed twice at
   different versions (`0.33.5` in `apps/web`, `0.34.5` in `packages/scrapers`).

Group 2 is free. Group 1 is a lockfile refresh. Group 3 crosses a `sharp` major
and needs a check on the screenshot pipeline.

Plan 011 re-arms the CI audit gate. It cannot land until this plan clears the
reachable advisories, or CI turns red immediately.

## Current state

### Declared versions

```
apps/web/package.json:37          "next": "^16.2.6"
apps/web/package.json:43          "react": "^19.2.6"
apps/web/package.json:45          "react-dom": "^19.2.6"
apps/web/package.json:56          "sharp": "^0.33.5"        (devDependency)
apps/api/package.json:21          "@trigger.dev/sdk": "^4.4.6"
packages/scrapers/package.json:153 "sharp": "^0.34.5"
```

Installed `next` is `16.2.6` (`apps/web/node_modules/next/package.json`).

### `apps/api` does not import Trigger at all

```bash
grep -rn "@trigger.dev" apps/api/src apps/api/test
```

returns nothing at `74888f6`. Verify this yourself before deleting the
dependency; it is the whole justification.

### `sharp` in the scrapers package

`packages/scrapers` uses `sharp` for the perceptual-hash and screenshot
pipeline, which consumes images fetched from competitor sites.

### The repo's dependency-bump convention

There is a recorded convention for single-dependency bumps: edit the range in
the manifest, run `pnpm install --lockfile-only`, then scope-guard the resulting
diff so unrelated packages do not drift in. Follow it.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Audit | `pnpm audit --prod --audit-level=high` | prints a report; **exits 1** today |
| Audit summary | `pnpm audit --prod --audit-level=high 2>&1 \| tail -2` | the severity line |
| Install (lockfile) | `pnpm install --lockfile-only` | exit 0 |
| Install (full) | `pnpm install` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0 |
| Whole suite | `pnpm test` | exit 0 |
| Scrapers tests | `cd packages/scrapers && bun test src` | all pass |

Note: `turbo` is **not** on `PATH`. Use the `pnpm` scripts.

`pnpm audit` **works** in this repo. The comment in `.github/workflows/ci.yml`
claiming npm's retired endpoint returns 410 is stale; the command produced the
full report quoted above. Do not skip the audit step on that basis.

Do **not** run `pnpm build` locally: a full web build exhausts this box's RAM.

## Scope

**In scope** (the only files you should modify):
- `apps/api/package.json` (remove the dead `@trigger.dev/sdk` line)
- `apps/web/package.json` (bump `next`, and `sharp` if you do step 4)
- `packages/scrapers/package.json` (bump `sharp`, step 4)
- `pnpm-lock.yaml` (regenerated, never hand-edited)

**Out of scope** (do NOT touch, even though they look related):
- `apps/workers/package.json`'s Trigger dependencies. `apps/workers` still
  imports the SDK in several files; removing it there is the Trigger-teardown
  plan, not this one.
- `.github/workflows/ci.yml` and the `pnpm.auditConfig.ignoreGhsas` allowlist.
  Re-arming the gate and re-justifying the 17 suppressed advisories is plan 011.
- The moderate and low advisories. They are transitive and build-time-only; they
  come along for free with these bumps or not at all.
- A blanket `pnpm update`. Every bump here is targeted and justified; a blanket
  refresh moves ~100 packages and cannot be reviewed.
- `typescript` (5.9.3 to 7.0.2 is a compiler change, its own decision),
  `shiki` (three majors, visual regression risk), `@sentry/*`.

## Git workflow

- Branch: `chore/clear-reachable-advisories` off `main`.
- Commit per group, so a revert is surgical:
  - `chore(api): drop the unused trigger.dev sdk`
  - `chore(web): bump next past the CORS advisories`
  - `chore(scrapers): align sharp on a patched major`
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Record the baseline

```bash
pnpm audit --prod --audit-level=high 2>&1 | tail -2
pnpm audit --prod --audit-level=high > /dev/null 2>&1; echo "exit: $?"
```

**Verify**: the severity line shows roughly `23 high (9 ignored)` and the exit
code is `1`. Paste both into your report; they are the before-state that makes
the after-state meaningful.

If the audit errors out with a 410 or a network failure, STOP and report it.

### Step 2: Drop the dead Trigger dependency from `apps/api`

```bash
grep -rn "@trigger.dev" apps/api/src apps/api/test
```

**Verify first**: this must return **nothing**. If it returns any import, STOP:
the dependency is not dead and this step is invalid.

Then remove the `"@trigger.dev/sdk": "^4.4.6"` line from
`apps/api/package.json`, and:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm audit --prod --audit-level=high 2>&1 | tail -2
```

**Verify**: typecheck and tests exit 0, and the high count drops by 2
(`systeminformation` and `engine.io` advisories gone). If the count does not
drop, those advisories have another path; report it.

### Step 3: Bump `next` within its existing caret

Edit `apps/web/package.json` to `"next": "^16.2.11"`. Bump `react` and
`react-dom` to `^19.2.8` in the same commit only if they are also inside their
existing caret and `pnpm outdated` confirms those versions exist.

```bash
pnpm install --lockfile-only
git diff --stat pnpm-lock.yaml
```

**Verify the diff is scoped**: the lockfile change should touch `next`, its
`@next/*` siblings, `postcss` and closely-related entries. If it rewrites large
unrelated sections, reset and investigate rather than committing a broad drift.

Then:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm audit --prod --audit-level=high 2>&1 | tail -2
```

**Verify**: typecheck and tests exit 0, and the high count drops by roughly 6
(four `next` plus two `postcss`).

**You cannot run `next build` on this machine.** State that plainly in your
report and flag that a web build must be verified in CI or on the deploy host
before this reaches production. A patch bump within 16.2.x is low risk, but
"typecheck passes" is not "the app builds".

### Step 4: Align `sharp` (optional, judge it)

`packages/scrapers` is at `^0.34.5`, patched is `>=0.35.0`. `apps/web` is at
`^0.33.5` (devDependency, used only by a product-screenshot capture script).

If you do this step, set both to `^0.35.3` and run:

```bash
pnpm install
cd packages/scrapers && bun test src
```

**Verify**: the scrapers suite passes, especially any perceptual-hash or
screenshot test. `sharp` bundles a native libvips binary, so a major bump can
change image output subtly; the phash tests are what would catch it.

If the scrapers suite fails, **revert this step only** and report it. Groups 2
and 3 are independent; do not lose them to a `sharp` problem.

### Step 5: Final audit and full check

```bash
pnpm audit --prod --audit-level=high 2>&1 | tail -2
pnpm typecheck
pnpm test
```

**Verify**: high count materially lower than the baseline from step 1, typecheck
and tests exit 0. Record the new severity line in your report next to the old
one, and list which advisories remain and why (build-time-only, or needing a
bump this plan excluded).

## Test plan

No new tests. This plan changes dependency versions; the existing suites are the
regression detector:

- `pnpm test` (all 12 or 13 tasks) after each group
- `cd packages/scrapers && bun test src` specifically after the `sharp` bump,
  since that is the package whose native dependency changed
- The audit severity line itself is the outcome measurement: record it before
  and after

The gap you cannot close here: `next build` is unrunnable on this box. Say so.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c "@trigger.dev" apps/api/package.json` returns 0
- [ ] `grep -rn "@trigger.dev" apps/api/src apps/api/test` returns nothing
- [ ] `apps/web/package.json` declares `next` at `^16.2.11` or higher
- [ ] `pnpm audit --prod --audit-level=high 2>&1 | tail -2` shows a lower high
      count than the step-1 baseline, and both numbers are in your report
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0
- [ ] `cd packages/scrapers && bun test src` exits 0 (if step 4 was done)
- [ ] `git diff --name-only` lists only the in-scope manifests plus `pnpm-lock.yaml`
- [ ] Your report states that `next build` was not run locally and must be
      verified in CI or on the deploy host
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `grep -rn "@trigger.dev" apps/api/src apps/api/test` returns any import. The
  dependency is live; step 2 is invalid.
- The lockfile diff for the `next` bump is broad, touching many unrelated
  packages. Reset it and report rather than committing an unreviewable drift.
- `pnpm test` fails after any group. Identify which group, revert just that one,
  and report. The three groups are independent.
- The `sharp` bump breaks the scrapers suite. Revert step 4 only; keep the rest.
- `pnpm audit` starts failing with a 410 or network error mid-plan. Report it,
  and note that plan 011 (re-arming the gate) depends on the command working.
- The high count does not drop after a bump you expected to fix it. That means
  another path exists to the same advisory; report the paths rather than adding
  the advisory to the ignore list.

## Maintenance notes

- **Plan 011 depends on this.** It removes `|| true` from the CI audit step so a
  new reachable high advisory fails the build. That is only viable once the
  reachable ones here are cleared.
- **`apps/workers` still depends on Trigger.** This plan only removes the dead
  `apps/api` entry. The workers' Trigger dependencies come out with the wrapper
  teardown, which itself needs the logger swap to land first.
- **`sharp` deserves a single owner.** Two workspaces installing two versions of
  a package with a native binary means it is compiled and shipped twice, and the
  two copies can behave differently on the same image. Consolidating on
  `packages/scrapers` (with the web capture script depending on it) is the
  cleaner end state.
- A reviewer should check the lockfile diff is scoped to what the manifest
  changes imply, and should not accept "audit is quieter" without seeing the
  before and after severity lines.
