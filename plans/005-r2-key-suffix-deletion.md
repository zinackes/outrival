# Plan 005: Retention purge and GDPR erasure actually delete the R2 objects

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 74888f6..HEAD -- apps/workers/src/core/purge-retention.ts apps/api/src/lib/erase-org.ts apps/workers/src/core/scrape-monitor.ts`
> If any of those changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED (this plan makes deletions start happening that never happened before)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `74888f6`, 2026-07-25

## Why this matters

Snapshot rows store an R2 key **without a file extension**. The uploader appends
`.html` and `.png`; every reader appends `.html` when fetching. But both deletion
paths try to derive the PNG key with `key.replace(/\.html$/, ".png")`, and since
the stored key never ends in `.html`, the regex never matches.

The result is that both paths build a list of `[key, key]`: the same
extensionless string twice, which is not an object in the bucket. Neither
`${key}.html` nor `${key}.png` is ever deleted.

Three consequences, all currently invisible:

1. **R2 storage grows without bound.** The `PLAN_LIMITS.historyRetentionDays`
   promise is enforced in Postgres only; the blobs the rows pointed at stay
   forever.
2. **GDPR erasure leaves customer data in the bucket.** `eraseOrg` deletes the
   relational rows and the battle-card PDFs (those store a full key, so they
   work), but every captured competitor page and screenshot belonging to a
   deleted organisation remains.
3. **The metric lies.** `purge-retention` increments `r2Deleted` by
   `r2Keys.length`, so it reports a deletion count that is entirely fabricated,
   which is why nobody has noticed.

## Current state

### The key is written without an extension (`apps/workers/src/core/scrape-monitor.ts:908`)

```ts
const r2Key = `snapshots/${competitor.id}/${monitor.sourceType}/${timestamp}`;
```

### The uploads append extensions (`scrape-monitor.ts:910` and `:915`)

```ts
await uploadToR2(`${r2Key}.html`, result.html, "text/html; charset=utf-8", {
...
  await uploadToR2(`${r2Key}.png`, result.screenshotBuffer, "image/png");
```

### The row stores the bare key (`scrape-monitor.ts:1002`)

```ts
        r2Key,
```

### Every reader appends `.html` — four sites, all consistent

```
apps/workers/src/core/scrape-monitor.ts:863   getFromR2(`${lastSnapshot.r2Key}.html`)
apps/workers/src/core/scrape-monitor.ts:1387  getFromR2(`${lastSnapshot.r2Key}.html`)
apps/workers/src/core/scrape-monitor.ts:1452  getFromR2(`${lastSnapshot.r2Key}.html`)
apps/workers/src/core/scrape-monitor.ts:1568  getFromR2(`${lastSnapshot.r2Key}.html`)
apps/workers/src/core/scrape-monitor.ts:1633  getFromR2(`${lastSnapshot.r2Key}.html`)
```

So the convention is settled and correct: **stored key has no extension, callers
append one.** The bug is only in the two deleters.

### Deleter 1 (`apps/workers/src/core/purge-retention.ts:101-104`)

```ts
      const r2Keys = (purgedSnapshots as unknown as Array<{ r2_key: string }>)
        .map((r) => r.r2_key)
        .filter(Boolean)
        .flatMap((key) => [key, key.replace(/\.html$/, ".png")]);
```

### Deleter 2 (`apps/api/src/lib/erase-org.ts:97-101`)

```ts
    const keys = [
      ...snapKeys.map((r) => r.r2_key).filter(Boolean),
      ...snapKeys.map((r) => r.r2_key?.replace(/\.html$/, ".png")).filter(Boolean),
      ...cardKeys.map((r) => r.pdf_r2_key).filter(Boolean),
    ];
```

`cardKeys` (`pdf_r2_key`) stores a complete key including its extension, so that
third line is correct and must not change.

### A third suffix exists

`apps/workers/src/core/detect-review-theme-shifts.ts:140-141` writes an object
with a `.txt` suffix on the same key shape. Neither deleter attempts it.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Workers tests | `cd apps/workers && bun test test/` | all pass |
| API tests | `cd apps/api && bun test --timeout 60000 test/` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Whole suite | `pnpm test` | exit 0 |

Note: `turbo` is **not** on `PATH`. Use the `pnpm` scripts.

## Scope

**In scope** (the only files you should modify or create):
- `apps/workers/src/lib/r2-keys.ts` (create: the shared key-expansion helper)
- `apps/workers/src/lib/r2-keys.test.ts` (create) — or place the test under
  `apps/workers/test/` to match that package's `bun test test/` script; check
  which glob the package uses before choosing, and put it where it will run
- `apps/workers/src/core/purge-retention.ts` (use the helper)
- `apps/api/src/lib/erase-org.ts` (use the helper, or a local copy — see step 3)

**Out of scope** (do NOT touch, even though they look related):
- `apps/workers/src/core/scrape-monitor.ts`. The extensionless-key convention is
  deliberate and every reader depends on it. Do **not** "fix" this by storing the
  extension on the row: that would break all five `getFromR2` call sites and every
  historical row at once.
- `cardKeys` / `pdf_r2_key` handling in `erase-org.ts`. Those keys are complete
  and already delete correctly.
- The SQL that selects which snapshots to purge, and the retention windows. This
  plan changes only which R2 keys are derived from the rows already selected.
- Any attempt to write a one-off script that deletes the historical orphans.
  That is a separate operational decision with real blast radius; see Maintenance.

## Git workflow

- Branch: `fix/r2-purge-key-suffixes` off `main`.
- Commit message style, matching `git log`: `fix(workers): purge the real R2 objects`.
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Confirm the defect

```bash
grep -n 'const r2Key = ' apps/workers/src/core/scrape-monitor.ts
grep -n 'uploadToR2(`${r2Key}' apps/workers/src/core/scrape-monitor.ts
grep -n 'replace(/\\.html\$/' apps/workers/src/core/purge-retention.ts apps/api/src/lib/erase-org.ts
```

**Verify**: the stored key has no extension, the uploads add `.html`/`.png`, and
both deleters call the `.html` → `.png` replace. If the stored key now ends in
`.html`, STOP: the convention changed and this plan's premise is wrong.

### Step 2: Write the key-expansion helper, test first

Create `apps/workers/src/lib/r2-keys.ts` exporting one pure function:

```ts
/**
 * Snapshot rows store the R2 key WITHOUT an extension (see scrape-monitor.ts:908);
 * the uploader writes `${key}.html`, `${key}.png` and, for review-theme snapshots,
 * `${key}.txt`. Deletion has to reconstruct those, which is why this lives in one
 * place: the previous inline `key.replace(/\.html$/, ".png")` never matched, so no
 * snapshot object was ever deleted.
 *
 * Defensive on input: a key that already carries a known extension is returned as
 * itself, so a future row shape (or a battle-card PDF key passed here by mistake)
 * cannot produce `foo.pdf.html`.
 */
export function snapshotObjectKeys(storedKey: string): string[]
```

Behaviour to implement:

- `"snapshots/a/homepage/2026-01-01T00:00:00Z"` returns exactly three keys,
  with the `.html`, `.png` and `.txt` suffixes.
- A key that already ends in `.html`, `.png`, `.txt` or `.pdf` returns `[storedKey]`.
- An empty or whitespace-only string returns `[]`.

Write the test **before** the implementation, in whichever location the
`apps/workers` test script actually globs (check `package.json`; it is
`bun test test/`, so `apps/workers/test/r2-keys.test.ts` is the safe choice).
Model it on any existing pure-function test in that directory.

**Verify**: `cd apps/workers && bun test test/` passes, including the new cases.

### Step 3: Use the helper in both deleters

In `apps/workers/src/core/purge-retention.ts`, replace the `.flatMap(...)` with
`.flatMap(snapshotObjectKeys)`.

In `apps/api/src/lib/erase-org.ts`, replace the first two spread lines with a
single flatMap over `snapshotObjectKeys`, leaving the `cardKeys` line untouched.

**Important layering note**: `apps/api` may import `@outrival/db`, `@outrival/ai`,
`@outrival/shared` and `@outrival/queue`. It may **not** import `@outrival/workers`.
So `apps/api` cannot import the helper from `apps/workers/src/lib/`. Choose one:

- **(a)** Put the helper in `packages/shared` and import it from both. This is the
  cleaner end state and matches how `escapeHtml` and the webhook signer are shared.
- **(b)** Keep it in `apps/workers` and write a small local copy in `apps/api`,
  with a comment pointing at the other.

Prefer **(a)**. If you take (a), the file path in "In scope" changes to
`packages/shared/src/r2/keys.ts` plus its colocated test (`packages/shared` runs
`bun test src`), and both apps import it. Say which option you took in your report.

**Verify**: `pnpm typecheck` exits 0.

### Step 4: Make the purge metric honest

`purge-retention.ts` increments `r2Deleted += r2Keys.length` after
`deleteManyFromR2`. With the fix, that count becomes the number of keys
*attempted*, which for R2 is still not the number of objects that existed
(`DeleteObjects` treats a missing key as a no-op success).

Do the minimum: leave the counter, and adjust the surrounding log or comment so
it reads as "keys attempted", not "objects deleted". Do not add a HEAD-per-key
existence check; that is one request per object on a purge path.

**Verify**: `pnpm typecheck` exits 0.

### Step 5: Full-suite check

**Verify**: `pnpm typecheck` exits 0 and `pnpm test` exits 0.

## Test plan

New tests for `snapshotObjectKeys`, covering:

- happy path: extensionless snapshot key expands to `.html`, `.png`, `.txt`
- idempotence: a key already ending `.html` / `.png` / `.txt` / `.pdf` is returned unchanged
- empty and whitespace-only input returns `[]`
- **the regression itself**: assert that the output for a realistic stored key
  (`snapshots/<uuid>/homepage/<iso>`) does **not** contain that bare key, which
  is precisely what the old code produced twice

Structural pattern: any existing pure-helper test in `apps/workers/test/`, or
`packages/shared/src/constants/plans.test.ts` if you took option (a).

Verification: `cd apps/workers && bun test test/` (and
`cd packages/shared && bun test src` if applicable) all pass; `pnpm test` exit 0.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -rn 'replace(/\\.html\$/' apps/workers/src apps/api/src` returns no matches
- [ ] A `snapshotObjectKeys` (or equivalently-named) helper exists with tests that
      cover the four cases above, and they pass
- [ ] Both `purge-retention.ts` and `erase-org.ts` derive keys through it
- [ ] `erase-org.ts` still passes `cardKeys` / `pdf_r2_key` through unchanged
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The stored `r2Key` at `scrape-monitor.ts:908` now includes an extension. The
  convention changed; this plan's premise is void.
- You conclude the right fix is to store the extension on the snapshot row.
  It is not, for this plan: every historical row lacks it and all five reader
  sites append `.html`. Report the idea rather than doing it.
- `deleteManyFromR2` turns out to throw on a key that does not exist, rather
  than no-op. Then enabling real deletion could start failing purges for
  historical rows whose `.txt` object was never written. Report the semantics
  you found before proceeding.
- You are tempted to write a backfill script that deletes the accumulated
  orphaned objects. Do not. That is an irreversible bulk delete against
  production storage and needs an operator decision, a dry-run count, and a
  bucket backup posture. Report the need; it is explicitly deferred.

## Maintenance notes

- **The historical orphans are not cleaned by this plan.** Every snapshot object
  ever purged from Postgres is still in R2 and now unreferenced (the rows that
  pointed at them are gone). Recovering that space needs a deliberate operational
  pass: list the bucket, diff against live `snapshots.r2_key` values, and delete
  the remainder with a dry run first. Flag it to the operator with an estimated
  object count rather than doing it here.
- **Watch the first purge run after deploy.** This change makes a delete path
  that has been a no-op since it was written start actually removing objects.
  The reviewer should confirm the retention SQL selects what they expect
  *before* this ships, because the SQL has never had a real consequence until now.
- If a fourth object suffix is ever written against a snapshot key, add it to the
  helper and its test. That single location is the point of extracting it.
- The `.txt` suffix comes from `detect-review-theme-shifts.ts:140-141`. If that
  writer changes, the helper needs to change with it.
