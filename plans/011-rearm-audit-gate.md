# Plan 011: The dependency audit gate blocks again, and its allowlist is justified

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 74888f6..HEAD -- .github/workflows/ci.yml package.json`
> If either changed since this plan was written, compare the "Current state"
> excerpts against the live files before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW-MED
- **Depends on**: plans/010 (must clear the reachable highs first, or CI goes red
  the moment this lands)
- **Category**: security
- **Planned at**: commit `74888f6`, 2026-07-25

## Why this matters

A dependency-audit gate was deliberately built for this repo. Commit `267a8b6`
(2026-07-09) added both the CI step and a 17-entry GHSA allowlist as its
point-in-time baseline, under the title "ci: gate on new high/critical prod
advisories".

Six days later, commit `93ba280` appended `|| true` to that step, with a comment
explaining that npm had retired its audit endpoint and the command errored on
every run regardless of advisories.

**That justification is no longer true.** Running
`pnpm audit --prod --audit-level=high` at `74888f6` produces a full report and
exits `1`. So today the repo has:

- a gate that passes unconditionally, hiding 23 high advisories, and
- a 17-entry suppression list with no recorded justification per entry, which
  is currently hiding 9 of those highs.

Together that is worse than having neither, because the workflow reads as though
it is protecting the repo.

One correction to carry: it is easy to conclude from the audit's printed table
that the allowlist is inert, because ignored advisories are omitted from the
detail output. They are not inert. The summary line is explicit:
`7 low (4 ignored) | 16 moderate (4 ignored) | 23 high (9 ignored)`.

## Current state

### The neutered step (`.github/workflows/ci.yml:19-23`)

```yaml
      # Best-effort: npm retired the /-/npm/v1/security/audits endpoint (410), so
      # `pnpm audit` now always errors on this pnpm version regardless of advisories.
      # Keep it informational (logs when the endpoint works) but non-blocking so it
      # can't fail every PR. Revisit once pnpm defaults to the bulk advisory endpoint.
      - run: pnpm audit --prod --audit-level=high || true
```

The comment tells you exactly when to revisit. That time is now.

### The unexplained allowlist (`package.json:32-51`)

```json
  "pnpm": {
    "overrides": { "@opentelemetry/api": "1.9.0" },
    "auditConfig": {
      "ignoreGhsas": [
        "GHSA-vxr8-fq34-vvx9",
        "GHSA-gvmj-g25r-r7wr",
        ... 15 more ...
      ]
    }
  }
```

Seventeen identifiers, no comment, no companion document. Nothing records why
each was accepted or when it should be revisited.

### Measured behaviour at `74888f6`

```
$ pnpm audit --prod --audit-level=high 2>&1 | tail -2
46 vulnerabilities found
Severity: 7 low (4 ignored) | 16 moderate (4 ignored) | 23 high (9 ignored)

$ pnpm audit --prod --audit-level=high > /dev/null 2>&1; echo $?
1
```

### Related repo facts

- Plan 001 makes CI a required check for merging. Once that lands **and** this
  plan removes `|| true`, a new high advisory genuinely blocks merges. That is
  the intent; it is also worth knowing before it happens.
- JSON does not support comments, so per-entry justification cannot live inline
  in `package.json`. It needs a companion file.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Audit | `pnpm audit --prod --audit-level=high` | after this plan: exit 0 |
| Audit summary | `pnpm audit --prod --audit-level=high 2>&1 \| tail -2` | severity line |
| Audit JSON | `pnpm audit --prod --json` | machine-readable report |
| Typecheck | `pnpm typecheck` | exit 0 |
| Whole suite | `pnpm test` | exit 0 |

Note: `turbo` is **not** on `PATH`. Use the `pnpm` scripts.

## Scope

**In scope** (the only files you should modify or create):
- `.github/workflows/ci.yml` (remove `|| true`, rewrite the stale comment)
- `package.json` (prune the allowlist to entries that are still justified)
- `docs/security-advisories.md` (create: one line of justification per surviving entry)

**Out of scope** (do NOT touch, even though they look related):
- Any dependency version. Clearing reachable advisories is plan 010, and this
  plan must run **after** it.
- `pnpm.overrides` (`@opentelemetry/api: 1.9.0`). It sits next to `auditConfig`
  in the same block but is a resolution constraint, not an audit suppression.
  Its removal depends on Trigger leaving the tree.
- The moderate and low advisories, and the `--audit-level=high` threshold.
- Adding a scheduled audit workflow. Reasonable follow-up, not this plan.

## Git workflow

- Branch: `ci/rearm-audit-gate` off `main`.
- Commit message style, matching `git log`: `ci: gate on reachable prod advisories`.
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Confirm plan 010 has landed

```bash
grep -c "@trigger.dev" apps/api/package.json     # expect 0
grep -n '"next"' apps/web/package.json           # expect ^16.2.11 or higher
pnpm audit --prod --audit-level=high 2>&1 | tail -2
```

**Verify**: the dead Trigger dependency is gone, `next` is bumped, and the high
count is materially below the 23 recorded at `74888f6`.

If plan 010 has not landed, **STOP**. Re-arming the gate first makes CI red on
every pull request, which is exactly the pressure that produced `|| true` last time.

### Step 2: Enumerate what the allowlist is actually hiding

The audit's printed table omits ignored advisories, so you must diff with and
without the allowlist. Do this **without mutating the repo's `package.json`**:
copy the repo to a scratch directory, or use a git stash you restore immediately.

Safest approach:

```bash
cp package.json /tmp/package.json.bak
# temporarily empty ignoreGhsas in package.json
pnpm audit --prod --json > /tmp/audit-no-allowlist.json
cp /tmp/package.json.bak package.json      # RESTORE IMMEDIATELY
git diff --exit-code package.json          # must show no change
```

Then diff the advisory ids in that report against the ones reported with the
allowlist in place. That difference is the 17 (9 of them high).

**Verify**: `git diff --exit-code package.json` exits 0 (the file is restored),
and you have a list of the suppressed advisory ids with their package and path.

### Step 3: Justify or drop each surviving entry

For each of the 17, decide one of:

- **Drop it**: the advisory no longer appears in the tree at all (the dependency
  is gone or already patched). Remove it from the list.
- **Keep it**: it is still reported and you can state, in one line, why it is not
  reachable. The bar is a real reachability argument, for example "build-time
  only, not in any runtime path" or "transitive under a parser that never
  fetches", not "it looked noisy".

Record the surviving entries in a new `docs/security-advisories.md`:

```markdown
# Accepted dependency advisories

