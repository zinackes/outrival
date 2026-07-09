# Plan 030: The staged-extraction cache actually caches — replay output is normalized, heals persist, cooldown arms

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 6639163..HEAD -- apps/workers/src/lib/staged-extract.ts packages/scrapers/src/parsers/cached-extractor.ts packages/ai/src/tasks/generate-extractor.ts packages/db/src/schema/parser-extractors.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **Base your branch on `origin/main` (`6639163`), NOT on `feat/shadcn-improve`.**

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW–MED (pure normalization + persistence changes behind the existing
  `STAGED_EXTRACTION_ENABLED` kill-switch; the AI floor stays untouched)
- **Depends on**: none
- **Category**: bug (cost + the entire patch-30 value proposition)
- **Planned at**: commit `6639163` (origin/main), 2026-07-09

## Why this matters

Patch-30's staged extraction was built to move AI off the hot path: generate a CSS
extractor once, replay it for free forever. Production data (2026-07-09 audit,
finding SCR-20) shows the opposite: **`parser_extractors` has zero rows ever, the
`cache`/`heal` resolutions have never appeared in `extraction_runs`, and
`generate_extractor` burned ~405 smart-tier AI calls in 30 days for nothing** —
every non-structured extraction pays the generator AND the AI-fallback floor, i.e.
patch-30 currently *doubles* extraction cost. Root cause is a deterministic shape
mismatch: `replayExtractor` returns a **bare array of row objects**, but the heal
and cache stages validate that raw value against the source's **object schema**
(`z.object({ plans: [...] })` / `z.object({ jobs: [...] })`), which can never parse
an array — so a healed spec never validates, is never persisted, and (because the
cooldown stamp is guarded on a cached row existing) the cooldown never arms either.
Secondary mismatches would then bite next: the generated pricing spec emits
`currency` as nullable text (often a bare symbol) and `billing_period` as a raw
label ("/month"), while `PricingPlanSchema` requires non-null `currency` and an
enum period; the generated jobs spec has no `department`, which `JobPostingSchema`
requires. This plan adds a per-kind normalize+wrap layer, persists the cooldown even
on a failed heal, and locks the whole loop with tests.

## Current state

All excerpts verified at `origin/main` = `6639163`.

- `apps/workers/src/lib/staged-extract.ts` (201 lines) — the orchestrator:
  - `validateSchema` / `stageOk` (lines 63–70) run `input.schema.safeParse(raw)` on
    the RAW replay value.
  - Stage 2 cache replay (lines 106–126):
    `const replayed = stageOk(replayExtractor(input.html, cachedSpec.data));`
  - Stage 3 heal (lines 134–161): generates a spec, then
    `const healed = stageOk(replayExtractor(input.html, persisted));` (line 142);
    only a non-null `healed` reaches `upsertExtractor` (line 144). The
    "generated but didn't validate" stamp is guarded `if (cached)` (lines 148–154)
    — with an empty table, `cached` is always undefined → **cooldown never armed**.
  - `upsertExtractor` (lines 167–200): the ONLY writer of `parser_extractors`;
    upserts on `(domain, sourceType)`.
- `packages/scrapers/src/parsers/cached-extractor.ts`:
  - `replayExtractor` returns `Record<string, unknown>[] | Record<string, unknown> | null`
    (line 15–18); with `spec.list` set it returns the **bare rows array** (line 53,
    `return rows;`). Its own doc comment (lines 11–13) says the worker validates it
    against "PricingSchema / JobsSchema" — the wrapping that comment assumes was
    never written.
  - Transforms whitelist (lines 62–75): `number` (via `asPrice`), `lower`, `text`,
    `trim` (default).
- `packages/ai/src/tasks/generate-extractor.ts` — the GUIDES (lines 30–44) tell the
  model to emit, for pricing: `plan_name`, `price` (number, nullable), `currency`
  (nullable — a selector for the symbol/code near the price), `billing_period`
  (nullable — a selector for the "/month" or "/year" **label**); for jobs: `title`,
  `location` (nullable) — **no `department`**. A well-formed
  `{"version":1,"fields":{}}` sentinel is a VALID return (comment lines 84–90).
  **Do not change this file** — the fix normalizes downstream.
- Target schemas (`packages/ai/src/tasks/`):
  - `extract-pricing.ts:6-23` — `PricingPlanSchema = { plan_name: string, price:
    number|null, currency: string (NOT nullable), billing_period: enum["monthly",
    "yearly","one_time","custom","usage"], unit?, included_quantity? }`;
    `PricingSchema = z.object({ plans: z.array(PricingPlanSchema) })`.
  - `extract-jobs.ts:6-14` — `JobPostingSchema = { title: string, department:
    string (required), location: string|null }`; `JobsSchema = z.object({ jobs: [...] })`.
- `packages/db/src/schema/parser-extractors.ts` — `lastValidatedAt` (line 40) and
  `lastHealAttemptAt` (line 42) are **both nullable** → a "failed-heal stub" row
  can be stored with `lastValidatedAt: null`, **no migration needed**.
