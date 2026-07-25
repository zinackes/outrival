# Plan 021: Every optional capability reports whether it is actually doing anything in production, and carries a written activation condition

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report, do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 74888f6..HEAD -- apps/api/src/routes/admin/system.ts apps/web/src/app/\(admin\)/admin/system packages/db/src/schema/analytics.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S-M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `74888f6`, 2026-07-25

## Why this matters

The repository ships a large number of capabilities behind an optional switch, an
optional API key, or a plan flag. Each one was correctly built "safe by default",
and there is no single place that answers the operator's actual question: **which of
these is doing anything in production right now?**

The consequence is that a capability can be dark for weeks without anyone noticing,
and the only way to find out is to read source. Three concrete cases, verified at
this commit:

- `packages/ai/src/faithfulness/gate.ts:25` reads
  `process.env.FAITHFULNESS_GATE_ENABLED === "true"`, so the claim-level publication
  gate is **off unless explicitly turned on**.
- `apps/api/src/env.ts:24` makes `INTERNAL_API_SECRET` optional, and
  `apps/api/src/index.ts:128` records that the internal routes "answer 404 across the
  board when INTERNAL_API_SECRET is unset". Standing queries are saved by users and
  then silently never re-evaluated when that secret is missing on either service.
- `apps/web/src/app/(auth)/auth/auth-form.tsx:19` and
  `apps/web/src/components/outrival/security-settings.tsx:30` both gate passkeys on
  `NEXT_PUBLIC_PASSKEYS_ENABLED === "true"`, a build-time variable, so the feature is
  invisible unless it was set at Docker build time.

There is a second reason a config dump would not solve this. The API and the
workers are **separate services with separate environments** (the worker VPS is not
on Coolify and reads a plain `.env`), so an API-side readout of
`process.env.BACKFILL_ENABLED` would report the API's value, which is meaningless.
The honest probe is behavioural: has this capability written a row recently? Every
optional capability already leaves a trace in an existing table, so the readout can
be built with reads only, no new writes, no migration.

The second deliverable matters as much as the first: a written **activation
condition** per capability (what has to be true to turn it on, and who decides).
Without one, "safe by default" quietly becomes "off forever".

## Current state

### The pattern to copy

`apps/api/src/routes/admin/system.ts:116-164` already implements exactly this shape
for external dependencies, including the correct handling of secrets:

```ts
systemRouter.get("/dependencies", async (c) => {
  if (depCache && Date.now() - depCache.at < DEP_CACHE_MS) {
    return c.json({ ...depCache.payload, cached: true });
  }

  const redisClient = getRedis();
  const r2Account = process.env.R2_ACCOUNT_ID;
  const resendKey = process.env.RESEND_API_KEY;
  ...
  const dependencies = await Promise.all([
    timedCheck("neon", !!process.env.DATABASE_URL, () => db.execute(sql`SELECT 1`)),
    timedCheck("upstash", !!redisClient, () => redisClient!.ping()),
    ...
  ]);

  const payload = { checkedAt: new Date().toISOString(), dependencies };
  depCache = { at: Date.now(), payload };
  return c.json({ ...payload, cached: false });
});
```

Note `!!process.env.X`: the endpoint reports **whether** a credential is configured
and never its value. Your new endpoint must hold that line absolutely. No env value,
no key prefix, no key length, no masked fragment ever appears in the response, in a
log line, or in a comment.

### Router mounting

`apps/api/src/routes/admin/index.ts` mounts every admin sub-router behind
`authMiddleware` then `adminMiddleware` (email allowlist, `ADMIN_EMAILS`). You are
adding a route to `systemRouter`, which is already mounted, so no wiring change is
needed.

### The tables that carry the behavioural evidence

All in `packages/db/src/schema/analytics.ts` unless noted. Column names below are
copied from the schema at this commit; **verify each one in the schema file before
writing its query** and drop any probe whose column does not exist rather than
guessing.

- `extraction_runs` (line 266): `resolution` (`structured | cache | heal |
  ai_fallback`), `aiUsed`, `recordedAt`. Staged extraction is live when rows exist
  with `resolution <> 'ai_fallback'`; if every row is `ai_fallback`, the pipeline is
  running on its floor, which reads as "on" but behaves as "off".
- `backfill_runs` (line 287): `outcome`, `recordedAt`.
- `platform_detection_runs` (line 343): `stage`, `recordedAt`.
- `ai_visibility_results` (line 140): `orgId`, `engine`, `mentioned`, and a
  timestamp column (confirm its name in the schema).
- `packages/db/src/schema/signals.ts:69` — `faithfulness: jsonb("faithfulness")`,
  documented as "Null for medium/low signals (out of scope) **and when the gate is
  off**". A non-null row in the window is proof the gate ran.
- `packages/db/src/schema/standing-queries.ts:72,76` — `lastEvaluatedAt`,
  `isActive`. Active queries with a null `lastEvaluatedAt` are the dormant case.
- `packages/db/src/schema/share-links.ts:23,32` — `type`, `revokedAt`.
- `packages/db/src/schema/crm-destinations.ts`, `ask-history.ts`,
  `saved-views.ts`, `signal-comments.ts`, and the `passkey` table in
  `packages/db/src/schema/auth.ts`. Confirm the column names in each file.

