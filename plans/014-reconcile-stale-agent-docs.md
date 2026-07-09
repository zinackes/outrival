# Plan 014: Reconcile agent-facing docs that describe removed/superseded systems as live

> **Executor instructions**: Follow this plan step by step. Confirm each verification.
> If anything in "STOP conditions" occurs, stop and report. When done, update this plan's
> row in `plans/README.md` unless a reviewer maintains the index. This plan edits **docs
> and instruction files only** — no source code.
>
> **Drift check (run first)**:
> `git diff --stat 81c4b75..HEAD -- apps/workers/CLAUDE.md packages/scrapers/CLAUDE.md .claude/rules docs/architecture.md docs/deployment.md`
> If any changed, re-read them before editing; on a surprising mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `81c4b75`, 2026-07-07

## Why this matters

Several instruction files that are **auto-loaded into agent sessions as project context**
tell an executor to build against technology that has been removed, or describe a
job-execution model that contradicts the actual deploy setup. An agent following them
writes against a dead API or forms the wrong mental model of how jobs run. Actively-wrong
docs are worse than missing ones — and these are the load-bearing ones.

## Current state (the wrong statements)

1. **`apps/workers/CLAUDE.md`** header: *"# @outrival/workers — Crawlee + Trigger.dev v3 /
   Stack : Trigger.dev v3, Crawlee, Bun"*, and instructs *"Lire crawlee-patterns skill
   avant de créer un scraper"*. **Crawlee is not a dependency of any package** (0 hits for
   `"crawlee"` across all `package.json`); scrapers use `patchright`/`camoufox-js`/`cheerio`.
   The Trigger SDK is v4 (`@trigger.dev/sdk@^4.4.6`), not v3.

2. **`packages/scrapers/CLAUDE.md`**: *"Lire @.claude/skills/crawlee-patterns/SKILL.md avant
   toute modification"* and *"Sources disponibles: homepage | pricing | blog | changelog |
   jobs | g2_reviews | capterra_reviews"* (stale — many more sources exist now: jobs ATS,
   reviews platforms, sitemap, news, status, tech_stack, reddit…). Points at Crawlee.

3. **`.claude/rules/monorepo.md:17`**: *"apps/workers → @outrival/workers (Crawlee +
   Trigger.dev)"* — Crawlee reference.

4. **`.claude/rules/scraping.md`**: references the Crawlee-era workflow in places (verify
   and correct any "Crawlee" mention; the cascade is Patchright/Camoufox per the file's own
   later content — reconcile the header/intro with the body).

5. **`docs/deployment.md:8-22`** ("Topology (decided)") states *"Jobs run on Trigger.dev v4
   Cloud … There is no 'workers' service on the VPS … Jobs ship via `trigger deploy`"* —
   but `apps/workers/Dockerfile.queue-light` and `Dockerfile.queue-browser` exist and deploy
   pg-boss worker services (`apps/workers/src/queue/worker.ts`, `WORKER_ROLE=browser|light`),
   and `docs/trigger-to-pgboss-migration.md` documents a mid-migration to pg-boss.
   `docs/architecture.md` itself is internally inconsistent: the Stack table says
   "Trigger.dev v4 Cloud" and the infra diagram says workers are "dev only", yet its env
   section documents `QUEUE_DATABASE_URL` + pg-boss.

6. **Host name drift**: `docs/deployment.md:1` says "OVH VPS"; `docs/architecture.md`
   Infrastructure section says "Hetzner VPS". One is wrong.

**Do NOT treat as findings** (leave alone): the ClickHouse mentions in
`analytics-safe.ts` / `analytics.ts` / `schema/analytics.ts` comments are explanatory
migration history ("was ClickHouse"), not instructions — fine as-is.

## Ground truth to write toward (verify before asserting)

- Scraping stack = Patchright cascade (L0 fetch → L1 Patchright → L2 datacenter → L3
  residential → L4 Camoufox) + Camoufox last resort. No Crawlee.
- Trigger SDK = **v4** (`@trigger.dev/sdk@^4.4.6`). Jobs are authored as Trigger `task()`.
- Job **execution** is mid-migration to pg-boss (`packages/queue`, `apps/workers/src/queue/`,
  the two `Dockerfile.queue-*`). The exact live-runner state should be stated as
  "migration in progress" rather than asserted as fully cut over — cite
  `docs/trigger-to-pgboss-migration.md` as the source of record.
- **You cannot run the deploy to confirm which runner is live today.** Where uncertain,
  describe both the authored form (Trigger `task()`) and the target execution (pg-boss
  workers) and point to the migration doc — do not invent a definitive claim.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Confirm Crawlee absent | `grep -rn '"crawlee"' apps packages` | no matches |
| Confirm Trigger SDK major | `grep -rn '"@trigger.dev/sdk"' apps/workers/package.json` | `^4.x` |
| No source touched | `git status` | only `.md` files changed |

(No typecheck/test needed — docs only. But run `git status` at the end to confirm no code
changed.)

## Scope

**In scope** (docs/instruction files only):
- `apps/workers/CLAUDE.md`
- `packages/scrapers/CLAUDE.md`
- `.claude/rules/monorepo.md`
- `.claude/rules/scraping.md` (only Crawlee-era mentions that contradict the cascade)
- `docs/deployment.md` (Topology section + host name)
- `docs/architecture.md` (Stack table + Infra diagram job-runner lines + host name;
  reconcile with its own env section)

