# Plan 017: Measure the faithfulness gate's false-block rate, then decide whether to turn it on

> **Executor instructions**: This is a **spike**, not a build. Its deliverable is
> a measurement and a written recommendation, not a shipped feature. Do NOT flip
> the production flag as part of it. Run every verification command listed. When
> done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 74888f6..HEAD -- packages/ai/src/faithfulness apps/workers/src/lib/faithfulness-gate.ts`
> If any changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P2
- **Effort**: M (mostly measurement and analysis, little code)
- **Risk**: LOW as a spike. The change it might recommend is MED.
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `74888f6`, 2026-07-25

## Why this matters

A complete claim-level verification subsystem exists in this repository: claim
extraction, fuzzy scoring, a binary judge, a gate, four test files, a persisted
`faithfulness` column, and full wiring into the weekly digest so it can withhold
a send. It is switched off. `FAITHFULNESS_GATE_ENABLED` defaults to `false`, and
`packages/ai/src/faithfulness/gate.ts:25` requires the literal string `"true"`,
so the entire chain is inert today.

Two costs run in parallel. An AI feature that was built, tested and evaluated
produces zero value. And the product's stated design principle 4 in `PRODUCT.md`
("Earned expert confidence. Back every insight with its evidence. Trust is built
by showing the work, not by adjectives") has no mechanism behind it: the gate is
the only thing in the codebase that can assert an output's claims trace to a
source.

The reason it is off is good and should be respected. `docs/architecture.md`
states the activation condition explicitly: enable only where the provider pool
is healthy **and** `eval:faithfulness` has passed, because the judge's
false-block rate is a property of the *model*, not the code. A false block means
a critical alert is silently withheld, so the bar is correctly high.

So the missing artifact is not code. It is a measurement. This spike produces it.

## Current state

### The flag (`.env.example:368`)

```
FAITHFULNESS_GATE_ENABLED=false
```

### The strict check (`packages/ai/src/faithfulness/gate.ts:25`)

```ts
  return process.env.FAITHFULNESS_GATE_ENABLED === "true";
```

Anything other than the exact string `"true"` leaves the chain inert.

### The worker-side short circuit (`apps/workers/src/lib/faithfulness-gate.ts:43, 52`)

```
 * (FAITHFULNESS_GATE_ENABLED=false) — callers then publish exactly as before.