Each entry is suppressed in `package.json` (`pnpm.auditConfig.ignoreGhsas`) and
must have a reachability argument here. An entry with no argument is a bug: drop
it from the allowlist instead.

| GHSA | Package | Path | Why it is accepted | Revisit when |
|---|---|---|---|---|
| GHSA-... | ... | ... | build-time only, ... | ... |
```

Write it in English, per the repo's language rule.

If you cannot make a reachability argument for an entry, **drop it from the
allowlist**. If the advisory then fails the gate, that is the correct signal and
belongs in a follow-up bump.

**Verify**: every id remaining in `package.json` has a row in the new document,
and every row names a package and a path.

### Step 4: Re-arm the gate

Edit `.github/workflows/ci.yml`: remove `|| true`, and replace the stale comment
with one that says what is true now:

```yaml
      # Blocks on a reachable high/critical advisory in production dependencies.
      # Accepted advisories are suppressed via pnpm.auditConfig.ignoreGhsas in
      # package.json, each with a reachability argument in docs/security-advisories.md.
      # (The npm 410 that made this non-blocking in 2026-07 no longer applies.)
      - run: pnpm audit --prod --audit-level=high
```

**Verify**: `grep -c "|| true" .github/workflows/ci.yml` returns 0.

### Step 5: Prove the gate passes locally before pushing it

```bash
pnpm audit --prod --audit-level=high; echo "exit: $?"
```

**Verify**: exit code `0`.

This is the critical check. If it exits non-zero, CI will fail on every pull
request the moment this merges. Either finish the bumps in plan 010, or add the
specific remaining advisory to the allowlist **with its justification row**, or
STOP and report.

### Step 6: Full check

**Verify**: `pnpm typecheck` exits 0 and `pnpm test` exits 0.

## Test plan

No unit tests: this changes CI configuration and a suppression list.

The verification is behavioural and is step 5: the exact command CI will run,
run locally, exiting 0. Record its output and the severity line in your report.

Optionally add a repository test asserting that every id in
`pnpm.auditConfig.ignoreGhsas` appears in `docs/security-advisories.md`. That
turns "every suppression needs a reason" from a convention into a gate, and it is
cheap: read both files, compare the id sets. If you add it, put it where a
package's test script will actually run it (`packages/shared` runs `bun test src`).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c "|| true" .github/workflows/ci.yml` returns 0
- [ ] `pnpm audit --prod --audit-level=high` exits 0
- [ ] `docs/security-advisories.md` exists and has one row per id remaining in
      `pnpm.auditConfig.ignoreGhsas`
- [ ] The id set in `package.json` and the id set in the doc are identical
- [ ] `git diff package.json` shows only `ignoreGhsas` changes (no accidental
      edit to `pnpm.overrides` or `devDependencies`)
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0
- [ ] Your report contains the before and after severity lines
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 010 has not landed (step 1 fails). Re-arming first guarantees a red CI.
- Step 5 exits non-zero and the only way to make it pass is to add advisories to
  the allowlist that you cannot justify. That converts a real gate into
  theatre a second time. Report which advisories are blocking and what bump
  would clear them.
- `pnpm audit` errors with a 410 or a network failure. The stale comment would
  become true again; report it rather than restoring `|| true` silently.
- Your temporary allowlist-emptying in step 2 leaves `package.json` modified.
  Restore it immediately and verify with `git diff --exit-code package.json`
  before doing anything else.
- You find that removing a GHSA from the list surfaces an advisory on a genuinely
  reachable runtime path. That is a real finding: report it as its own item
  rather than re-suppressing it.

## Maintenance notes

- **This plan plus plan 001 is what makes the gate real.** A blocking audit step
  in a workflow that is not a required check still lets a merge through. Both are
  needed.
- **The gate will eventually fire on someone else's schedule.** A newly-published
  advisory against a dependency you did not touch can turn `main` red overnight.
  That is the correct behaviour, and the escape hatch is a justified allowlist
  entry with a revisit date, not `|| true`. Say this in the pull-request
  description so the next person under time pressure knows the intended move.
- **Keep the allowlist small and dated.** The failure mode of the first attempt
  was 17 undocumented ids; the failure mode of the second attempt would be 40.
  The `docs/security-advisories.md` table with a "Revisit when" column is the
  mechanism that stops it.
- A reviewer should check that every allowlist entry's justification is a
  *reachability* claim, not a severity opinion. "Low exploitability" is not a
  reason; "not present in any runtime code path, build-time only" is.
