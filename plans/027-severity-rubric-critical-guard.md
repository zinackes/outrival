# Plan 027: Severity is defined by a rubric, "critical" is deterministically guarded, and a flaky insight no longer drops a significant change

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 6639163..HEAD -- packages/ai/src/tasks/classify.ts packages/ai/src/tasks/classify-structured.ts apps/workers/src/jobs/generate-signal.job.ts apps/workers/src/lib`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **Base your branch on `origin/main` (`6639163`), NOT on `feat/shadcn-improve`.**

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (prompt changes shift the severity distribution — that is the point, but review the wording carefully; a deterministic guard could demote a real critical if its allowlists are wrong)
- **Depends on**: none (026 is adjacent but independent)
- **Category**: bug (alert reliability, both directions)
- **Planned at**: commit `6639163` (origin/main), 2026-07-09

## Why this matters

Outrival's landing page promises critical alerts in ≤ 5 minutes, and "critical"
bypasses every notification-moderation layer and emails the customer immediately.
Yet the model deciding that severity is never told what "critical" means, nor that
it triggers a page. Measured consequences on ~6 weeks of production data
(`docs/audits/pipeline-audit-2026-07-09.md`): **zero critical signals ever emitted**
— a $500M Series F raise by a tracked direct competitor was classified `high` and
landed in a digest — while `medium` became a catch-all (116/169 signals) and the few
`high`s included marketing-script detections. Separately, when the *insight* prose
generation returns unparseable JSON, the job aborts with `AbortTaskRunError`
(retries disabled) and a change **already judged significant** is silently dropped
forever — production shows ~25 % error/parse rates on the insight task. This plan:
(1) puts the operator-validated severity rubric and category definitions into both
classifier prompts, (2) adds a deterministic demotion guard between the model's
"critical" token and the immediate email, (3) makes the insight parse-miss
retriable, mirroring the fix already landed for the classifier.

## Current state

All excerpts verified at `origin/main` = `6639163`.

- `packages/ai/src/tasks/classify.ts` — lexical classifier (pricing/blog/jobs/
  reviews/homepage-fallback paths; fast model tier).
  - `CLASSIFY_SYSTEM` (lines 51–74) is the ONLY severity guidance:
    ```
    You are a competitive-intelligence analyst. Classify a change detected on a competitor.

    Use the page type (provided with the change) to judge significance: rotating
    testimonials, social-proof counters, cosmetic copy/nav tweaks are usually NOT
    significant; pricing, plan, feature, hiring, or positioning changes are.
    ```
    …followed by JSON format lines (`"severity": "low|medium|high|critical"`,
    line 68). No definition of any severity level, no category definitions.
  - The system prompt is deliberately static ("byte-identical across EVERY classify
    call → sent as the `system` message so Groq/Cerebras auto-cache", comment lines
    47–50). **Keep the rubric inside `CLASSIFY_SYSTEM`** so it stays cacheable.
  - Cache: 7-day TTL keyed on `[sourceType, competitorName, diffText]` (lines 97–99).
- `packages/ai/src/tasks/classify-structured.ts` — structured homepage classifier
  (smart model tier). `buildStructuredClassifyPrompt` (lines 63–120) has a
  significance rule list; the severity mapping is line 90:
  ```
  - Set the OVERALL severity from the most significant change: a major change ⇒ "high" or "critical"; only minor/trivial changes ⇒ "low".
  ```
  **`medium` has no production rule** (bimodal by construction) and nothing
  distinguishes `high` from `critical`. Note: this builder is exported for the eval
  harness (`packages/ai/src/eval`) — changing the prompt text is fine, changing the
  signature is not.
- `apps/workers/src/jobs/generate-signal.job.ts`:
  - Severity/category resolution (lines 210–213):
    ```ts
    const severity = input.pricingTransition
      ? input.pricingTransition.severity
      : input.classification!.severity;
    const category = input.pricingTransition ? "pricing" : input.classification!.category;
    ```
    `monitor` (with `monitor.sourceType`) and `change` (with `change.diffText`,
    `change.diffType`) are loaded above (lines 173–198).
  - Insight parse-miss (lines 256–260):
    ```ts
    await logAiRun("insight", provider, model, insight ? "success" : "parse_failed");
    if (!insight) {
      logger.error("Insight generation failed", { changeId: input.changeId });
      throw new AbortTaskRunError("Insight returned null");
    }
    ```
    `AbortTaskRunError` disables the job's `retry: { maxAttempts: 3 }`.
  - **Precedent already on main** for the fix: `classify-change.job.ts` lines
    102–115 replaced its own abort with a plain throw, with a comment explaining
    that a parse miss is transient and retriable ("Throw a plain error so Trigger
    re-runs (the null result is never cached → a fresh LLM call)"). Mirror that
    comment style.
  - The signal insert uses `severity` at line 310 and `decideDispatch` runs further
    down — the guard must be applied at the single point where `severity` is
    computed so every downstream consumer (insert, dispatch, alerts) sees the
    guarded value.
- `apps/workers/src/lib/notification-dispatcher.ts` lines 189–195: critical bypasses
  every filter when `NOTIFICATION_CRITICAL_BYPASS !== "false"` — this is why a false
  critical pages the user. Do not modify this file.
- Repo pattern for testable job logic: pure module in `apps/workers/src/lib/` +
  bun test in `apps/workers/test/` (exemplars: `lib/completeness.ts`,
  `test/notification-dispatcher.test.ts`). Workers tests: `cd apps/workers && bun test test/`.
- The operator-validated rubric lives in
  `docs/audits/pipeline-audit-2026-07-09-golden-set.md` (validated 2026-07-09) — the
  prompt text below is its English rendering; the golden set is the regression
  reference for any future prompt iteration.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0 |
| Workers tests | `cd apps/workers && bun test test/` | all pass, 0 fail |
| AI package check | `pnpm typecheck --filter @outrival/ai` | exit 0 |

## Scope

**In scope** (the only files you should modify/create):
- `packages/ai/src/tasks/classify.ts` (prompt text only)
- `packages/ai/src/tasks/classify-structured.ts` (prompt text only)
- `apps/workers/src/jobs/generate-signal.job.ts` (guard wiring + retriable throw)
- `apps/workers/src/lib/severity-guard.ts` (create)
- `apps/workers/test/severity-guard.test.ts` (create)

**Out of scope** (do NOT touch):
- `apps/workers/src/lib/notification-dispatcher.ts` — the critical bypass is by
  design; the guard sits upstream.
- `apps/workers/src/jobs/classify-change.job.ts` — its retry fix is already landed.
- Zod schemas / `Classification` type — enum values unchanged.
- Cache keys/TTLs in the AI tasks, `groundedAiCall`, provider pool config.
- The eval harness under `packages/ai/src/eval` (it consumes the exported builder —
  it must keep compiling, but don't edit it).
- `pricingTransition` severity handling (deterministic by design, max "high").

## Git workflow

- Branch: `advisor/027-severity-rubric-critical-guard` off `origin/main`.
- Conventional commits, subject ≤ 50 chars, e.g. `fix(ai): severity rubric + deterministic critical guard`.
- Multi-line commit messages via `git commit -F <file>` (RTK proxy mangles multi-line `-m`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the rubric + category definitions to `CLASSIFY_SYSTEM`

In `packages/ai/src/tasks/classify.ts`, inside the `CLASSIFY_SYSTEM` template
(after the existing "Use the page type…" paragraph, before the "Reply ONLY…" line),
insert exactly this block:

```
<severity-rubric>
"critical" triggers an IMMEDIATE email to the customer, bypassing all moderation.
Use it only when BOTH hold:
  (a) the change is a direct threat or opening for the customer's own positioning
      or revenue — a price undercut or pricing-structure change by a direct
      competitor, the launch of a directly competing flagship capability, a funding
      round >= $100M or an acquisition of a direct competitor, or entry into the
      customer's exact segment; AND
  (b) the useful reaction window is DAYS, not weeks.
