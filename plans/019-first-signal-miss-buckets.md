# Plan 019: Every first-signal SLO miss is attributed to a named cause, and the coverage-vs-latency call is made from data

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report, do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 74888f6..HEAD -- apps/api/src/routes/admin/product.ts apps/web/src/app/\(admin\)/admin/onboarding apps/workers/src/lib/backfill-guard.ts docs/slos`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `74888f6`, 2026-07-25

## Why this matters

Outrival's landing page promises a competitive signal on day 0. The product's own
SLO doc measured, in production on 2026-07-10, that **~35% of organizations have
never received any signal at all** (`docs/slos/onboarding-first-signal.md:24`).
Product analytics agree independently: over the last 90 days there were 26
`onboarding_completed` events and 11 `first_real_signal` events, so roughly 4 in 10
onboarded workspaces reach the moment the product exists for.

The machinery to explain *why* already exists and nobody reads it. Every backfill
attempt writes a root-cause bucket into the `backfill_runs` analytics table
(`no_archive_capture` / `no_significant_change` / `change_triggered`), and the SLO
compliance percentage is already computed and rendered at `/admin/onboarding`. What
is missing is the join between the two: which bucket dominates the misses. The SLO
doc's own error-budget policy (step 3, line 143) makes that join the decision
procedure: "if `no_archive_capture` + `no_significant_change` dominate, the fix is
coverage work (guaranteed day-0 signal artifact), not latency work, prioritize it
over roadmap features for the next cycle."

This plan produces that join as a permanent admin readout, then uses it once to make
the routing call in writing. Its deliverable is a **measurement plus a recommendation**,
not a redesign of onboarding. Do not build the day-0 artifact in this plan.

## Current state

### The files

- `apps/api/src/routes/admin/product.ts` — admin product-metrics router. Contains
  `GET /first-signal-slo` (lines 113-175), which computes the SLI but reports no
  miss causes.
- `apps/workers/src/lib/backfill-guard.ts` — defines the miss-bucket taxonomy
  (`BackfillOutcome`) and `resolveBackfillOutcome`. This is the vocabulary the new
  readout must reuse verbatim; do not invent new bucket names.
- `apps/workers/src/core/backfill-history.ts:278-279` — the only writer of those
  buckets, via `logBackfillRun` in `apps/workers/src/lib/analytics.ts`.
- `packages/db/src/schema/analytics.ts:287-305` — the `backfill_runs` table.
- `apps/web/src/app/(admin)/admin/onboarding/page.tsx` — renders the SLO card from
  `GET /api/admin/first-signal-slo`.
- `docs/slos/onboarding-first-signal.md` — the SLO contract, its error-budget
  policy, and the review cadence this plan feeds.

### The existing endpoint (the thing you extend)

`apps/api/src/routes/admin/product.ts:113-175`:

```ts
// First-signal SLO (docs/slos/onboarding-first-signal.md) — the landing's
// "<10 min to first signal" promise, MEASURED not assumed. Same query the ops
// alert runs (workers getFirstSignalSloInputs); surfaced here so the compliance %
// is a live number in /admin. Only completions whose 10-min window has ELAPSED
// count. Best-effort: a read error returns { available: false }, never throws.
productRouter.get("/first-signal-slo", async (c) => {
  const recentRows = await analyticsQuery<{ hit: boolean }>(sql`
    SELECT (fs.first_signal_at IS NOT NULL
            AND fs.first_signal_at <= os.completed_at + interval '10 minutes') AS hit
    FROM onboarding_sessions os
    LEFT JOIN LATERAL (
      SELECT min(s.created_at) AS first_signal_at FROM signals s WHERE s.org_id = os.org_id
    ) fs ON true
    WHERE os.stage = 'completed' AND os.completed_at IS NOT NULL
      AND os.completed_at <= now() - interval '10 minutes'
    ORDER BY os.completed_at DESC
    LIMIT 3
  `);
  ...
  const agg = aggRows[0];
  if (!agg) return c.json({ available: false });

  const inputs: FirstSignalSloInputs = {
    recent: recentRows.map((r) => r.hit === true),
    week: { completions: num(agg.week_n), within: num(agg.week_within) },
    window: { completions: num(agg.window_n), within: num(agg.window_within) },
    coverage24h: { completions: num(agg.cov_n), within: num(agg.cov_within) },
  };
  return c.json({ available: true, ...summarizeFirstSignalSlo(inputs) });
});
```

### The bucket taxonomy you must reuse

`apps/workers/src/lib/backfill-guard.ts:34-65`:

```ts
export interface BackfillOutcome {
  outcome: "change_triggered" | "no_significant_change" | "no_archive_capture";
  detail: string | null;
}

