# Plan 001: `overtaken` AI-visibility signal only fires when a competitor actually gains ground

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 81c4b75..HEAD -- apps/workers/src/lib/ai-visibility/diff.ts apps/workers/test/ai-visibility-diff.test.ts`
> If either in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `81c4b75`, 2026-07-07

## Why this matters

AI Visibility ("Share of Model") is a headline premium feature: it tells a user
when a competitor overtakes them in AI-engine answers, and emits a **HIGH-severity
signal** that can email/Slack the customer. The current `overtaken` predicate fires
whenever the competitor ends up above the self product — even when the competitor
*declined* and only appears ahead because the user's own share collapsed. The
result is a wrong, high-severity alert ("X overtook your product") when the real
story is the user's own decline. This erodes trust in the exact signal the feature
exists to deliver. The fix requires the competitor to have actually gained ground.

## Current state

- `apps/workers/src/lib/ai-visibility/diff.ts` — pure share-of-voice diff. `computeDeltas()`
  compares the previous run to the current one and emits `self_dropped` / `overtaken` /
  `competitor_appeared` deltas. This is the only file with the bug.
- `apps/workers/src/jobs/scrape-ai-visibility.job.ts` — calls `computeDeltas(...)` and turns
  each delta into a signal (`emitVisibilitySignals` / `deltaCopy`). **Out of scope** — the
  emit/copy is correct; only the predicate that produces the delta is wrong.
- `apps/workers/test/ai-visibility-diff.test.ts` — existing pure unit tests for `computeDeltas`,
  using `bun:test`. New tests go here; match its exact style.

The buggy predicate (`diff.ts`, lines ~106–151):

```ts
    const selfAfter = sovOf(currEng, selfId);
    const selfBefore = sovOf(prevEng, selfId);

    if (selfId && selfBefore > 0 && selfAfter === 0) {
      deltas.push({ type: "self_dropped", /* ... */ severity: "high" });
    }

    for (const [cid, cAgg] of currEng.subjects) {
      if (cid === selfId) continue;
      const after = cAgg.sov;
      const before = sovOf(prevEng, cid);
      const overtook = selfId !== null && before <= selfBefore && after > selfAfter; // BUG: no "competitor rose" check
      const appeared = before === 0 && after > 0;
      if (overtook) {
        deltas.push({ type: "overtaken", /* ... */ severity: "high" });
      } else if (appeared) {
        deltas.push({ type: "competitor_appeared", /* ... */ severity: "medium" });
      }
    }
```

Failure case: prev `self`=0.8, `c1`=0.6 → curr `self`=0.1, `c1`=0.3. `before(0.6) <= selfBefore(0.8)`
and `after(0.3) > selfAfter(0.1)` are both true, so `overtook` is true and a HIGH "c1 overtook you"
signal fires — even though **c1 declined** (0.6→0.3). Meanwhile `self_dropped` does not fire because
it requires `selfAfter === 0` exactly (self is 0.1, not 0). The competitor never rose; the user fell.

Repo test convention (from `apps/workers/test/ai-visibility-diff.test.ts`):
- `bun:test` (`import { describe, expect, test } from "bun:test";`).
- Fixtures built with the `run({ subjectId: ["p1"] })` helper (2 prompts `p1`,`p2`; a subject's
  SoV = mentions / 2, so values are 0, 0.5, 1.0).
- `deltas(prev, curr, self="self")` wraps `computeDeltas(aggregate(prev), aggregate(curr), self)`.

## Commands you will need

| Purpose            | Command                                              | Expected on success       |
|--------------------|------------------------------------------------------|---------------------------|
| Typecheck workers  | `pnpm --filter @outrival/workers typecheck`          | exit 0, no errors         |
| Workers unit tests | `pnpm --filter @outrival/workers test`               | all pass (incl. new)      |
| Run just this file | `cd apps/workers && bun test test/ai-visibility-diff.test.ts` | all pass          |

(No `pnpm install` needed — dependencies are already installed. Do NOT run `next build` / full `pnpm build`; this repo's dev VM OOMs on it and it is unnecessary here.)

## Scope

**In scope** (the only files you should modify):
- `apps/workers/src/lib/ai-visibility/diff.ts`
- `apps/workers/test/ai-visibility-diff.test.ts`

**Out of scope** (do NOT touch):
- `apps/workers/src/jobs/scrape-ai-visibility.job.ts` — the signal emit/copy is correct.
- The `self_dropped` `=== 0` threshold. Broadening it (fire on a large self *drop*, not only to
  exactly 0) is a real follow-up but a **separate** behavior change — do not bundle it here.
- Any other delta type or the `minPrompts` gate.

## Git workflow

- Branch: `advisor/001-ai-visibility-overtaken`
- One commit; conventional-commit style (matches `git log`, e.g. `fix(ai-visibility): …`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Require the competitor to have gained ground for an `overtaken` delta

In `apps/workers/src/lib/ai-visibility/diff.ts`, change the `overtook` definition (the line
currently reading `const overtook = selfId !== null && before <= selfBefore && after > selfAfter;`)
to also require the competitor's own SoV to have risen:

```ts
    // An "overtake" means the competitor GAINED ground and passed the self product
    // (before at/below self, now above it, AND its own SoV rose). Without the
    // `after > before` clause, a competitor that merely appears ahead because the
    // self product collapsed — while the competitor itself declined — would wrongly
    // fire a HIGH "overtaken" signal; that case is a self decline, not an overtake.
    const overtook =
      selfId !== null && before <= selfBefore && after > selfAfter && after > before;
