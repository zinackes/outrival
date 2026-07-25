# Plan 001: `main` rejects a merge whose CI is red

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 74888f6..HEAD -- .github/workflows/ci.yml`
> If `ci.yml` changed since this plan was written, compare the "Current state"
> excerpt against the live file before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `74888f6`, 2026-07-25

## Why this matters

This repo has an excellent verification story: `pnpm typecheck` and `pnpm test`
run 1515 tests across 12 tasks in about 31 seconds, and `.github/workflows/ci.yml`
runs both on every pull request. None of it gates anything. The `main` branch has
no protection rule and no ruleset, so a pull request whose CI job failed can still
be merged, and a commit can be pushed straight to `main` without CI running at all.

That is not hypothetical: the current `HEAD` (`74888f6`) is a single-parent commit
with no `(#NNN)` pull-request suffix, while the twenty commits before it are all
squash-merged pull requests. The team already works through pull requests; the
enforcement is simply missing.

`main` is the production source (Coolify auto-deploys web and api from it, and
`.github/workflows/deploy.yml` builds the worker image from it), so an unverified
commit on `main` reaches production. Every other plan in this directory is safer
to execute once a red suite mechanically blocks a merge.

## Current state

This plan changes **repository settings**, not source code. The only file it may
touch is `.github/workflows/ci.yml`, and only to split one job into two.

Verified facts at `74888f6`:

- `gh api repos/:owner/:repo/branches/main/protection` returns
  `{"message":"Branch not protected","status":"404"}`.
- `gh api repos/:owner/:repo/rulesets` returns `[]`.
- `.github/workflows/ci.yml` defines exactly one job, named `verify`:

```yaml
# .github/workflows/ci.yml:1-10
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
```

- The job's last two steps are `pnpm typecheck` and `pnpm test`
  (`.github/workflows/ci.yml:22-23`). Both pass at `74888f6`.
- The status check name that a ruleset must require is therefore **`verify`**
  (the job id), not "CI" (the workflow name).

Repo convention for commits, from `git log --format=%s -5`:

```
chore: drop the improve-skill audit artifacts
feat(web): one motion for every filtered list (#271)
fix(web): drop select panels below the trigger (#270)
```

Conventional Commits, subject 50 characters or less, imperative mood, English.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Check protection | `gh api repos/:owner/:repo/branches/main/protection` | after this plan: JSON, not a 404 |
| List rulesets | `gh api repos/:owner/:repo/rulesets` | after this plan: one entry |
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | exit 0 |
| Confirm gh auth | `gh auth status` | logged in, with `repo` scope |

Note: `turbo` is **not** on `PATH` in this environment. Always go through the
`pnpm` scripts above. Invoking `turbo ...` directly fails with
`turbo: command not found`, and if you pipe it the failure is easy to miss.

## Scope

**In scope**:
- GitHub repository ruleset for `main` (created via `gh api`, not a file).
- `.github/workflows/ci.yml` (optional split of `verify` into two jobs, step 3).

**Out of scope** (do NOT touch, even though they look related):
- `.github/workflows/deploy.yml` — its `workflow_run` trigger already gates the
  worker deploy on CI success. Adding branch protection does not change it, and
  editing it risks the worker deploy path.
- The `pnpm audit --prod --audit-level=high || true` step in `ci.yml`. Re-arming
  that gate is plan 011 and it will fail CI today if you touch it here.
- Any source file. This plan changes settings only.

## Git workflow

- Most of this plan is a repository setting with no commit. If you do step 3,
  branch `fix/ci-split-verify-jobs` off `main`.
- Commit message style: `ci: split verify into typecheck and test jobs`.
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Confirm the current unprotected state

Record the "before" so the change is auditable.

```bash
gh api repos/:owner/:repo/branches/main/protection || echo "NOT PROTECTED (expected)"
gh api repos/:owner/:repo/rulesets
```

**Verify**: the first prints a 404 / "Branch not protected", the second prints `[]`.
If either already shows a rule, STOP (see STOP conditions).

### Step 2: Create a ruleset on `main` requiring the `verify` check

Create a ruleset that (a) requires the `verify` status check to pass, (b) blocks
force pushes, and (c) blocks deletion. Write the payload to your scratch directory
first, then post it.

```bash
cat > /tmp/ruleset.json <<'JSON'
{
  "name": "main protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [{ "context": "verify" }]
      }
    }
  ]
}
JSON
gh api repos/:owner/:repo/rulesets --method POST --input /tmp/ruleset.json
```

Deliberate choices, do not change them without saying so in your report:

- `strict_required_status_checks_policy: false` — requiring the branch to be
  up to date with `main` before merging would force a rebase on every merge.
  With one active author that is friction without benefit.
- No `pull_request` rule requiring approvals. This is a single-author repo;
  requiring a reviewer would block every merge. The gate here is **CI**, not review.
- `non_fast_forward` blocks force-pushes to `main`.

**Verify**: `gh api repos/:owner/:repo/rulesets` returns one entry whose
`name` is `main protection` and whose `enforcement` is `active`.

### Step 3 (optional): Split `verify` so a failure names itself

Today one job runs both `pnpm typecheck` and `pnpm test`, so a red check says
only "verify failed". If you do this step, the ruleset from step 2 must be
updated to require **both** new contexts, or the gate silently weakens to
whichever job you kept named `verify`.

If you do it, edit `.github/workflows/ci.yml` so the single `verify` job becomes
two jobs (`typecheck` and `test`), each repeating the checkout/setup/install
steps, then update the ruleset:

```bash
# required_status_checks becomes:
#   [{ "context": "typecheck" }, { "context": "test" }]
gh api repos/:owner/:repo/rulesets/<ID> --method PUT --input /tmp/ruleset-2jobs.json
```

**Verify**: `pnpm typecheck` and `pnpm test` still exit 0 locally, and
`gh api repos/:owner/:repo/rulesets/<ID>` lists both contexts.

**If you are unsure, skip step 3.** A single required `verify` check is already
the whole win; splitting it is ergonomics.

### Step 4: Prove the gate is live

```bash
gh api repos/:owner/:repo/rulesets --jq '.[].name'
gh api "repos/:owner/:repo/rules/branches/main" --jq '[.[].type]'
```

**Verify**: the second command lists `deletion`, `non_fast_forward` and
`required_status_checks`, which is GitHub reporting the rules that actually
apply to `main` (not just that a ruleset exists).

## Test plan

There are no new unit tests: this plan changes repository configuration.

The behavioural test is the second command in step 4, which asks GitHub what
rules apply to `main` rather than trusting that the POST succeeded.

Do **not** validate this by pushing a deliberately-broken commit to `main`.
That is the behaviour the plan exists to prevent, and on a repo that
auto-deploys `main` it would ship the break.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `gh api repos/:owner/:repo/rulesets --jq 'length'` returns `1` or more
- [ ] `gh api "repos/:owner/:repo/rules/branches/main" --jq '[.[].type]'` includes `required_status_checks`
- [ ] The required context matches an actual job id in `.github/workflows/ci.yml`
      (`verify`, or `typecheck` + `test` if step 3 was done)
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0
- [ ] No source file outside `.github/workflows/ci.yml` is modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `gh auth status` shows no authentication, or the token lacks the
  administration scope needed to create a ruleset. Report what is missing;
  do not attempt to work around it.
- A ruleset or branch protection rule **already exists** on `main`. Someone
  configured it between this plan being written and executed. Report what
  is there rather than overwriting it.
- The repository plan does not permit rulesets on this visibility tier and the
  API returns 403. Report it; the classic `branches/main/protection` endpoint is
  the fallback, but do not switch to it silently.
- `pnpm test` is red **before** you start. This plan assumes the suite is green
  at `74888f6`; gating on a red suite would block every merge. Report the
  failing tests instead.
- Step 3's split leaves the ruleset requiring a context name that no job
  produces. That silently blocks every merge forever, because a required check
  that never reports stays pending. Verify step 4 before finishing.

## Maintenance notes

- The required context is a **job id** from `ci.yml`, not the workflow name.
  Renaming the `verify` job without updating the ruleset makes every pull
  request hang on a check that never arrives. If you rename it, update the
  ruleset in the same change.
- Plan 011 re-arms the `pnpm audit` gate by removing `|| true`. Once that lands,
  a newly-published advisory can turn `verify` red and block merges. That is the
  intent, but it is worth knowing where the block came from.
- Plan 002 adds a `test` script to `packages/queue`, which grows `pnpm test`
  from 12 tasks to 13. No ruleset change is needed: the job name does not change.
- A reviewer should check that `enforcement` is `active` and not `evaluate`.
  `evaluate` mode reports what *would* have been blocked and blocks nothing.