### Conventions that apply

- **Every analytics read goes through `analyticsQuery`** from
  `apps/api/src/lib/analytics-safe.ts`, which returns `[]` on any error so a broken
  read never 500s a handler. The relational reads may use `db` directly, matching
  what `system.ts` already does.
- **Hono handlers never throw naked** (`apps/api/CLAUDE.md`): always respond JSON.
- `apps/api/src/routes/admin/system.ts` uses a module-level cache
  (`depCache`, `DEP_CACHE_MS`) so the admin page does not hammer the database.
  Follow the same approach; this readout runs a dozen counting queries.
- **English only** for anything user-visible (`.claude/rules/language.md`).
- No em-dashes in prose you write; rephrase instead of substituting a hyphen.

## Commands you will need

| Purpose   | Command                            | Expected on success |
|-----------|------------------------------------|---------------------|
| Typecheck | `pnpm typecheck`                   | exit 0, 8 tasks     |
| Tests     | `pnpm test`                        | exit 0, all pass    |
| API tests | `pnpm --filter @outrival/api test` | exit 0              |

**Environment gotcha**: `turbo` is not on `PATH`; a bare `turbo typecheck` prints
`turbo: command not found` and reads as silence when piped. Use the `pnpm` scripts.

**Do not run `pnpm build`**: a full web build exhausts RAM on the WSL2 dev box.

## Scope

**In scope**:
- `apps/api/src/routes/admin/system.ts` (add the endpoint)
- `apps/api/test/` — one new test file, named to match the existing convention in
  that directory
- `apps/web/src/lib/api.ts` (response type and fetch method only)
- `apps/web/src/app/(admin)/admin/system/page.tsx` (render the readout)
- `docs/capability-activation.md` (create)

**Out of scope** (do NOT touch, even though they look related):
- Every capability's own gate. This plan changes no switch, turns nothing on, and
  removes no flag. It reports. Flipping a switch is a separate decision per
  capability, which is exactly what the new doc is for.
- `packages/ai/src/faithfulness/gate.ts` — plan 017 owns the faithfulness gate's
  enablement decision. Report its liveness here; do not pre-empt that plan.
- `apps/api/src/routes/admin/index.ts` — the router is already mounted.
- Any new table, column or migration. If a capability has no existing trace to probe,
  omit it from the readout and list it in the doc as "not observable", rather than
  adding a write path.
- `packages/shared/src/feature-flags.ts` and
  `packages/shared/src/constants/plans.ts`. `multiUser` and `api` are deliberately
  false, with the decision recorded in `docs/paid-feature-delivery.md`. Read them,
  do not change them.

## Git workflow

- Branch: `advisor/021-capability-liveness`
- Conventional Commits, subject at most 50 chars, imperative. Example from
  `git log`: `feat(web): rebuild Products around the portfolio (#255)`.
  Suggested: `feat(api): report which capabilities are live`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add GET /capabilities to the system router

In `apps/api/src/routes/admin/system.ts`, after the `/dependencies` handler (which
ends at line 164), add `systemRouter.get("/capabilities", ...)`.

For each capability, return one object:

```ts
{
  key: string;          // stable id, e.g. "archive_backfill"
  label: string;        // human label for the admin page
  observable: boolean;  // false when there is no trace to probe
  live: boolean;        // true when the probe found activity in the window
  count: number;        // rows the probe matched (0 when not live)
  note: string | null;  // one short sentence when the state needs explaining
}
```

Probe each of these over a **30-day** window, using `count(*)` only. Never select
row contents; this endpoint returns counts, not data.

| key | probe |
|---|---|
| `archive_backfill` | `backfill_runs` rows in the window |
| `staged_extraction` | `extraction_runs` rows in the window with `resolution <> 'ai_fallback'`; when total rows exist but all are `ai_fallback`, set `live: false` and note that the pipeline is running on its AI floor |
| `platform_detection` | `platform_detection_runs` rows in the window |
| `ai_visibility` | `ai_visibility_results` rows in the window |
| `faithfulness_gate` | `signals` in the window with `faithfulness IS NOT NULL` |
| `standing_queries` | `standing_queries` with `is_active` true and `last_evaluated_at` not null; note the count of active-but-never-evaluated separately, since that is the dormant-secret symptom |
| `share_links` | `share_links` with `revoked_at IS NULL` |
| `crm_webhook` | enabled `crm_destinations` rows |
| `ask` | `ask_history` rows in the window |
| `signal_comments` | `signal_comments` rows in the window |
| `saved_views` | `saved_views` rows (no window, they are durable) |
| `passkeys` | `passkey` rows (no window) |

Add two non-probed entries so the readout is complete rather than merely convenient:

- `visual_diff`: read `process.env.VISUAL_DIFF_ENABLED !== "false"`. This one is
  genuinely API-side (`apps/api/src/routes/signals.ts:601`), so the env read is
  correct here.
- `multi_user`: read `FEATURE_FLAGS.multiUser` from `@outrival/shared`, with a note
  that it is deliberately off per `docs/paid-feature-delivery.md`.

