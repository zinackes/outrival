# Plan 028: Revive the dead homepage/pricing signal classes (section add/remove, price tweaks, og rebrand, over-damped heroes)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 6639163..HEAD -- packages/scrapers/src/diff packages/scrapers/src/scoring packages/ai/src/filters/significance.ts apps/workers/src/jobs/scrape-monitor.job.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **Base your branch on `origin/main` (`6639163`), NOT on `feat/shadcn-improve`.**

## Status

- **Priority**: P1
- **Effort**: M (four small independent fixes; each is S alone)
- **Risk**: MED (fix A re-enables a change class that was silently off — expect new
  section_added signals; fix B raises homepage sensitivity for busy competitors)
- **Depends on**: none (025/027 adjacent but independent)
- **Category**: bug (false silence — real changes never reach users)
- **Planned at**: commit `6639163` (origin/main), 2026-07-09

## Why this matters

The 2026-07-09 audit (`docs/audits/pipeline-audit-2026-07-09.md`, findings DIF-1/3/4/7)
found four mechanisms that silently kill exactly the signal classes the landing page
sells:

- **(A)** `section_added`/`section_removed` on homepages is **structurally
  impossible** since the #74 stability filter: confirmation requires the heading to
  be present in the snapshot where the diff required it absent. The highest-weighted
  homepage change class (a "Pricing" section appearing, weight 0.95) has emitted
  nothing since 2026-07-04.
- **(B)** The relevance recency damper counts changes across **all monitors of the
  competitor** — a competitor with an active blog (≥5 changes/week anywhere) damps
  `recency ≤ 0.5`, silencing even a full hero rewrite (score `1.0 × 0.9 × 0.5 < 0.5`)
  before classification.
- **(C)** `og:image` / `og:type` changes (the patch-32 rebrand detector) can
  mathematically never reach the 0.5 relevance threshold: they take the default 0.5
  section weight and two URLs always share tokens (`https`, domain, extension) so
  token dissimilarity < 1 → `0.5 × <1 < 0.5`, always silenced.
- **(D)** The pre-classification significance gate rejects diffs < 50 chars or < 30
  non-digit chars — **a plain numeric price change ("$99/mo → $79/mo") is never
  classified**: the change row exists, no signal is ever generated. This is the
  core product promise.

## Current state

All excerpts verified at `origin/main` = `6639163`.

- `packages/scrapers/src/diff/homepage-diff.ts`:
  - `section_added` emission (lines 203–212): a section in `curr` unmatched in
    `prev` → `{ kind: "section_added", field: "sections[<type>]", before: null, after: c.heading }`.
  - `stableSectionTransitions` (lines 380–396):
    ```ts
    if (structuresNewestFirst.length < window * 2) return { added, removed };
    const recent = sets.slice(0, window);      // indices 0..2 — index 1 IS the diff's prev
    const prior = sets.slice(window, window * 2);
    for (const k of recent[0] ?? []) {
      if (recent.every((s) => s.has(k)) && prior.every((s) => !s.has(k))) added.add(k);
    }
    ```
    The diff emits `section_added` only when the heading is absent from index 1;
    the filter confirms only when it is present in index 1 → the intersection is
    empty, always. Also: fewer than 6 stored structures → both sets empty → ALL
    section adds/removes suppressed on young monitors.
  - `filterUnstableSections` (lines 406–417) applies those sets; other kinds pass.
  - og meta emission (lines 93–98): fields `og.title`, `og.description`, `og.image`,
    `og.type` as kind `meta_changed`.
- `packages/scrapers/src/diff/__tests__/section-stability.test.ts` — the test at
  ~line 40 ("keeps section_added when the section is stably present") feeds a
  history where index 1 CONTAINS the heading while the diff input's prev lacks it —
  a state production can never produce. These tests must be rewritten, not preserved.