If unsure between "critical" and "high", choose "high".
"high" — a material strategic move where reacting next week loses nothing: a
notable product launch, a quantified price change, a complete repositioning of the
hero/value proposition, a strategic hiring wave.
"medium" — real but incremental: a new job posting, a new page section, a
promotion, a plan-limit tweak.
"low" — cosmetic or informational: copy polish, testimonials/logos, navigation,
meta tags, documentation pages.
Severity is judged on the CONTENT of the change, never on the size of the diff —
a one-line diff can be critical; a huge redesign diff can be low.
</severity-rubric>

<category-rules>
Judge WHAT changed, never WHERE it appeared:
- pricing: any price, plan, tier, trial, or gating change, on any page.
- funding: a raise, acquisition, or valuation announcement, even on a blog post.
- product: shipped or announced capabilities, launches, integrations.
- hiring: job postings and team growth — even when they telegraph product direction.
- reviews: review-platform score or review-content movements only.
- content: messaging, positioning, or content-strategy changes (use only when none
  of the above applies).
When two genuinely apply, pick by this priority: pricing > funding > product >
hiring > reviews > content.
</category-rules>
```

Do not change anything else in the file (the format block, the cache key, the
function body stay untouched).

**Verify**: `pnpm typecheck --filter @outrival/ai` → exit 0, and
`grep -n "severity-rubric" packages/ai/src/tasks/classify.ts` → 2 matches (open/close tags).

### Step 2: Fix the structured prompt's severity mapping and add the same rubric

In `packages/ai/src/tasks/classify-structured.ts`, inside
`buildStructuredClassifyPrompt`:

1. Replace line 90
   (`- Set the OVERALL severity from the most significant change: a major change ⇒ "high" or "critical"; only minor/trivial changes ⇒ "low".`)
   with:
   ```
   - Set the OVERALL severity from the rubric below, anchored on the most
     significant change: a single "major" change is usually "medium" or "high";
     reserve "critical" strictly for the rubric's critical test. Only minor/trivial
     changes ⇒ "low".
   ```
2. Insert the same `<severity-rubric>` and `<category-rules>` blocks from step 1,
   verbatim, between the `</rules>` line and the `<task>` line.

Keep the function signature and everything else identical (the eval harness imports
this builder).

**Verify**: `pnpm typecheck --filter @outrival/ai` → exit 0, and
`grep -c "severity-rubric" packages/ai/src/tasks/classify-structured.ts` → 2.

### Step 3: Create the deterministic guard `apps/workers/src/lib/severity-guard.ts`

```ts
import type { Classification } from "@outrival/ai";