/**
 * Map a finished backfill loop to its SLO miss bucket
 * (docs/slos/onboarding-first-signal.md — "root-cause every miss"):
 *   change_triggered      → the day-0 signal chain started (the success path)
 *   no_significant_change → archives were seeded but the past looks like the
 *                           present (no diff / trivial diff) — a coverage miss
 *   no_archive_capture    → nothing usable came out of Wayback; detail says why
 */
export function resolveBackfillOutcome(
  seeded: number,
  changeTriggered: boolean,
  skips: BackfillSkips,
): BackfillOutcome {
  if (changeTriggered) return { outcome: "change_triggered", detail: null };
  if (seeded === 0) {
    return {
      outcome: "no_archive_capture",
      detail:
        `no_capture=${skips.noCapture} too_recent=${skips.tooRecent} ` +
        `challenge_or_deny=${skips.challengeOrDeny} void=${skips.voidCapture}`,
    };
  }
  return {
    outcome: "no_significant_change",
    detail: skips.trivialReason ?? (skips.noDiff ? "no_diff" : "lookback_capture_unusable"),
  };
}
```

Note `backfill-history.ts` also logs preconditions with other outcome strings
(`self`, `no_live_snapshot`, `no_url`, `no_current_html`, `error`, per
`docs/architecture.md`), so the readout must group by whatever string is present
rather than assume only the three above.

### The table you read

`packages/db/src/schema/analytics.ts:287-305`:

```ts
export const backfillRuns = pgTable(
  "backfill_runs",
  {
    id: uuid(),
    monitorId: text("monitor_id").notNull(),
    competitorId: text("competitor_id").notNull(),
    sourceType: text("source_type").notNull(),
    outcome: text("outcome").notNull(),
    detail: text("detail"),
    archivesSeeded: integer("archives_seeded").notNull().default(0),
    changeTriggered: integer("change_triggered").notNull().default(0), // 0/1
    durationMs: integer("duration_ms").notNull().default(0),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  ...
);
```

`backfill_runs` carries no `org_id`. Join to the org through `competitors`:
`competitors.id` and `competitors.org_id` are both `text`
(`packages/db/src/schema/competitors.ts:54-55`), and `backfill_runs.competitor_id`
is `text`, so the join is a plain equality with no cast.

### Conventions that apply

- **Every analytics read goes through `analyticsQuery`**, never `db.execute`
  directly. See `apps/api/src/lib/analytics-safe.ts:10-12`: it returns `[]` on any
  error so a broken analytics read can never 500 a handler. Match that; the readout
  must degrade to "unavailable", never throw.
- **Hono handlers never throw naked** (`apps/api/CLAUDE.md`): respond with JSON.
  The existing endpoint's `{ available: false }` shape is the local idiom for
  "cannot compute right now"; reuse it.
- **Admin routes are mounted behind `authMiddleware` then `adminMiddleware`**. You
  are adding a route to an already-mounted router, so nothing new is needed here;
  do not touch the mounting.
- Dates in client-facing raw SQL: this readout returns counts only, so no timezone
  handling is required. Do not add any.

## Commands you will need

| Purpose   | Command                                            | Expected on success        |
|-----------|----------------------------------------------------|----------------------------|
| Typecheck | `pnpm typecheck`                                   | exit 0, 8 tasks            |
| Tests     | `pnpm test`                                        | exit 0, all tests pass     |
| API tests | `pnpm --filter @outrival/api test`                 | exit 0                     |

**Environment gotcha**: `turbo` is not on `PATH` in this repo's dev box. A bare
`turbo typecheck` prints `turbo: command not found`, and when piped it looks like
silence rather than failure. Always use the `pnpm` scripts above, or `pnpm exec
turbo` if you need turbo directly.

**Do not run `pnpm build`**: a full web build exhausts RAM on the WSL2 dev box.
Typecheck plus tests is the gate.

## Scope

**In scope** (the only files you may modify):
- `apps/api/src/routes/admin/product.ts` (extend)
- `apps/api/test/` — one new test file for the new handler, named to match the
  existing convention in that directory (inspect it first and copy the naming)
- `apps/web/src/lib/api.ts` (add the response type and the fetch method only)
- `apps/web/src/app/(admin)/admin/onboarding/page.tsx` (render the new block)
- `docs/slos/onboarding-first-signal.md` (append the review section in step 5)

**Out of scope** (do NOT touch, even though they look related):
- `apps/workers/src/lib/backfill-guard.ts` and
  `apps/workers/src/core/backfill-history.ts` — the buckets are correct and already
  written; this plan only reads them. Changing the writer changes the meaning of
  historical rows.
- `apps/workers/src/lib/slo-first-signal.ts` — the ops alert is deliberately a
  duplicate of the SLI query so the worker never imports API code. Leave it alone.
  It also imports `@trigger.dev/sdk/v3`, which plan 006 migrates; touching it here
  would collide.
- Any change to onboarding, `backfill-history`, `scrape-monitor`, `classify-change`
  or `generate-signal`. Building the day-0 artifact is the *outcome* of this plan,
  not part of it.
- The SLO target itself. Recalibration is scheduled for early August 2026 per
  `docs/slos/onboarding-first-signal.md:29`; do not move it.

## Git workflow

- Branch: `advisor/019-first-signal-miss-buckets`
- Conventional Commits, subject at most 50 chars, imperative. Example from
  `git log`: `feat(web): rebuild Discovery as a triage desk (#262)`.
  Suggested: `feat(api): attribute first-signal misses to a cause`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the miss-attribution endpoint

In `apps/api/src/routes/admin/product.ts`, directly after the existing
`GET /first-signal-slo` handler (which ends at line 175), add
`GET /first-signal-misses`.

It must answer one question over a 28-day window: for the onboarding completions
that **missed** the 10-minute mark, what did the backfill do?

Target shape:

```ts
productRouter.get("/first-signal-misses", async (c) => {
  const rows = await analyticsQuery<{ bucket: string; orgs: number }>(sql`
    WITH completions AS (
      SELECT os.org_id, os.completed_at
      FROM onboarding_sessions os
      WHERE os.stage = 'completed' AND os.completed_at IS NOT NULL
        AND os.org_id IS NOT NULL
        AND os.completed_at >= now() - interval '28 days'
        AND os.completed_at <= now() - interval '10 minutes'
    ),
    missed AS (
      SELECT c.org_id
      FROM completions c
      WHERE NOT EXISTS (
        SELECT 1 FROM signals s
        WHERE s.org_id = c.org_id
          AND s.created_at <= c.completed_at + interval '10 minutes'
      )
    ),
    runs AS (
      SELECT DISTINCT ON (m.org_id, br.outcome) m.org_id, br.outcome
      FROM missed m
      JOIN competitors comp ON comp.org_id = m.org_id
      JOIN backfill_runs br ON br.competitor_id = comp.id
      WHERE br.recorded_at >= now() - interval '28 days'
    )
    SELECT outcome AS bucket, count(DISTINCT org_id)::int AS orgs
    FROM runs GROUP BY 1
    UNION ALL
    SELECT 'no_backfill_run' AS bucket, count(*)::int AS orgs
    FROM missed m
    WHERE NOT EXISTS (
      SELECT 1 FROM competitors comp
      JOIN backfill_runs br ON br.competitor_id = comp.id
      WHERE comp.org_id = m.org_id AND br.recorded_at >= now() - interval '28 days'
    )
  `);
  // ... plus a second read for the never-signal cohort, see below
});
```

Alongside the buckets, return the **never-signal cohort** over the same window,
because a miss at 10 minutes and a miss forever are different product problems and
the SLO doc tracks them separately (`docs/slos/onboarding-first-signal.md:153-161`):

```ts
const cohort = await analyticsQuery<{
  completions: number; never_signal: number; missed: number;
}>(sql`
  WITH completions AS (
    SELECT os.org_id, os.completed_at
    FROM onboarding_sessions os
    WHERE os.stage = 'completed' AND os.completed_at IS NOT NULL
      AND os.org_id IS NOT NULL
      AND os.completed_at >= now() - interval '28 days'
      AND os.completed_at <= now() - interval '10 minutes'
  )
  SELECT
    count(*)::int AS completions,
    count(*) FILTER (
      WHERE NOT EXISTS (SELECT 1 FROM signals s WHERE s.org_id = c.org_id)
    )::int AS never_signal,
    count(*) FILTER (
      WHERE NOT EXISTS (
        SELECT 1 FROM signals s
        WHERE s.org_id = c.org_id AND s.created_at <= c.completed_at + interval '10 minutes'
      )
    )::int AS missed
  FROM completions c
`);
```

Return `{ available: false }` when `cohort[0]` is undefined, mirroring the existing
endpoint exactly. Otherwise return
`{ available: true, windowDays: 28, completions, missed, neverSignal, buckets: [{ bucket, orgs }] }`.

A miss can legitimately appear in more than one bucket (an org has several
competitors, each with its own backfill outcome). Say so in a code comment: the
bucket counts are **per-org presence**, not a partition, so they do not sum to
`missed`. A reader who assumes a partition will misroute the decision.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Cover the handler with a test

Look at `apps/api/test/` first and copy the structural pattern of an existing route
test (the API test harness runs on PGlite, so the tables exist). Write one test file
for the new endpoint covering:

- **empty database** → `available` is `true` with `completions: 0`, or `false`;
  assert whichever the code actually produces and make the handler deterministic
  about it. It must not throw.
- **one completion with a signal inside 10 minutes** → `missed: 0`.
- **one completion with no signal at all** → `missed: 1`, `neverSignal: 1`, and a
  `no_backfill_run` bucket of 1.
- **one completion, no in-window signal, one `backfill_runs` row with outcome
  `no_archive_capture`** → that bucket present with `orgs: 1`.

**Verify**: `pnpm --filter @outrival/api test` → exit 0, the 4 new cases pass.

### Step 3: Surface it in /admin/onboarding

Add the response type and a fetch method to `apps/web/src/lib/api.ts`, following the
shape of the existing `AdminFirstSignalSlo` type at line 1698 and the
`adminFetch<AdminFirstSignalSlo>("/api/admin/first-signal-slo")` call in
`apps/web/src/app/(admin)/admin/onboarding/page.tsx:25`.

Render the buckets under the existing SLO card as a plain list: bucket name, org
count, and one sentence of `info` copy stating that buckets are per-org presence
and do not partition the misses. Match the surrounding card/`info` pattern already
used on that page; do not introduce a new component library or chart.

`apps/web/src/lib/api.ts` is 3411 lines and is the highest-churn file in the repo.
Add your type next to `AdminFirstSignalSlo` and your method next to the existing
admin methods. Do not reorganize the file.

**Verify**: `pnpm typecheck` → exit 0.

### Step 4: Read the production numbers

This step produces no code. Open `/admin/onboarding` against production as an
allowlisted admin (the page is gated by the `ADMIN_EMAILS` allowlist) and record,
verbatim:

- `completions`, `missed`, `neverSignal` over 28 days
- every bucket and its org count

If you cannot reach production, STOP and report that the measurement step needs an
operator; do not substitute local or seeded numbers, and do not guess. The whole
point of this plan is that the decision comes from real data.

**Verify**: you have written the numbers down and they are internally consistent
(`missed <= completions`, `neverSignal <= missed`).

### Step 5: Write the routing decision

Append a dated section, `## Miss attribution review, <YYYY-MM-DD>`, to
`docs/slos/onboarding-first-signal.md`, after the "Companion metric" section. It
must contain:

1. The recorded numbers from step 4, as a table.
2. The dominant bucket.
3. The routing call, applying the doc's own policy verbatim
   (`docs/slos/onboarding-first-signal.md:143`):
   - `no_archive_capture` + `no_significant_change` dominant → **coverage work**:
     the next cycle builds a guaranteed day-0 artifact. State that explicitly and
     name the follow-up as a separate future plan; do not design it here.
   - `no_backfill_run` dominant → the backfill is not firing for these orgs at all.
     That is a **wiring** problem, not a coverage problem, and the next step is to
     find why (`BACKFILL_ENABLED`, `BACKFILL_SOURCES`, monitor seeding, worker
     deploy state), also as a separate plan.
   - `change_triggered` dominant among misses → the chain started but the signal
     arrived late. That is a **latency** problem: the next step is the
     backfill-to-signal path timing.
4. One sentence on whether the 70% target survives, or whether the honesty gate at
   line 148 ("soften the landing-page promise copy") applies.

Do not change the target in this plan even if the data suggests it; recalibration
has its own scheduled gate.

**Verify**: `grep -n "Miss attribution review" docs/slos/onboarding-first-signal.md`
returns one match.

## Test plan

- New file in `apps/api/test/` covering the four cases in step 2, modeled
  structurally on an existing route test in the same directory (open one and match
  its harness setup, seeding style and assertion style; do not invent a new
  harness).
- No new worker tests: this plan writes no worker code.
- Verification: `pnpm test` → exit 0, including the 4 new cases.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0, with 4 new passing cases for `/first-signal-misses`
- [ ] `curl`-equivalent of `GET /api/admin/first-signal-misses` returns
      `available`, `completions`, `missed`, `neverSignal` and a `buckets` array
- [ ] `/admin/onboarding` renders the buckets under the existing SLO card
- [ ] `docs/slos/onboarding-first-signal.md` contains a dated
      `## Miss attribution review` section with real production numbers and one
      named routing decision
- [ ] `git status` shows no modified file outside the in-scope list
- [ ] `plans/README.md` status row for 019 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at `apps/api/src/routes/admin/product.ts:113-175` does not match the
  excerpt above (the endpoint moved or was rewritten).
- `backfill_runs` is empty over the last 28 days in production. That is itself the
  finding: the backfill is not running at all, which is a wiring bug and a
  different plan. Report the emptiness rather than writing a decision on no data.
- You cannot reach production to complete step 4.
- The bucket join needs a schema change, an `org_id` column on `backfill_runs`, or
  a new analytics table. It should not; if it does, the assumption that
  `backfill_runs.competitor_id` joins to `competitors.id` is false and this plan
  needs rewriting.
- `pnpm test` was already failing before your first change (record the baseline
  first, with `pnpm test` on a clean tree).

## Maintenance notes

- The two SQL bodies in `product.ts` and `apps/workers/src/lib/slo-first-signal.ts`
  are deliberate duplicates so the worker never imports API code. If the SLI
  definition changes, both must change; a reviewer should check that.
- The bucket vocabulary is owned by `resolveBackfillOutcome`. If a new outcome
  string is added there, the readout picks it up automatically (it groups by the
  stored string) but the admin copy explaining the buckets will not. That is the
  one place to check in review.
- Deliberately deferred: building the guaranteed day-0 artifact, and promoting the
  24h coverage companion to a full SLO. Both wait on this plan's numbers.
- If onboarding ever allows completing with zero competitors, those orgs land in
  `no_backfill_run` and will look like a wiring failure. The SLO doc
  (lines 60-63) is explicit that they are counted on purpose; keep it that way and
  split them out only if they dominate.