- Precedent for period-label mapping: `packages/scrapers/src/pricing/harvest.ts`
  (post-#124) defaults a missing period token to monthly ("No period token →
  default to monthly", ~line 210).
- Tests: workers pure-lib tests live in `apps/workers/test/*.test.ts` (bun) —
  exemplar `apps/workers/test/jobs-delta.test.ts`. Command:
  `cd apps/workers && bun test test/`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0 |
| Workers tests | `cd apps/workers && bun test test/` | all pass, 0 fail |

## Scope

**In scope** (the only files you should modify/create):
- `apps/workers/src/lib/replay-normalize.ts` (create — pure normalize+wrap layer)
- `apps/workers/test/replay-normalize.test.ts` (create)
- `apps/workers/src/lib/staged-extract.ts` (wire the normalizer at stages 2+3;
  stub-row cooldown persistence)

**Out of scope** (do NOT touch):
- `packages/ai/src/tasks/generate-extractor.ts` (prompt/GUIDES stay — the
  normalizer owns shape-bridging)
- `packages/scrapers/src/parsers/cached-extractor.ts` (its contract — bare rows —
  is fine; documented consumer-side)
- `packages/db/src/schema/*` (no migration — nullable columns already suffice)
- The extract job callers (`extract-pricing.job.ts`, `extract-jobs.job.ts`) — the
  `stagedExtract` signature must not change
- `PricingSchema` / `JobsSchema` / plausibility gates

## Git workflow

- Branch: `advisor/030-staged-extraction-heal-cache` off `origin/main`.
- Conventional commits, subject ≤ 50 chars, e.g. `fix(workers): staged extraction heal/cache actually persists`.
- Multi-line commit messages via `git commit -F <file>` (RTK proxy mangles multi-line `-m`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create the pure normalizer `apps/workers/src/lib/replay-normalize.ts`

```ts
import type { ExtractorKind } from "@outrival/ai";

const CURRENCY_BY_SYMBOL: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP", "¥": "JPY" };

/** Bridge replayExtractor's raw output (bare row array for list specs) to the
 * source schemas' object shape, filling the fields the generated specs can't
 * know (audit SCR-20). Pure; unknown-in, unknown-out — the caller still runs the
 * Zod schema + plausibility gate on the result. Non-array values (single-object
 * specs, null) pass through untouched. */
export function normalizeReplayOutput(kind: ExtractorKind, raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  if (kind === "pricing") return { plans: raw.map(normalizePricingRow) };
  if (kind === "jobs") return { jobs: raw.map(normalizeJobRow) };
  return raw;
}
```

with:

- `normalizePricingRow(row)`:
  - `currency`: take the row's value if it's a non-empty string; map a bare symbol
    through `CURRENCY_BY_SYMBOL`; uppercase a 3-letter code; anything else /
    null → `"USD"` (schema requires non-null; the plausibility gate downstream
    still arbitrates).
  - `billing_period`: map the raw label — `/mo\b|month|mois/i` → `"monthly"`,
    `/yr\b|year|annuel|\/an\b/i` → `"yearly"`, `/one[- ]?time|once|lifetime/i` →
    `"one_time"` — and default `"monthly"` when null/unmatched (same default as
    `harvest.ts`).
  - pass `plan_name` / `price` / other keys through unchanged.
- `normalizeJobRow(row)`: add `department: "Other"` when the row has no
  `department` (the generated jobs spec never emits one; `"Other"` is in the
  extraction prompt's canonical department list); pass `title` / `location`
  through; coerce a missing `location` to `null`.

Keep every helper exported for tests.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Wire the normalizer into stages 2 and 3

In `apps/workers/src/lib/staged-extract.ts`:

- Stage 2 (line 114):
  `const replayed = stageOk(normalizeReplayOutput(input.kind, replayExtractor(input.html, cachedSpec.data)));`
- Stage 3 (line 142):
  `const healed = stageOk(normalizeReplayOutput(input.kind, replayExtractor(input.html, persisted)));`

Nothing else in the validation chain changes — the object schema + `plausible`
gate still decide.

**Verify**: `pnpm typecheck` → exit 0, and
`grep -c "normalizeReplayOutput" apps/workers/src/lib/staged-extract.ts` → 2.

### Step 3: Arm the cooldown even when no cached row exists

Replace the `if (cached)` stamp block (lines 148–154) so a generated-but-not-
validating spec is persisted as a **stub row** (this both arms the cooldown and
lets stage 2 cheaply re-try/track the broken spec via `consecutiveFailures`):

```ts
// Generated but didn't validate → persist the attempt so the cooldown arms
// (nullable lastValidatedAt marks it never-validated) instead of re-paying the
// generator on every scrape of a page we can't parse.
if (spec) {
  const version = (cached?.version ?? 0) + 1;
  await db
    .insert(parserExtractors)
    .values({
      domain, sourceType: input.sourceType,
      spec: { ...spec, version }, version,
      healCount: cached?.healCount ?? 0,
      consecutiveFailures: (cached?.consecutiveFailures ?? 0) + 1,
      lastValidatedAt: null,
      lastHealAttemptAt: new Date(), updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [parserExtractors.domain, parserExtractors.sourceType],
      set: { lastHealAttemptAt: new Date(), consecutiveFailures: (cached?.consecutiveFailures ?? 0) + 1, updatedAt: new Date() },
    });
} else if (cached) {
  // parse-failed generation: stamp the existing row only (nothing new to store)
  await db.update(parserExtractors)
    .set({ lastHealAttemptAt: new Date() })
    .where(eq(parserExtractors.id, cached.id));
}
```

Adapt naming/placement to the surrounding code (the `spec`/`healed` variables are
already in scope inside the `try`; make sure the stub insert only runs when
`healed` was null — i.e. move it into the existing "didn't validate" position,
after the `if (healed)` early return). Note: when generation itself returned
`null` (parse miss) and no row exists, there is still nothing to stamp — that stays
un-cooldowned by design (a parse miss is transient; see `generate-extractor.ts:84-90`).

**Verify**: `pnpm typecheck` → exit 0.

### Step 4: Tests

`apps/workers/test/replay-normalize.test.ts` (bun; import the REAL schemas from
`@outrival/ai` so the test proves end-to-end parseability):

1. Pricing rows as `replayExtractor` actually emits them —
   `[{ plan_name: "Pro", price: 29, currency: "€", billing_period: "/month" }]` →
   after `normalizeReplayOutput("pricing", rows)`,
   `PricingSchema.safeParse(...).success === true`, currency `"EUR"`, period `"monthly"`.
2. Quote-based tier: `{ plan_name: "Enterprise", price: null, currency: null,
   billing_period: null }` → parses; currency `"USD"`, period `"monthly"`.
3. Yearly label variants: `"/yr"`, `"per year"`, `"par an"` → `"yearly"`.
4. Jobs rows `[{ title: "SRE", location: "Remote" }]` →
   `JobsSchema.safeParse(...).success === true` with `department: "Other"`.
5. Non-array passthrough: `normalizeReplayOutput("pricing", { anything: 1 })`
   returns the object unchanged; `null` stays `null`.
6. **The SCR-20 regression, stated as the module contract**: the RAW bare-rows
   array from case 1 fails `PricingSchema.safeParse` directly (documents WHY the
   normalizer exists — if this ever starts passing, the schemas changed and the
   normalizer should be revisited).

**Verify**: `cd apps/workers && bun test test/replay-normalize.test.ts` → 6+ pass, 0 fail.

### Step 5: Full verification

**Verify**: `pnpm typecheck` → exit 0 · `cd apps/workers && bun test test/` → all
pass, 0 fail.

## Test plan

Step 4. The live heal→cache loop (first scrape heals+persists, second resolves
`cache`) is verified operationally after deploy: `extraction_runs` must show
`heal` then `cache` resolutions appear, and `parser_extractors` row count > 0 —
note this in your report as the post-deploy check for the operator (needs a
worker `trigger deploy`; workers deploy manually from main, not via Coolify).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `cd apps/workers && bun test test/` exits 0, incl. ≥ 6 new normalizer tests
- [ ] `grep -c "normalizeReplayOutput" apps/workers/src/lib/staged-extract.ts` → 2 (stages 2 and 3)
- [ ] The failed-heal path persists/stamps a row without requiring `cached` (step 3 shape present)
- [ ] `git diff --stat` shows NO changes under `packages/` (workers-only change)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `staged-extract.ts` no longer matches the excerpts (someone else fixed SCR-20 —
  reconcile).
- `parser_extractors.lastValidatedAt` or `lastHealAttemptAt` has gained a
  `.notNull()` since `6639163` (the stub-row design needs them nullable).
- `ExtractorKind` gains values beyond `"pricing" | "jobs"` — the normalizer must
  fail loud (STOP), not silently pass a new kind through.
- Importing `PricingSchema`/`JobsSchema` from `@outrival/ai` into a workers test
  fails (package export restriction) — report; do not copy the schemas.

## Maintenance notes

- **Post-deploy check (operator)**: within a day of worker deploy, `parser_extractors`
  must be non-empty and `extraction_runs` must show `cache` resolutions rising while
  `generate_extractor` ai_runs fall (~405/30d → near heal-only). If not, the audit's
  cost finding still stands — reopen.
- The `"USD"` currency default is a pragmatic schema-bridge, not truth — the
  plausibility gate and pricing_history consumers should treat cache/heal-resolved
  currency with the same trust as AI output (same as before this fix: none of it is
  authoritative). If wrong-currency rows appear, the better fix is teaching the
  GUIDES to emit an ISO code — that's a `generate-extractor.ts` change, deliberately
  out of scope here.
- The stub-row design means `parser_extractors` will now contain never-validated
  rows (`lastValidatedAt: null`) — the /admin extraction panel (when it lands, audit
  instrumentation batch) should distinguish them from live extractors.
- Reviewer focus: step 3 — the stub insert must be unreachable when `healed`
  validated (no double-write), and the cooldown read (`cached?.lastHealAttemptAt`,
  line 131) now works because the stub IS the cached row on the next run.