/** Sources on which a "critical" can plausibly be observed. Everything else
 * (jobs, reviews, sitemap, tech_stack, ai_visibility, github_repo…) demotes:
 * those sources' worst case is strategic, not page-the-customer urgent. */
const CRITICAL_SOURCE_ALLOWLIST = new Set([
  "homepage", "pricing", "news", "blog", "changelog", "status",
]);

const CRITICAL_CATEGORY_ALLOWLIST = new Set(["pricing", "product", "funding"]);

/** A pricing-critical must be anchored on an actual number/price token in the diff
 * — a wording-only pricing change is never page-worthy. */
const PRICE_TOKEN = /[€$£¥]\s?\d|\d\s?(€|\$|usd|eur|gbp)|\/\s?(mo|month|yr|year|an)\b/i;

export interface SeverityGuardInput {
  severity: Classification["severity"];
  category: string;
  sourceType: string;
  diffText: string;
}

export interface SeverityGuardResult {
  severity: Classification["severity"];
  demoted: boolean;
  reason: string | null;
}

export function applySeverityGuard(input: SeverityGuardInput): SeverityGuardResult {
  if (input.severity !== "critical") {
    return { severity: input.severity, demoted: false, reason: null };
  }
  if (!CRITICAL_CATEGORY_ALLOWLIST.has(input.category)) {
    return { severity: "high", demoted: true, reason: `category_${input.category}` };
  }
  if (!CRITICAL_SOURCE_ALLOWLIST.has(input.sourceType)) {
    return { severity: "high", demoted: true, reason: `source_${input.sourceType}` };
  }
  if (input.category === "pricing" && !PRICE_TOKEN.test(input.diffText)) {
    return { severity: "high", demoted: true, reason: "pricing_without_price_token" };
  }
  return { severity: "critical", demoted: false, reason: null };
}
```

(Shape may vary slightly; keep it pure, exported, and demote-to-`high`-only — the
guard never upgrades and never touches non-critical severities.)

**Verify**: `pnpm typecheck` → exit 0.

### Step 4: Wire the guard into `generate-signal.job.ts`

Right after the severity/category resolution (lines 210–213), apply:

```ts
const guarded = applySeverityGuard({
  severity,
  category,
  sourceType: monitor.sourceType,
  diffText: change.diffText ?? "",
});
if (guarded.demoted) {
  logger.warn("Critical demoted by deterministic guard", {
    changeId: input.changeId,
    reason: guarded.reason,
  });
}
```

Then use `guarded.severity` for EVERYTHING downstream that currently reads
`severity`: the `shouldNarrate(severity)` gate (line 267), the signal insert
(line 310), and any dispatch/alert call below that passes `severity`. The cleanest
edit: `const finalSeverity = guarded.severity;` and rename the downstream uses —
run `grep -n "severity" apps/workers/src/jobs/generate-signal.job.ts` after editing
and confirm no remaining downstream use reads the unguarded variable (the
`input.pricingTransition.severity` reads inside the resolution block are fine).

**Verify**: `pnpm typecheck` → exit 0, and
`grep -n "applySeverityGuard" apps/workers/src/jobs/generate-signal.job.ts` → 1 wiring site.

### Step 5: Make the insight parse-miss retriable

Replace lines 257–260 of `generate-signal.job.ts`:

```ts
if (!insight) {
  logger.error("Insight generation failed", { changeId: input.changeId });
  throw new AbortTaskRunError("Insight returned null");
}
```

with a plain throw + the retriability comment, mirroring the precedent in
`classify-change.job.ts:102-115`:

```ts
if (!insight) {
  // Parse miss (malformed/empty JSON), not a provider error — transient on the
  // free reasoning providers, so RETRIABLE: aborting here dropped a change
  // already judged significant. Plain throw → Trigger re-runs (fresh LLM call);
  // the run is idempotent up to this point (signal insert happens below and is
  // protected by the signals_change_id_uq unique index).
  logger.error("Insight returned null (parse failed) — retrying", {
    changeId: input.changeId,
  });
  throw new Error("Insight returned null (parse failed)");
}
```

Check whether `AbortTaskRunError` is still used elsewhere in the file (it is — the
not-found guards at lines 140/153/173/174/193/198, which SHOULD stay aborts); keep
the import.

**Verify**: `grep -n "AbortTaskRunError(\"Insight" apps/workers/src/jobs/generate-signal.job.ts`
→ 0 matches; `pnpm typecheck` → exit 0.

### Step 6: Tests

`apps/workers/test/severity-guard.test.ts` (bun test; model after
`apps/workers/test/notification-dispatcher.test.ts` for structure):

1. Non-critical severities pass through untouched (`low`/`medium`/`high`, any
   category/source).
2. Critical + category `content` → demoted to `high`, reason `category_content`.
3. Critical + category `funding` + source `news` → stays `critical` (the Supabase
   Series F case — the guard must NOT block the rubric's canonical critical).
4. Critical + category `product` + source `jobs` → demoted (`source_jobs`).
5. Critical + category `pricing` + source `pricing` + diff `"Pro plan now $79/mo"`
   → stays `critical`.
6. Critical + category `pricing` + source `pricing` + diff without any price token
   → demoted (`pricing_without_price_token`).
7. Guard never returns anything above the input severity and never returns
   `critical` for a non-critical input.

**Verify**: `cd apps/workers && bun test test/severity-guard.test.ts` → 7+ pass, 0 fail.

### Step 7: Full verification

**Verify**: `pnpm typecheck` → exit 0 · `cd apps/workers && bun test test/` → all
pass · `pnpm typecheck --filter @outrival/ai` → exit 0.

## Test plan

Step 6 covers the guard. The prompt changes have no unit-testable oracle here —
their regression harness is the validated golden set
(`docs/audits/pipeline-audit-2026-07-09-golden-set.md`): re-classifying those 110
items against the new prompts and comparing to the validated labels is the
follow-up measurement (deliberately out of this plan's scope — it needs live
provider keys).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `cd apps/workers && bun test test/` exits 0, incl. ≥ 7 new severity-guard tests
- [ ] `grep -c "severity-rubric" packages/ai/src/tasks/classify.ts` → 2
- [ ] `grep -c "severity-rubric" packages/ai/src/tasks/classify-structured.ts` → 2
- [ ] `grep -n 'a major change ⇒ "high" or "critical"' packages/ai/src/tasks/classify-structured.ts` → 0 matches
- [ ] `grep -n "applySeverityGuard" apps/workers/src/jobs/generate-signal.job.ts` → present
- [ ] `grep -n 'AbortTaskRunError("Insight' apps/workers/src/jobs/generate-signal.job.ts` → 0 matches
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `CLASSIFY_SYSTEM` or `buildStructuredClassifyPrompt` has materially changed since
  `6639163` (someone else already added a rubric — reconcile instead of stacking two).
- `monitor` or `change.diffText` is not in scope at the severity-resolution point in
  `generate-signal.job.ts` (job restructured).
- The `Classification` severity enum has gained/lost values.
- Adding the rubric pushes any prompt past a hard token limit enforced in
  `groundedAiCall` (there is none known — but if a length assertion fires, report).

## Maintenance notes

- **Cache lag**: classifications are cached 7 days keyed on input — for up to a week
  after deploy, previously-seen diffs replay pre-rubric labels. Expected; do not
  bust the cache.
- **Distribution shift is intended**: expect the first genuine `critical`s to appear
  and `medium` share to drop. Watch the first week: every critical now emails
  immediately — if a false critical slips both the rubric and the guard, tighten
  `CRITICAL_SOURCE_ALLOWLIST`/category rules rather than re-wording the prompt first.
- Deferred deliberately: a per-org criticals/day soft-cap in the dispatcher
  (defense-in-depth against a critical storm) and re-scoring the golden set against
  the new prompts (needs provider keys — do it before any further prompt iteration).
- The guard's allowlists encode product judgment (jobs/reviews sources can't page).
  If a real critical is ever demoted (check `Critical demoted` warn logs), revisit
  the lists with that evidence.
- Reviewer focus: step 4's rename — confirm no downstream consumer still reads the
  unguarded `severity` variable.