- `packages/scrapers/src/scoring/relevance.ts`:
  - `SECTION_WEIGHTS` (lines 21–47): `og.title`/`og.description` = 0.4; **no
    `og.image`/`og.type` entries** → default 0.5 (line 105).
  - `computeMagnitude` (lines 70–95): default branch = token dissimilarity.
  - `recency = 1 / (1 + n * 0.2)` (line 107) where `n` = caller-provided
    `previousChangesInLast7Days`.
- `apps/workers/src/jobs/scrape-monitor.job.ts` (structured homepage branch):
  - Recency count query (lines 1016–1024): joins `changes` × `monitors` on
    `monitors.competitorId = monitor.competitorId` — **competitor-global**, all
    source types.
  - Below-threshold changes are silenced with only a log (lines 1030–1041) —
    context for why these fixes matter; do not change that mechanism.
  - Significance gate call (lines 1160–1174): `evaluateSignificance({ added, removed })`
    → `worth: false` skips `classify-change` entirely (change row still recorded).
- `packages/ai/src/filters/significance.ts` (whole file, 47 lines): rule 1
  `trimmed.length < 50 → too_short`; rule 2 `significant chars (digits stripped) < 30
  → no_significant_text`. A one-line price change trips both. Header comment says
  "Conservative by design: when in doubt it returns worth: true" — the fix aligns
  the code with that stated intent for pricing.
- Tests: scrapers `cd packages/scrapers && bun test src` (exemplars:
  `src/diff/__tests__/section-stability.test.ts`, `src/scoring/__tests__/relevance.test.ts`);
  the ai package has bun tests too — check for an existing significance test with
  `find packages/ai -name "*.test.ts"` and colocate accordingly.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0 |
| Scrapers tests | `cd packages/scrapers && bun test src` | all pass, 0 fail |
| AI tests | `cd packages/ai && bun test src` | all pass (run even if 0 tests found today) |

## Scope

**In scope** (the only files you should modify/create):
- `packages/scrapers/src/diff/homepage-diff.ts` (fix A: `stableSectionTransitions` only)
- `packages/scrapers/src/diff/__tests__/section-stability.test.ts` (rewrite to production-shaped inputs)
- `packages/scrapers/src/scoring/relevance.ts` (fix C: weights + magnitude)
- `packages/scrapers/src/scoring/__tests__/relevance.test.ts` (extend)
- `packages/ai/src/filters/significance.ts` (fix D: optional sourceType-aware pass)
- `packages/ai/src/filters/significance.test.ts` or the package's existing test
  location for this module (create/extend)
- `apps/workers/src/jobs/scrape-monitor.job.ts` (fix B: recency query scope; fix D:
  pass sourceType at the call site)

**Out of scope** (do NOT touch):
- The relevance threshold value (`RELEVANCE_MIN_SCORE` / `ENRICHMENTS_RELEVANCE_MIN_SCORE`).
- `filterVolatileLines`, testimonial stability, pHash logic, the toggle-capture path
  (audit findings DIF-2/5/6/8 — deliberately deferred, see maintenance notes).
- The lexical diff itself and `computeTextDiff`.
- `classify-change.job.ts` / prompts (plan 027 territory).

## Git workflow

- Branch: `advisor/028-revive-dead-diff-classes` off `origin/main`.
- One commit per fix (A/B/C/D) — conventional commits, subject ≤ 50 chars, e.g.
  `fix(scrapers): section stability window vs diff contradiction`.