```

Returns `null` immediately when disabled, so there is zero added AI cost today.

### The subsystem is complete, not a stub

`packages/ai/src/faithfulness/` contains `extract-claims.ts`, `score-claims.ts`,
`judge-claim.ts`, `verify.ts`, `gate.ts` plus four test files. The persisted
column lives on `packages/db/src/schema/ai-quality-checks.ts:55-60`.
`apps/workers/src/core/generate-weekly-digest.ts:241-359` is wired to withhold a
send on a blocked verdict.

The design fails **open** by construction: a parse miss, a rate limit or an open
circuit breaker yields `skipped` and publishes. Several existing tests assert
exactly that, and they are the reason the risk of enabling is bounded.

### Scope of what the gate covers

Battle cards, weekly digests, and `critical` / `high` signal insights. Not
`medium` / `low` (cost), not Ask (already grounded two-pass).

### The eval exists

`packages/ai/package.json:21` defines `eval:faithfulness`.
`docs/architecture.md:1227-1229` records a previous run: all inventions
rejected, at least 80% of paraphrases kept.

### The only consumers of the verdict are admin-only

`apps/web/src/app/(admin)/admin/ai-review-queue/view.tsx:73` and `page.tsx:33`.
Nothing customer-facing mentions verification.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| AI tests | `cd packages/ai && bun test` | all pass |
| The eval | `pnpm --filter @outrival/ai eval:faithfulness` | prints a labelled report |
| Typecheck | `pnpm typecheck` | exit 0 |
| Whole suite | `pnpm test` | exit 0 |

**The eval makes real provider calls and costs money.** Run it once,
deliberately, and record the output. Do not loop it.

Note: `turbo` is **not** on `PATH`. Use the `pnpm` scripts.

## Scope

**In scope**:
- Running `eval:faithfulness` and recording its output
- Reading the gate chain to document exactly what is blocked and what fails open
- `docs/faithfulness-rollout.md` (create: the measurement, the recommendation,
  the rollback procedure)
- Optionally extending the labelled eval set with cases drawn from real
  production outputs, if you can get them without exporting customer data

**Out of scope** (do NOT do these):
- **Flipping `FAITHFULNESS_GATE_ENABLED` in any deployed environment.** That is
  the operator's decision, informed by this spike. The spike does not ship it.
- Changing `FAITHFULNESS_MIN_RATIO`, the claim extractor, the judge prompt, or
  the model tier used by either.
- Building the customer-facing "claims traced to source" badge. It is a good idea
  and it depends on this decision; it is a separate piece of work.
- Widening the gate's scope to `medium` / `low` severity.
- Changing the fail-open behaviour. It is the property that bounds the risk.

## Git workflow

- Branch: `docs/faithfulness-rollout-spike` off `main`.
- Commit message style, matching `git log`: `docs: measure the faithfulness gate`.
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Confirm the gate is genuinely inert today

```bash
grep -n "FAITHFULNESS_GATE_ENABLED" .env.example packages/ai/src/faithfulness/gate.ts apps/workers/src/lib/faithfulness-gate.ts
```

**Verify**: the default is `false`, the check is `=== "true"`, and the worker
helper short-circuits. Note that you can only see repository defaults: a
deployed environment could already have it on. State that limit in your report.

### Step 2: Document exactly what a block does, per output type

Read the three call paths and write down, for each, what happens on a `blocked`
verdict. Be precise: this is what the operator is deciding about.

- **Weekly digest** (`apps/workers/src/core/generate-weekly-digest.ts:241-359`):
  stored with its report, `sent_at` stays null, no email.
- **Battle card**: the card is not written; the previous one survives.
- **Signal insight** (`critical` / `high`): the signal row **is** inserted and
  stays readable in-app, but is never dispatched
  (`dispatched_channel = in_app_only`, `filtered_reason = faithfulness_blocked`).

Also document every path that fails **open**, with its `file:line`. That list is
the risk mitigation and the operator should see it.

**Verify**: your document names each output type, what a block withholds, and
what the user still sees.

### Step 3: Run the eval and record the numbers

```bash
pnpm --filter @outrival/ai eval:faithfulness
```

Record verbatim: the pass rate on inventions (must be rejected), the pass rate on
legitimate paraphrases (must be kept), the sample size, the model and provider
that served it, and the date.

The paraphrase number is the one that matters. It is the false-block rate, and a
false block on a `critical` insight means an alert the customer needed was
silently withheld.

**Verify**: the eval completed and you have its output pasted into the document.
If it errors (provider down, quota exhausted), record that and STOP: an
unmeasured judge is exactly what the architecture doc says not to enable.

### Step 4: Estimate the blast radius

Using the eval's false-block rate and whatever volume figures you can get for
`critical` / `high` insights and weekly digests, estimate how many outputs per
week would be withheld in error.

If you cannot get production volumes, say so and express the estimate as a rate
("at a 10% false-block rate, one in ten critical alerts would be withheld"). Do
not invent volume numbers.

**Verify**: the document contains an explicit statement of expected false blocks,
with its assumptions named.

### Step 5: Write the rollout and rollback procedure

In `docs/faithfulness-rollout.md`, write:

- **The recommendation**: enable, do not enable, or enable for a narrower scope
  (for example digests and battle cards only, leaving `critical` insights
  unblocked until the false-block rate is measured in production).
- **The rollout**: which environment first, what to watch (`/admin/ai-review-queue`
  false-block rate), for how long, and the numeric threshold that would trigger a
  rollback.
- **The rollback**: setting the flag to anything other than `"true"` restores the
  previous behaviour immediately, with no data migration and no code change,
  because the check is a strict string comparison. Confirm this claim against
  `gate.ts:25` and state it plainly. It is the single most reassuring fact about
  this decision.
- **The residual risk**: this is a single-sample judge. The multi-sampling option
  is noted in `faithfulness/verify.ts` as a future possibility, to be decided on
  the observed false-block rate.

**Verify**: the document is written, in English, and a reader who has not seen
this codebase could act on it.

### Step 6: Confirm nothing changed

**Verify**: `git diff --name-only` lists only `docs/faithfulness-rollout.md`.
`pnpm typecheck` exits 0 and `pnpm test` exits 0 (unchanged by a docs-only
change; run them to confirm you did not touch code by accident).

## Test plan

No new tests. The existing suite already covers the property the operator needs
to trust:

```
cd packages/ai && bun test
```

`packages/ai/src/faithfulness/gate.test.ts` and its siblings already assert the
fail-open behaviour on a parse miss, an unavailable judge and a thrown judge,
and that the disabled gate never blocks. Confirm those pass and cite them in the
document: they are the evidence that enabling cannot cause a total outage.

The measurement in step 3 is the real deliverable.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `docs/faithfulness-rollout.md` exists and contains: the eval output with its
      date, model and provider; the per-output-type block behaviour; the
      fail-open path list; the false-block estimate; a recommendation; a rollout
      plan with a numeric rollback threshold; the rollback procedure
- [ ] `git diff --name-only` lists only that one file
- [ ] `grep -rn "FAITHFULNESS_GATE_ENABLED=true" .env.example` returns nothing
      (the repository default is untouched)
- [ ] `cd packages/ai && bun test` exits 0
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `eval:faithfulness` cannot run (no provider key, exhausted quota, breaker
  open). The whole point of this spike is the measurement; a recommendation
  without it would repeat the mistake the architecture doc warns against.
- The eval's paraphrase-retention rate is materially worse than the ~80%
  recorded in `docs/architecture.md:1227-1229`. That is a finding in itself: the
  judge model's behaviour has drifted, and the answer is probably "do not enable
  yet", not "enable and watch".
- You are asked, or tempted, to flip the flag in a deployed environment. Out of
  scope. The spike informs the decision; it does not make it.
- You find the gate is **already enabled** in a deployed environment. Then the
  question changes entirely, from "should we" to "what has it been blocking".
  Report it and pivot to reading `/admin/ai-review-queue`.
- Extending the eval set would require exporting real customer content out of
  production. Do not. Use synthetic or already-public examples.

## Maintenance notes

- **The rollback is genuinely one environment variable.** `gate.ts:25` compares
  against the exact string `"true"`, so any other value disables the chain with
  no code change and no data migration. That asymmetry is what makes a cautious
  production trial reasonable.
- **If the recommendation is to enable**, the natural follow-up is the
  customer-facing surface: the verdict is already persisted on
  `ai_quality_checks.faithfulness` and read only by admins today. Rendering a
  plain "claims traced to source" state on digests and battle cards needs no new
  table and no new AI call, and it is what turns a safety valve into the
  `PRODUCT.md` principle-4 differentiator.
- **The narrow-scope option is underrated.** Enabling for digests and battle
  cards (where a withheld output is recoverable and visible) while leaving
  `critical` insights unblocked gets most of the value with almost none of the
  risk, and produces real production data on the false-block rate before it sits
  between an urgent alert and its recipient.
- A reviewer of the eventual enablement should insist on the false-block number,
  not just the invention-rejection number. Rejecting inventions is the easy half.
