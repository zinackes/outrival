# Plan 020: Green the `apps/api` suite — the env test never learned about the production `TURNSTILE_SECRET_KEY` invariant

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving on. If anything in "STOP
> conditions" occurs, stop and report. When done, update this plan's row in
> `plans/README.md` unless a reviewer maintains the index.
>
> **Drift check (run first)**: `git show HEAD:apps/api/src/env.ts | grep -n TURNSTILE_SECRET_KEY`
> You should see the field declared **and** a `NODE_ENV === "production" && !e.TURNSTILE_SECRET_KEY`
> refine. If the `TURNSTILE_SECRET_KEY` production refine is **gone** from `env.ts`, the
> premise of this plan has changed — STOP and report (the test may already be correct).

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: —
- **Blocks**: plans/006-ci-and-honest-test-cache.md (006 cannot wire CI to a red suite)
- **Category**: tests / correctness
- **Planned at**: commit `1613188` (`origin/main`), 2026-07-08

## Why this matters

`pnpm test` is **red on `main` right now** — one deterministic failure in
`apps/api/test/env.test.ts`. It's masked today because there is no CI and turbo caches
test exit codes (both being fixed by plan 006). But plan 006 can't turn `pnpm test` into
a real gate while the suite is already failing, so this must land first.

Root cause is a stale test, not a bug in the code. `apps/api/src/env.ts` enforces **two**
production boot-time invariants via `superRefine`: Upstash creds must be present, **and**
`TURNSTILE_SECRET_KEY` must be present (added later, same rationale — a missing secret
silently disables a security control in prod, so the API should crash at boot instead of
running insecure). The env test was written when only the Upstash invariant existed. Its
"valid production config parses" case sets the Upstash creds but **not**
`TURNSTILE_SECRET_KEY`, so the second refine now fires and the schema fails to parse —
the case expects `success: true` and gets `false`.

The **code is correct and must not be relaxed** (`.claude/rules/production.md`: "Les env
boot-bloquants en prod (Upstash via env.ts superRefine) le restent — ne pas relâcher").
The fix is to teach the test about the Turnstile invariant: make the "parses" fixture a
*fully* valid production config, and add the symmetric negative case that was never
written (this is the coverage that would have caught the drift).

## Current state (as on `origin/main` `1613188`)

`apps/api/src/env.ts` — the schema declares `TURNSTILE_SECRET_KEY` and enforces it in
production (verbatim, the relevant parts):

```ts
    TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  })
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === "production" && (!e.UPSTASH_REDIS_REST_URL || !e.UPSTASH_REDIS_REST_TOKEN)) {
      ctx.addIssue({ /* Upstash required in production */ });
    }
    if (e.NODE_ENV === "production" && !e.TURNSTILE_SECRET_KEY) {
      ctx.addIssue({ /* TURNSTILE_SECRET_KEY required in production */ });
    }
  });
```

`apps/api/test/env.test.ts` — the failing case (verbatim):

```ts
  test("production WITH both Upstash creds parses", () => {
    const r = EnvSchema.safeParse({
      ...base,
      NODE_ENV: "production",
      UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "tok",
    });
    expect(r.success).toBe(true);
  });
```

This fixture omits `TURNSTILE_SECRET_KEY`, so under the current `env.ts` it parses to
`success: false` → the `toBe(true)` assertion fails. The other cases in the file
(`WITHOUT Upstash fails`, `only the URL … still fails`, dev/test parse) are unaffected.

Running it in isolation reproduces deterministically:
```
cd apps/api && bun test test/env.test.ts
# → 1 fail: "production WITH both Upstash creds parses" — expected true, received false
```

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install deps (fresh worktree) | `pnpm install --frozen-lockfile` | exit 0 |
| Run just this suite | `cd apps/api && bun test test/env.test.ts` | all tests pass, 0 fail |
| Run the whole api suite | `cd apps/api && bun test --timeout 60000 test/` | 0 fail |
| Typecheck api | `pnpm typecheck --filter @outrival/api` | exit 0 |

## Scope

**In scope**:
- `apps/api/test/env.test.ts` **only**.

**Out of scope**:
- `apps/api/src/env.ts` — the production invariant is intentional; do **not** weaken or
  remove the `TURNSTILE_SECRET_KEY` refine to make the old fixture pass. That is a STOP
  condition if you feel tempted.
- Any other test or source file.
- Wiring CI / turbo cache — that's plan 006, which runs after this.

## Git workflow

- Branch: `advisor/020-fix-api-env-turnstile-test`
- One commit (conventional): `test(api): assert the production TURNSTILE_SECRET_KEY env invariant`
- Do NOT push.

## Steps

### Step 1: Make the "valid production config" fixture actually valid

In `apps/api/test/env.test.ts`, the case `"production WITH both Upstash creds parses"`
represents a *complete, valid* production config — so it must also set the now-required
`TURNSTILE_SECRET_KEY`. Add that one field to the object passed to `safeParse`:

```ts
  test("production WITH both Upstash creds parses", () => {
    const r = EnvSchema.safeParse({
      ...base,
      NODE_ENV: "production",
      UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "tok",
      TURNSTILE_SECRET_KEY: "turnstile-secret",
    });
    expect(r.success).toBe(true);
  });
```

Do not rename the test or change its assertion — only add the missing field.

### Step 2: Add the missing symmetric negative case

The file already asserts the Upstash invariant from both sides (present → parses, absent
→ fails) but never asserts the Turnstile invariant's failure side — the exact gap that
let this drift. Add one case, mirroring the existing `"production WITHOUT Upstash fails"`
pattern, inside the same `describe(...)` block (place it right after the
`"production WITH both Upstash creds parses"` test):

```ts
  test("production with Upstash but no Turnstile secret fails", () => {
    const r = EnvSchema.safeParse({
      ...base,
      NODE_ENV: "production",
      UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "tok",
      // TURNSTILE_SECRET_KEY intentionally omitted — must fail to parse
    });
    expect(r.success).toBe(false);
  });
```

Follow the file's existing style exactly (2-space indent, `test(...)` from `bun:test`,
the shared `base` fixture). Do not add a new `import` — everything needed is already
imported at the top of the file.