**Out of scope**:
- Any `.ts`/`.tsx`/config source file. In particular do NOT delete the `"crawlee"` entry
  from `apps/workers/trigger.config.ts` externals here — that's a harmless code cleanup for
  a code plan, not this docs plan.
- The `crawlee-patterns` / `add-monitor-source` skill files themselves (rewriting a skill is
  a larger task; instead, remove the *pointers* to `crawlee-patterns` from the CLAUDE.md
  files so agents stop being told to read it. Note the skill as stale in Maintenance.)
- ClickHouse historical comments in source (leave).
- The pg-boss migration itself (that's direction plan 018-adjacent / a separate effort).

## Git workflow

- Branch: `advisor/014-reconcile-agent-docs`
- One commit, conventional: `docs: fix agent-facing stack/runner descriptions`.
- Do NOT push unless instructed.

## Steps

### Step 1: Fix the workers + scrapers CLAUDE.md files

- `apps/workers/CLAUDE.md`: change the stack line to reflect Bun + Trigger.dev **v4**
  (jobs authored as `task()`) with execution migrating to pg-boss (`@outrival/queue`); cite
  `docs/trigger-to-pgboss-migration.md`. Remove the "Lire crawlee-patterns" instruction.
- `packages/scrapers/CLAUDE.md`: remove the "Lire crawlee-patterns" pointer; describe the
  Patchright cascade (point to `.claude/rules/scraping.md` as the detail source); update or
  generalize the stale "Sources disponibles" list (point to the `source_type` enum in
  `docs/architecture.md` as the source of truth rather than hard-listing 7).

**Verify**: `grep -rn "crawlee" apps/workers/CLAUDE.md packages/scrapers/CLAUDE.md` → no matches.

### Step 2: Fix the rules files

- `.claude/rules/monorepo.md:17`: change "Crawlee + Trigger.dev" to "Trigger.dev v4 jobs
  (execution migrating to pg-boss) + Patchright scrapers" (or similar accurate phrasing).
- `.claude/rules/scraping.md`: reconcile any Crawlee-era mention with the cascade the file
  already documents further down.

**Verify**: `grep -rn -i "crawlee" .claude/rules` → no matches (or only in a deliberate
"replaced Crawlee with…" historical note you chose to keep).

### Step 3: Reconcile the deployment + architecture topology

- `docs/deployment.md` Topology: replace "no workers service on the VPS / Trigger Cloud
  only" with the accurate state — jobs authored as Trigger `task()`, execution migrating to
  self-hosted pg-boss workers (`Dockerfile.queue-light` / `Dockerfile.queue-browser`,
  `WORKER_ROLE`, `QUEUE_DATABASE_URL`); mark it "migration in progress" and link
  `docs/trigger-to-pgboss-migration.md`. Add the two worker services + `QUEUE_DATABASE_URL`
  to the deploy matrix.
- `docs/architecture.md`: make the Stack table's "Jobs" row and the Infra diagram's workers
  line consistent with the above and with the doc's own env section (which already lists
  `QUEUE_DATABASE_URL`).
- Fix the OVH vs Hetzner host-name discrepancy — pick the correct one (verify against the
  deployment runbook / any other authoritative reference in the repo; if genuinely
  unresolvable from the repo, flag it rather than guessing — see STOP).

**Verify**: `git status` shows only `.md` files changed; re-read the edited Topology section
and confirm it no longer says "no workers service on the VPS".

## Test plan

- Docs only — no automated test. Verification is the greps above + a read-through that the
  edited sections are internally consistent (no remaining self-contradiction between the
  Stack table, the Infra diagram, and the env section in `architecture.md`).

## Done criteria

ALL must hold:

- [ ] `grep -rn -i "crawlee" apps/workers/CLAUDE.md packages/scrapers/CLAUDE.md .claude/rules`
      returns no live-instruction matches
- [ ] `apps/workers/CLAUDE.md` says Trigger v4 (not v3) and drops the crawlee-patterns pointer
- [ ] `docs/deployment.md` Topology + `docs/architecture.md` Stack/Infra agree on the
      Trigger-authored / pg-boss-executing (migration-in-progress) model
- [ ] OVH/Hetzner host name is consistent across both docs
- [ ] `git status` shows only `.md` files changed (no source)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- You cannot determine from the repo whether the live prod runner is Trigger Cloud or
  pg-boss today — describe both (authored vs target) and cite the migration doc; do NOT
  assert one as live. Flag the ambiguity in the PR description.
- The OVH vs Hetzner discrepancy can't be resolved from any authoritative file in the repo —
  leave a clearly-marked `TODO(verify host)` and report it rather than guessing.
- Editing a rules file would contradict another rules file you didn't expect — report the
  conflict.

## Maintenance notes

- The `crawlee-patterns` skill is now stale (points at removed tech). A follow-up should
  either rewrite it for the Patchright cascade or retire it; this plan only stops the
  CLAUDE.md files from pointing agents at it.
- Once the pg-boss cutover completes (separate effort), revisit these docs to drop the
  "migration in progress" hedging and state pg-boss as the runner.
- Reviewer should confirm no source/config file was edited (this is a docs-only plan) and
  that `architecture.md` is now internally consistent.