```

Leave `self_dropped`, `appeared`, and everything else untouched.

**Verify**: `pnpm --filter @outrival/workers typecheck` → exit 0.

### Step 2: Add regression tests for the false positive

In `apps/workers/test/ai-visibility-diff.test.ts`, inside the existing
`describe("computeDeltas — AI visibility shifts", …)` block, add these tests. The first
fails before Step 1 and passes after; the rest guard against over-correction.

```ts
  test("competitor flat while self collapses → no overtaken (self-decline, not an overtake)", () => {
    // self 1.0 → 0.5 (fell, but not to 0 → self_dropped does NOT fire), c1 flat at 1.0.
    // Pre-fix this wrongly emitted a HIGH "c1 overtook you"; c1 never gained ground.
    const prev = run({ self: ["p1", "p2"], c1: ["p1", "p2"] });
    const curr = run({ self: ["p1"], c1: ["p1", "p2"] });
    expect(deltas(prev, curr)).toEqual([]);
  });

  test("competitor genuinely rises above self → overtaken still fires (no over-correction)", () => {
    const prev = run({ self: ["p1", "p2"], c1: ["p1"] }); // self 1.0 >= c1 0.5
    const curr = run({ self: ["p1"], c1: ["p1", "p2"] }); // c1 0.5 → 1.0 (rose) > self 0.5
    const d = deltas(prev, curr);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ type: "overtaken", competitorId: "c1", severity: "high" });
  });
```

Do not modify the existing `"competitor overtakes self → one overtaken"` test — it must stay green.

**Verify**: `cd apps/workers && bun test test/ai-visibility-diff.test.ts` → all pass, including the
two new tests. Then `pnpm --filter @outrival/workers test` → all pass.

### Step 3: Confirm the fix is causal (optional sanity check)

Temporarily revert only the Step 1 change (git stash the diff.ts hunk), re-run
`bun test test/ai-visibility-diff.test.ts`, and confirm the first new test now **fails**
(proving it catches the bug), then restore the fix.

**Verify**: with the fix reverted the new "flat while self collapses" test fails; with the fix
restored it passes. (If it passes even without the fix, the test is not exercising the bug — STOP.)

## Test plan

- New tests in `apps/workers/test/ai-visibility-diff.test.ts`:
  - Happy-path regression: competitor flat while self collapses (not to 0) → `[]`.
  - Guard against over-correction: a genuine rise above self still emits `overtaken`.
- Structural pattern to follow: the existing tests in the same file (`run()` fixtures, `deltas()` helper).
- Verification: `pnpm --filter @outrival/workers test` → all pass, 2 new tests green.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm --filter @outrival/workers typecheck` exits 0.
- [ ] `pnpm --filter @outrival/workers test` exits 0; the 2 new tests exist and pass.
- [ ] `grep -n "after > before" apps/workers/src/lib/ai-visibility/diff.ts` returns the `overtook` line.
- [ ] `git status --porcelain` shows only the two in-scope files modified.
- [ ] `plans/README.md` status row for 001 updated.

## STOP conditions

Stop and report back (do not improvise) if:

- The `overtook` line in `diff.ts` does not match the "Current state" excerpt (the file drifted).
- The new "flat while self collapses" test passes even with the Step 1 change reverted (the test
  isn't exercising the bug — the fixtures or `aggregate`/`sovOf` semantics differ from assumptions).
- Typecheck fails and the cause is anything other than an obvious typo in your edit.

## Maintenance notes

- **Deferred, related**: `self_dropped` only fires when the self product's SoV hits exactly 0.
  A large-but-nonzero self drop (e.g. 0.8→0.1) currently emits nothing after this fix. If the team
  wants that surfaced, add a `self_declined` delta (threshold on `selfBefore - selfAfter`) — that's a
  new signal type and product decision, out of scope here.
- A reviewer should confirm the `overtaken` copy in `scrape-ai-visibility.job.ts` (`deltaCopy`) still
  reads correctly given the tightened predicate — it should, since it only renders genuine overtakes now.