Cache the payload the way `/dependencies` does, with its own cache variable and a
TTL of at least 60 seconds.

**Absolute constraint**: no environment variable **value** may appear in the
response, in a log, or in a comment. Booleans and counts only.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Test the endpoint against an empty database

Read an existing route test in `apps/api/test/` first and copy its harness setup
(the API tests run on PGlite). Add one file covering:

- **empty database** → the endpoint returns 200 with every capability present and
  `live: false`. It must not throw, and the array length must equal the number of
  capabilities you defined.
- **one row seeded into `backfill_runs` inside the window** → `archive_backfill` is
  `live: true` with `count: 1`.
- **`extraction_runs` seeded with only `ai_fallback` rows** → `staged_extraction` is
  `live: false` with a non-null `note`. This is the case that distinguishes a real
  readout from a row counter, so do not skip it.
- **response contains no env values** → assert the serialized JSON does not contain
  any substring of a known env value you set in the test (set a fake
  `VISUAL_DIFF_ENABLED` and assert only the boolean surfaces).

**Verify**: `pnpm --filter @outrival/api test` → exit 0, 4 new cases pass.

### Step 3: Render it on /admin/system

Add the response type and fetch method to `apps/web/src/lib/api.ts` next to the
other admin types, then render the list on
`apps/web/src/app/(admin)/admin/system/page.tsx` as a table: label, live indicator,
count, note. Match the existing card and status styling on that page; do not add a
charting library or a new component kit.

`apps/web/src/lib/api.ts` is 3411 lines and the highest-churn file in the repo. Add
your type and method next to the existing admin members and reorganize nothing.

**Verify**: `pnpm typecheck` → exit 0.

### Step 4: Write the activation conditions

Create `docs/capability-activation.md`. One section per capability in the readout,
each answering four questions in at most four lines:

1. **What turns it on** (env var name, key name, plan flag, or build arg). Names
   only, never values.
2. **Which service** owns that variable (api, workers, web build). This matters:
   the workers read a separate `.env` on a VPS that is not managed by Coolify, so a
   variable set on the API does nothing for a worker-side capability.
3. **The activation condition**: what has to be true before turning it on. Be
   concrete. For the faithfulness gate, that condition already exists and is
   written in `docs/architecture.md`: the eval must pass and the pool must be
   healthy, because the judge's false-block rate is a property of the model, not the
   code. For passkeys it is a real-device check on staging.
4. **Who decides, and by when.** If the honest answer is "no date", write "no date
   set", not a fabricated one.

Add one line at the top stating that the readout at `/admin/system` shows current
liveness, and that a capability listed here as intentionally off is a decision, not
a bug.

Link the new doc from `docs/architecture.md` in the same style as the existing
`📄 docs/<file>.md` references used throughout that file.

**Verify**: `grep -n "capability-activation" docs/architecture.md` returns one match.

## Test plan

- 4 new cases in a new `apps/api/test/` file (step 2), modeled structurally on an
  existing route test in the same directory.
- No worker tests: this plan writes no worker code.
- Verification: `pnpm test` → exit 0, including the 4 new cases.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0, with 4 new passing cases for `/capabilities`
- [ ] `GET /api/admin/capabilities` returns one entry per capability listed in step 1
- [ ] The response contains no environment variable value (verified by the test in
      step 2 and by reading the handler)
- [ ] `/admin/system` renders the capability table
- [ ] `docs/capability-activation.md` exists, covers every capability in the
      readout, and answers all four questions for each
- [ ] `docs/architecture.md` links the new doc
- [ ] `git status` shows no modified file outside the in-scope list
- [ ] `plans/README.md` status row for 021 updated

## STOP conditions

Stop and report back (do not improvise) if:

- A probe needs a column that does not exist in the schema file cited above. Drop
  that capability from the readout, mark it `observable: false` in the doc, and
  report it; do not add a column or a write path.
- `apps/api/src/routes/admin/system.ts:116-164` does not match the excerpt (the
  dependencies endpoint moved or changed shape).
- A probe requires reading a worker-only environment variable to be meaningful. That
  is the exact failure mode this plan exists to avoid; report it instead of reading
  the API's copy of the variable.
- You find yourself about to change any capability's gate. That is out of scope for
  this plan without exception.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- **When a new optional capability ships, it gets a row here.** That is the point of
  the plan. A reviewer should treat a new env-gated capability without a
  `docs/capability-activation.md` entry as an incomplete change.
- Behavioural probes drift as capability internals change. The one to watch is
  `staged_extraction`: it depends on the `resolution` vocabulary in
  `extraction_runs`, which is owned by `apps/workers/src/lib/staged-extract.ts`. A
  new resolution value there needs the probe updated, or the readout starts lying.
- Counting queries over 30 days on `signals` and `extraction_runs` grow with usage.
  The cache from step 1 is what keeps this cheap; if the page gets slow, raise the
  TTL before adding indexes.
- Deliberately deferred: alerting when a capability goes from live to dark. That
  needs a stored history of the readout, so it is its own plan. `ops-health-check`
  is the natural host if it is ever wanted.