- Multi-line commit messages via `git commit -F <file>` (RTK proxy mangles multi-line `-m`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1 (fix A): Make section stability confirm what the diff can actually emit

Rewrite `stableSectionTransitions` in `packages/scrapers/src/diff/homepage-diff.ts`
with these semantics (keep name/signature; `window` default stays 3):

- `current = sets[0]` (the structure whose diff produced the changes).
- `priorAvailable = sets.slice(1, 1 + window)` (up to `window` structures, may be fewer).
- If `priorAvailable.length === 0`: return sets that make `filterUnstableSections` a
  pass-through (i.e. treat every emitted add/remove as confirmed — no history, no
  flicker evidence).
- `added`: headings present in `current` AND absent from **every** structure in
  `priorAvailable`.
- `removed`: headings absent from `current` AND present in **every** structure in
  `priorAvailable`.

This kills flicker (a heading seen in any recent prior structure fails the
all-absent test) while letting a genuine new section pass on its first appearance.
Update the function's doc comment to describe the new semantics.

**Verify**: `cd packages/scrapers && bun test src/diff` → see step 2 (tests must be
rewritten in the same commit; the old ones encode the impossible state).

### Step 2 (fix A): Rewrite the stability tests with production-shaped inputs

In `section-stability.test.ts`, every case must satisfy the production invariant:
`structuresNewestFirst[0]` = current structure, `structuresNewestFirst[1]` = the
structure the diff ran against (so a tested `section_added` heading must be ABSENT
from index 1). Cases:

1. Genuine add: heading in [0] only, absent in [1..3] → **kept** (this is the case
   that has been impossible since #74 — it is the regression test for the bug).
2. Flicker: heading present in [2], absent in [1], present in [0] → suppressed.
3. Genuine remove: heading in [1..3], absent in [0] → kept.
4. Flickering remove: heading absent in [2] → suppressed.
5. Short history (only [0] and [1]): genuine add kept (pass-through/available-prior
   confirmation), matching step 1's semantics.
6. Other change kinds always pass through untouched.

Also run the neighbouring `homepage-diff.test.ts` — its `section_added` cases
(lines ~66 and ~129) must still pass unmodified.

**Verify**: `cd packages/scrapers && bun test src/diff` → all pass, 0 fail.

### Step 3 (fix B): Scope the recency damper to the monitor, not the competitor

In `apps/workers/src/jobs/scrape-monitor.job.ts` (lines 1016–1024), change the count
query to this monitor only — drop the join:

```ts
const recentChangeCount = await db
  .select({ value: count() })
  .from(changes)
  .where(and(eq(changes.monitorId, monitor.id), gte(changes.detectedAt, sevenDaysAgo)));
```

Remove the now-unused `monitors` join import only if nothing else in the file uses
it (it does — leave imports alone). Update the comment above the query: the damper
targets a *churning homepage*, not a competitor active elsewhere (a busy blog must
not silence a hero rewrite — audit DIF-3).

**Verify**: `pnpm typecheck` → exit 0, and
`sed -n '1012,1030p' apps/workers/src/jobs/scrape-monitor.job.ts` shows no
`innerJoin` in the recency query.

### Step 4 (fix C): Give og rebrand fields a real weight and magnitude

In `packages/scrapers/src/scoring/relevance.ts`:

1. Add to `SECTION_WEIGHTS`: `"og.image": 0.8, "og.type": 0.7` (rebrand tells —
   audit DIF-4; `og.title`/`og.description` keep 0.4).
2. In `computeMagnitude`, before the default dissimilarity branch, add: for
   `change.field === "og.image"` or `"og.type"`, return `change.before === change.after ? 0 : 1`
   — URL/token overlap is meaningless for asset URLs; any actual change is a full
   signal. (Key on `field`, not `kind` — `meta_changed` also covers meta.title etc.
   which must keep dissimilarity.)

Extend `src/scoring/__tests__/relevance.test.ts`: an `og.image` change between two
same-domain URLs (e.g. `https://x.com/og-v1.png` → `https://x.com/og-v2.png`) with
`previousChangesInLast7Days: 0` scores ≥ 0.5; an unchanged og.image scores 0.

**Verify**: `cd packages/scrapers && bun test src/scoring` → all pass, incl. the new cases.

### Step 5 (fix D): Price-bearing pricing diffs always reach classification

1. `packages/ai/src/filters/significance.ts` — extend the signature:
   `evaluateSignificance(diff: DiffInput, context?: { sourceType?: string })`.
   Before rule 1, add:
   ```ts
   // A pricing-page diff that contains an actual price token is ALWAYS worth
   // classifying, however short — "$99/mo → $79/mo" is the product's core promise
   // (audit DIF-7). Mirrors the price-token heuristic used by the severity guard.
   const PRICE_TOKEN = /[€$£¥]\s?\d|\d\s?(€|\$|usd|eur|gbp)|\/\s?(mo|month|yr|year|an)\b/i;
   if (context?.sourceType === "pricing" && PRICE_TOKEN.test(combined)) {
     return { worth: true };
   }
   ```
   (Optional param — every existing caller stays source-compatible.)
2. Call site `apps/workers/src/jobs/scrape-monitor.job.ts:1161`: pass
   `{ sourceType: monitor.sourceType }` as the second argument.
3. Tests (colocate with the package's test convention — check
   `find packages/ai -name "*.test.ts"` first; if the package has no test setup,
   put the test in `packages/ai/src/filters/significance.test.ts` and confirm
   `cd packages/ai && bun test src` picks it up):
   - `{ added: "2,49 €per month", removed: "1,99 €per month" }` + sourceType
     `pricing` → `worth: true` (this exact shape was rejected as `too_short` before).
   - Same diff WITHOUT sourceType → still `worth: false` (non-pricing behavior unchanged).
   - A timestamps-only diff WITH sourceType `pricing` but no price token → still rejected.

**Verify**: `cd packages/ai && bun test src` → all pass · `pnpm typecheck` → exit 0.

### Step 6: Full verification

**Verify**: `pnpm typecheck` → exit 0 · `cd packages/scrapers && bun test src` →
all pass · `cd packages/ai && bun test src` → all pass.

## Test plan

Steps 2, 4, 5 — each fix carries its own regression tests, including one test per
fix that encodes the previously-impossible/killed case (genuine section add kept;
og.image ≥ 0.5; short price diff classified on pricing).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `cd packages/scrapers && bun test src` exits 0 (incl. rewritten stability tests + og cases)
- [ ] `cd packages/ai && bun test src` exits 0 (incl. ≥ 3 new significance cases)
- [ ] `grep -n "window \* 2" packages/scrapers/src/diff/homepage-diff.ts` → 0 matches
- [ ] `grep -n "innerJoin" apps/workers/src/jobs/scrape-monitor.job.ts` → the recency query (formerly lines 1016–1024) no longer joins monitors
- [ ] `grep -n "og.image" packages/scrapers/src/scoring/relevance.ts` → weight + magnitude entries present
- [ ] `grep -n "sourceType" packages/ai/src/filters/significance.ts` → optional context param present
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `stableSectionTransitions` / `filterUnstableSections` have changed since `6639163`
  (someone may have fixed DIF-1 differently — reconcile, don't stack).
- `homepage-diff.test.ts`'s existing section_added tests fail after fix A in a way
  that requires changing THOSE tests — they encode the 2-snapshot diff contract,
  which this plan must not alter.
- The worker call site for `evaluateSignificance` doesn't have `monitor.sourceType`
  in scope.
- Any fix requires touching the relevance threshold or the silencing mechanism itself.

## Maintenance notes

- **Expect new signal volume** after fix A + B land: section adds/removes resume and
  busy competitors' homepage changes stop being damped. Watch the feed for a week;
  if noise returns, the lever is the stability `window` (3) and per-field weights —
  not re-breaking the filter.
- Deferred siblings from the same audit (do NOT fold into this plan): DIF-5 (pHash
  blocked by hash-identical early return), DIF-6 (annual-only price changes
  invisible — hidden toggle block stripped from hash), DIF-8 (A/B hero flip-flop
  learning), DIF-2 (testimonial exact-window). Each needs its own design pass.
- The `PRICE_TOKEN` regex now exists in two packages (here and plan 027's severity
  guard in `apps/workers`). Deliberate duplication — `packages/ai` must not import
  from `apps/workers`. If a third copy appears, move it to `@outrival/shared`.
- Reviewer focus: fix A's semantics on short history (pass-through) — confirm the
  team accepts day-1 section signals with only one prior structure as evidence.
