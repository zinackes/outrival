# Plan 015: Public share links expire and report when they were last read

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 74888f6..HEAD -- packages/db/src/schema/share-links.ts apps/api/src/routes/share.ts apps/api/src/routes/public-report.ts`
> If any changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P2
- **Effort**: S-M (includes a database migration)
- **Risk**: MED (an expiry default can kill links customers are actively using)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `74888f6`, 2026-07-25

## Why this matters

`GET /api/public/report/:token` is the only unauthenticated data-egress surface
in the product. It resolves a token to an organisation and returns that org's
full competitive landscape (competitors, pricing, hiring, reviews, AI insights)
or a monthly recap, with no session.

The capability is well built in most respects: the token is unguessable
(128-bit, server-generated, unique-indexed), the row is created only on an
explicit user action, revocation is soft so a revoked link stays dead, and the
public route is excluded from indexing.

What it lacks is **time**. The `share_links` table has `revokedAt` but no
`expiresAt`, no `lastAccessedAt` and no access counter. So:

- A link pasted once into a prospect thread, a Slack channel or a forwarded email
  is a permanent read capability over the org's competitive intelligence, until
  a human remembers to revoke it in settings.
- The owner has no signal that a link is still being read, so there is nothing to
  prompt that revocation.
- The response is served with `Cache-Control: public, max-age=300`, so an
  intermediary may keep serving it briefly even after revocation.

This is a bounded, quiet risk rather than an active defect. The fix is a small
migration plus one predicate.

## Current state

### The table (`packages/db/src/schema/share-links.ts`)

```ts
export const shareLinks = pgTable(
  "share_links",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("landscape"),
    productId: text("product_id").references(() => products.id, { onDelete: "cascade" }),
    meta: jsonb("meta"),
    token: text("token").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    // Revocation is soft: keep the row so a revoked link stays dead even if re-shared.
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("share_links_token_uq").on(t.token),
    index("share_links_org_idx").on(t.orgId),
  ],
);
```

The file's own header comment states the design intent, and it is worth
preserving as you extend it:

```
// Public read-only share links (Lever 8, docs/post-onboarding-activation.md). An
// unguessable, revocable token per shared artifact → a public Next route renders a
// static branded view ("Powered by Outrival" → acquisition loop). Default OFF: a row
// exists only after an explicit user "Share" action. Org-scoped and revocable
// (revoked_at); the public resolver rejects revoked/absent tokens. No index / no
// sitemap (the token is the only capability).
```

### The resolver (`apps/api/src/routes/public-report.ts`)

- `:16` `publicReportRouter.get("/:token", ...)`
- `:19-21` bounds the token length before touching the database
- `:27` matches on `token` plus `isNull(revokedAt)`
- `:34` sets `Cache-Control: public, max-age=300`
- `:37-57` dispatches on `kind` to `buildLandscape` or `buildMonthlyRecap`

Mounted outside `authMiddleware`, deliberately (`apps/api/src/index.ts:119-120`).

### The minting route (`apps/api/src/routes/share.ts`)

- `:23-25` generates the token
- `:36` decides the type
- `:52`, `:78`, `:105`, `:123` all filter on `isNull(revokedAt)`
- creation is idempotent: re-posting returns the existing live token

### Migration conventions

Schema changes go through versioned Drizzle migrations:
edit `packages/db/src/schema/*`, run `pnpm db:generate` (produces
`packages/db/migrations/NNNN_*.sql` plus a snapshot, both committed), then
`pnpm db:migrate` locally. `db:push` is forbidden on any shared environment.

There are 52 migrations at `74888f6`, and
`packages/db/test/migrations.test.ts` asserts journal, SQL and snapshot stay in
correspondence, so a hand-edited migration will fail the suite.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Generate migration | `pnpm db:generate` | new `NNNN_*.sql` + snapshot |
| Apply locally | `pnpm db:migrate` | exit 0 |
| DB tests | `cd packages/db && bun test --timeout 20000 test/` | all pass |
| API tests | `cd apps/api && bun test --timeout 60000 test/` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Whole suite | `pnpm test` | exit 0 |

Note: `turbo` is **not** on `PATH`. Use the `pnpm` scripts.

**Never run `pnpm db:push`.** It leaves no versioned trace and is forbidden on
shared environments.

## Scope

**In scope** (the only files you should modify or create):
- `packages/db/src/schema/share-links.ts` (add columns)
- `packages/db/migrations/NNNN_*.sql` + snapshot (generated, never hand-written)
- `apps/api/src/routes/public-report.ts` (expiry predicate + access stamp)
- `apps/api/src/routes/share.ts` (set `expiresAt` on create; expose the fields)
- `apps/api/test/share-links.test.ts` (create)
- The settings "Shared reports" list component (surface expiry and last-read)

**Out of scope** (do NOT touch, even though they look related):
- The token generation scheme. 128 bits, server-generated, unique-indexed: fine.
- Soft revocation. Keep `revokedAt` exactly as it is; expiry is additive.
- Putting the route behind auth. It is a public capability by design.
- `buildLandscape` / `buildMonthlyRecap`. This plan changes access control, not
  the payload.
- Adding a `battle_card` share type. Separate feature, separate decision.
- Reducing the 300-second cache window. Related to revocation latency, but
  changing it affects load; note it rather than doing it.

## Git workflow

- Branch: `feat/share-link-expiry` off `main`.
- Commit message style, matching `git log`: `feat(share): expire public report links`.
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Confirm the gap

```bash
grep -n "expiresAt\|lastAccessedAt\|revokedAt" packages/db/src/schema/share-links.ts
grep -n "isNull" apps/api/src/routes/public-report.ts
```

**Verify**: only `revokedAt` exists, and the resolver filters on it alone. If
`expiresAt` already exists, STOP.

### Step 2: Add the columns

Add to the schema, all nullable so the migration is additive and cannot fail on
existing rows:

- `expiresAt: timestamp("expires_at")` — null means no expiry (legacy rows)
- `lastAccessedAt: timestamp("last_accessed_at")`
- `accessCount: integer("access_count").notNull().default(0)`

Extend the file's header comment to say that a link now carries a lifetime and
that null means "legacy, no expiry", so the next reader is not left guessing.

```bash
pnpm db:generate
```

**Verify**: exactly one new `NNNN_*.sql` appears plus its snapshot; open the SQL
and confirm it is three `ADD COLUMN` statements with no `NOT NULL` on the two
timestamps and no destructive statement. Then `pnpm db:migrate` locally and
`cd packages/db && bun test --timeout 20000 test/` passes (the journal and
snapshot correspondence test).

### Step 3: Enforce expiry in the resolver

In `public-report.ts`, extend the lookup predicate so a row matches only when it
is not revoked **and** (`expiresAt` is null **or** `expiresAt > now()`).

Keep the existing not-found behaviour identical: an expired link must be
indistinguishable from an unknown one. Do not add a distinct "expired" response;
that tells an unauthenticated caller that a token was once valid.

Be careful with time comparison. The timestamp columns in this schema are
`timestamp without time zone` holding UTC, and there is a known hazard elsewhere
in this codebase where a bare `now()` (which is `timestamptz` in the session's
zone) is compared against such a column. If you compare in SQL, coerce with
`(now() AT TIME ZONE 'UTC')`, matching the pattern used in `activity.ts`.
If you compare in JavaScript, use a `Date` and let Drizzle bind it.

**Verify**: `pnpm typecheck` exits 0.

### Step 4: Set a lifetime at mint time

In `share.ts`, set `expiresAt` when a link is created. Put the default in a named
constant with a comment explaining the reasoning, not a bare number.

Suggested default: **90 days**. Long enough for a sales cycle, short enough that
an abandoned link does not outlive the deal. Say what you chose and why.

Watch the idempotent create path: re-posting returns the existing live token. Do
**not** silently extend an existing link's expiry on re-share unless you decide
that is the desired behaviour, and if you do, say so.

**Verify**: `pnpm typecheck` exits 0.

### Step 5: Record access

In `public-report.ts`, after a successful resolve, update `lastAccessedAt` and
increment `accessCount`.

Make it best-effort: a failure to record an access must never fail the response.
That matches how the rest of this codebase treats analytics writes. Do not add a
blocking write to a public read path.

**Verify**: `pnpm typecheck` exits 0.

### Step 6: Surface it in settings

The "Shared reports" list in settings currently shows links and a revoke action.
Add, per row: when it expires (or "no expiry" for legacy rows) and when it was
last read (or "never read").

Keep the copy English and in the product's register. Reuse the existing date
formatting helpers rather than introducing a new one, and follow the repo's
date-display conventions.

**Verify**: `pnpm typecheck` exits 0. Note in your report that the UI itself was
not exercised (no web build on this box).

### Step 7: Test it

Create `apps/api/test/share-links.test.ts`, using the existing harness and its
mock-then-dynamic-import ordering.

Cases:

1. Mint a link, fetch it: 200.
2. Revoke it, fetch it: 404 (the existing behaviour, previously untested).
3. **The new regression**: a link with `expiresAt` in the past returns 404.
4. A legacy link with `expiresAt` null still resolves (backwards compatibility).
5. An unknown token returns 404.
6. An out-of-bounds token length returns 404 without a database hit.
7. Re-posting a create request returns the same token (idempotence).

This route has **zero** test coverage today, so these cases are worth more than
the expiry feature itself: they pin the revocation predicate that is the only
thing standing between a revoked link and permanent unauthenticated access.

**Verify**: `cd apps/api && bun test --timeout 60000 test/` passes, whole
directory.

### Step 8: Full check

**Verify**: `pnpm typecheck` exits 0 and `pnpm test` exits 0.

## Test plan

- `apps/api/test/share-links.test.ts` with the seven cases above. Case 2
  (revoked returns 404) and case 3 (expired returns 404) are the two that matter:
  a dropped predicate on either silently resurrects public access to another
  org's competitive data.
- Structural pattern: an existing harness-based route test under `apps/api/test/`.
- Verification: `cd apps/api && bun test --timeout 60000 test/` all pass;
  `cd packages/db && bun test --timeout 20000 test/` all pass; `pnpm test` exit 0.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c "expiresAt" packages/db/src/schema/share-links.ts` returns at least 1
- [ ] Exactly one new migration file exists, generated by `pnpm db:generate`,
      containing only additive `ADD COLUMN` statements
- [ ] `cd packages/db && bun test --timeout 20000 test/` exits 0
- [ ] `apps/api/src/routes/public-report.ts` filters on both `revokedAt` and `expiresAt`
- [ ] An expired link and an unknown link return the identical response
- [ ] `apps/api/test/share-links.test.ts` exists with the seven cases and passes
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0
- [ ] `grep -rn "db:push" ` was never run against a shared environment
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `pnpm db:generate` produces a migration containing anything other than additive
  `ADD COLUMN` statements. A drop or a type change on this table is not what this
  plan asks for.
- You are tempted to backfill `expiresAt` on existing rows. **Do not.** Every
  existing link is one a customer may have shared and may be relying on;
  expiring them retroactively breaks live links with no warning. Null means
  legacy-no-expiry, and step 6 surfaces that so an owner can revoke deliberately.
- The migration cannot be applied locally because no local database is
  configured. Report it rather than running `db:push`.
- The idempotent create path turns out to return revoked or expired links.
  That would be a separate bug; report it.
- Making the response for expired links distinct from unknown ones seems more
  helpful. It is not: it leaks that a token was once valid.

## Maintenance notes

- **Existing links keep no expiry, on purpose.** The migration is additive and
  null-permitting so nothing in flight breaks. If the operator later wants a
  cutoff for legacy links, that is a deliberate, announced data change, not a
  side effect of this plan.
- **Revocation latency is unchanged.** The 300-second public cache means a
  revoked or expired link may still be served briefly by an intermediary. If that
  window matters, shortening it is a one-line change with a load tradeoff, and it
  should be decided on its own.
- **`lastAccessedAt` is the feature that will actually get links revoked.** An
  owner who can see "last read 3 days ago" on a link from a closed deal will
  revoke it. Expiry is the backstop; visibility is the mechanism.
- **The `type` column anticipates `battle_card`.** If that ships, note that a
  battle card carries the org's own positioning and objection handling, which is
  more sensitive than a landscape snapshot; a shorter default lifetime would be
  justified there.
- A reviewer should confirm that the expired and unknown responses are byte-identical.