**Verify**: `cd apps/api && bun test test/env.test.ts` → the suite passes with **0
failures** and the new test count is one higher than before (6 tests in the describe
block, all green).

### Step 3: Confirm the whole api suite and typecheck are green

```
cd apps/api && bun test --timeout 60000 test/    # 0 fail
```
(from repo root) `pnpm typecheck --filter @outrival/api` → exit 0.

## Test plan

- This plan *is* a test-only change. The two edits above are the test plan: one fixes the
  stale positive case, one adds the missing negative case. No source code changes, so no
  new source behavior to characterize.

## Done criteria

ALL must hold:

- [ ] `cd apps/api && bun test test/env.test.ts` → **0 failures** (previously 1)
- [ ] The `"production WITH both Upstash creds parses"` fixture now includes `TURNSTILE_SECRET_KEY`
- [ ] A new negative case asserts a production config missing `TURNSTILE_SECRET_KEY` fails to parse
- [ ] `cd apps/api && bun test --timeout 60000 test/` → 0 failures
- [ ] `pnpm typecheck --filter @outrival/api` → exit 0
- [ ] Only `apps/api/test/env.test.ts` is modified (`git status` shows exactly that one file)
- [ ] `apps/api/src/env.ts` is **unchanged**
- [ ] `plans/README.md` status row updated (unless a reviewer maintains the index)

## STOP conditions

Stop and report if:

- The drift check shows the `TURNSTILE_SECRET_KEY` production refine is gone from
  `env.ts` (premise changed — the test may already be correct).
- After Step 1+2, `apps/api/test/env.test.ts` still fails — there is a **second**,
  independent failing assertion beyond the Turnstile one; report the exact failure, do
  not chase it here.
- The full api suite (`bun test test/`) reveals additional failing files unrelated to
  `env.test.ts` — report them (they are separate pre-existing failures; this plan only
  owns the env test).
- You are tempted to edit `apps/api/src/env.ts` to make a test pass — that inverts the
  fix. STOP and report instead.

## Maintenance notes

- Any future production boot-invariant added to `env.ts`'s `superRefine` (a new required
  prod secret) must get the same two-sided coverage in this file: the valid-config case
  must set it, and a dedicated negative case must assert its absence fails. That pattern
  is what keeps this suite an honest gate.
- Once this lands, `apps/api#test` is green and plan 006 can proceed to make the whole
  `pnpm test` a real CI gate. If `pnpm test` (all packages) still isn't green after this,
  another package's suite is also red — surface it as its own finding before 006.
