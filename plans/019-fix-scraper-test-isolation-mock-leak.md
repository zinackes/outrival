# Plan 019: Fix the `mock.module` leak that makes `packages/scrapers` tests fail cross-file

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving on. If anything in "STOP
> conditions" occurs, stop and report — do not improvise. When done, update this
> plan's row in `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 81c4b75..HEAD -- packages/scrapers/src/jobs/__tests__/jobs-scraper.test.ts packages/scrapers/src/lib/__tests__/scrape-first-success.test.ts packages/scrapers/src/lib/crawler.ts`
> If any of those files changed since this plan was written, re-read them and compare
> against the "Current state" excerpts before proceeding; on a material mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW (test-only change; no product code)
- **Depends on**: none
- **Blocks**: 005 (green scrapers suite), 006 (CI gate — no point gating a red suite)
- **Category**: tests / correctness (test infra)
- **Planned at**: commit `81c4b75`, 2026-07-07
- **Discovered by**: executing plan 005 (broadening the scrapers test glob surfaced an
  already-red suite; the failure pre-dates plan 005 and is unrelated to its four target dirs).

## Why this matters

`pnpm test` is **already red on `main`** (commit `81c4b75`) and nobody has noticed —
the failure is masked by turbo's cache (a stale green replay) and the absence of a CI
gate (plan 006). Two tests in `packages/scrapers/src/lib/__tests__/scrape-first-success.test.ts`
fail, but **only when run in the same `bun test` process as**
`packages/scrapers/src/jobs/__tests__/jobs-scraper.test.ts`. Run alone they pass.

Root cause: `jobs-scraper.test.ts` calls `mock.module("../../lib/crawler", …)` at the
top level and **never restores it**. In Bun, `mock.module` is a **process-global**
registration that persists for the rest of the test run. Because `bun test` executes
all discovered files in a single process and `jobs/` sorts before `lib/`, the jobs
test's mock is still live when the lib test imports the **real** `scrapeFirstSuccess`
— so the lib test unknowingly calls the jobs test's mock, which is hard-coded to
`throw new Error("no standard careers path (all 404)")`.

This is the kind of hidden regression a test suite exists to prevent. It must be green
and order-independent before plan 006 wires it into CI, and before plan 005's scrapers
half can reach its exit-0 done criterion.

## Reproduce it first (do this before editing anything)

From `packages/scrapers` (after `pnpm install` at the repo root if `node_modules` is absent):

```
# Fails: 2 failures in scrape-first-success (jobs mock leaks into lib)
bun test src/jobs src/lib

# Passes clean in isolation — proves the lib test itself is correct
bun test src/lib
```

Expected before the fix:
- `bun test src/jobs src/lib` → `2 fail` in `scrapeFirstSuccess` ("skips a 404 path…"
  and "returns a 200 page that has enough text").
- `bun test src/lib` → `75 pass, 0 fail`.

If `bun test src/jobs src/lib` already passes, the bug was fixed independently —
**STOP and report** (this plan is obsolete).

## Current state (evidence)

### The leak — `packages/scrapers/src/jobs/__tests__/jobs-scraper.test.ts`

```ts
import { describe, expect, it, mock } from "bun:test";
// …
const scrapePage = mock(async (u: string): Promise<ScrapeOutcome> => { /* … */ });
const scrapeFirstSuccess = mock(async (): Promise<ScrapeOutcome> => {
  throw new Error("no standard careers path (all 404)");
});

mock.module("../../lib/crawler", () => ({ scrapePage, scrapeFirstSuccess }));   // ← never restored

const { scrape } = await import("../jobs.scraper");
```

The `mock.module` call at line ~54 has **no matching restore**, so the replacement of
`../../lib/crawler` outlives this file and poisons any later file that imports the real
module in the same process.

### The victim — `packages/scrapers/src/lib/__tests__/scrape-first-success.test.ts`

```ts
import { describe, expect, it } from "bun:test";
import { scrapeFirstSuccess } from "../crawler";   // ← wants the REAL implementation
// …
it("skips a 404 path with a full body and tries the next candidate", async () => {
  const res = await scrapeFirstSuccess("https://acme.fr", ["/careers", "/jobs"], async (u) => { /* … */ });
  expect(res.statusCode).toBe(200);           // ← the leaked mock throws instead → FAIL
});
it("throws when every path 404s, even with non-empty bodies", async () => {
  await expect( scrapeFirstSuccess(/* … */) ).rejects.toThrow();   // ← accidentally still PASSES vs the throwing mock
});
it("returns a 200 page that has enough text", async () => {
  const res = await scrapeFirstSuccess("https://acme.fr", ["/careers"], async () => /* … */);
  expect(res.text.length).toBe(100);          // ← leaked mock throws → FAIL
});
```

The real `scrapeFirstSuccess` lives in `packages/scrapers/src/lib/crawler.ts` (it takes
`(baseUrl, paths, fetcher)` and returns the first non-404 `ScrapeOutcome`, else throws).
The lib test is **correct**; do not change its assertions.

## The fix (test-isolation only — no product code)

> **Revised 2026-07-07 after a first execution attempt.** The originally-recommended
> approach (re-register `mock.module` with the real module in `afterAll`) was **verified
> not to work in Bun 1.3.13**: re-registering a specifier that's already mocked does not
> propagate to another file's already-bound static import, so the lib test kept seeing
> the throwing mock. `spyOn` is also unsuitable here because `jobs.scraper.ts` uses
> **destructured** named imports (`import { scrapePage, scrapeFirstSuccess }`) and calls
> them directly — spying the namespace object won't rebind those locals, which is exactly
> why the test replaces the whole module. The working approach below does **not** try to
> un-mock; it keeps the module mocked for the whole run but makes the mock a transparent
> passthrough to the real implementation once this file's tests are done.

The bug is that a global module mock isn't scoped to the file that sets it, and Bun can't
un-register it mid-run. So make the mocked `scrapeFirstSuccess` **delegate to the captured
real implementation** after the jobs tests finish. **Only `jobs-scraper.test.ts` changes.**

Steps:

1. `await import("../../lib/crawler")` **before** calling `mock.module` and keep the
   reference (`realCrawler`). Because `jobs/` is loaded before `lib/`, this is the real
   module; the later `mock.module` does not mutate this already-captured namespace object.
2. Add a module-level `let jobsCareersMockActive = true;`.
3. Make the mocked `scrapeFirstSuccess` **throw while the flag is true** (its current
   all-404 behavior, which the jobs tests rely on) and **forward to `realCrawler`
   otherwise** — forwarding all args so the real 4-arg signature works.
4. Register the module mock **spreading the real exports** so no other crawler export
   (e.g. `scrapeStatic`) becomes `undefined` for downstream files.
5. In `afterAll`, set `jobsCareersMockActive = false` so any later file that imports
   `scrapeFirstSuccess` from `../crawler` reaches the real implementation through the
   still-registered (now-transparent) mock.

Sketch (keep the existing `homepageHtml`/`listingHtml`/`outcome()`/`scrapePage` parts intact):

```ts
import { afterAll, describe, expect, it, mock } from "bun:test";
import type { ScrapeOutcome } from "../../types";

// Capture the REAL crawler before mocking it (jobs/ loads before lib/, so this is real).
const realCrawler = await import("../../lib/crawler");

// … homepageHtml / listingHtml / outcome() / scrapePage mock unchanged …

// Delegating mock: simulate "all standard careers paths 404" DURING this file's tests;
// once they finish (afterAll), forward to the real impl so this process-global mock.module
// registration — which Bun 1.3.13 cannot un-register mid-run — stops poisoning other files.
let jobsCareersMockActive = true;
const scrapeFirstSuccess = mock(
  async (...args: Parameters<typeof realCrawler.scrapeFirstSuccess>): Promise<ScrapeOutcome> => {
    if (jobsCareersMockActive) throw new Error("no standard careers path (all 404)");
    return realCrawler.scrapeFirstSuccess(...args);
  },
);

mock.module("../../lib/crawler", () => ({ ...realCrawler, scrapePage, scrapeFirstSuccess }));

const { scrape } = await import("../jobs.scraper");

afterAll(() => {
  jobsCareersMockActive = false;
});
```

Why this is correct:
- The jobs tests run while `jobsCareersMockActive === true`, so `scrapeFirstSuccess` still
  throws for them — their behavior and assertions are unchanged.
- `afterAll` runs before the `lib/` file's tests execute (same process, files run in
  sequence), flipping the flag, so `scrape-first-success.test.ts` — which imports the mock
  — is transparently forwarded to the real `scrapeFirstSuccess` and passes.
- Nothing relies on un-registering `mock.module`; the module stays mocked but becomes a
  passthrough.

If this still does not make BOTH `bun test src/jobs src/lib` AND `bun test src/lib src/jobs`
green, STOP and report (see STOP conditions) — do **not** edit `jobs.scraper.ts` or the lib
test.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Reproduce (before) | `cd packages/scrapers && bun test src/jobs src/lib` | 2 fail (pre-fix) |
| Fix gate (order 1) | `cd packages/scrapers && bun test src/jobs src/lib` | 0 fail |
| Fix gate (order 2) | `cd packages/scrapers && bun test src/lib src/jobs` | 0 fail |
| Full scrapers suite | `cd packages/scrapers && bun test src` | 0 fail |
| Jobs still pass | `cd packages/scrapers && bun test src/jobs` | 0 fail (mock still works within the file) |
| Typecheck | `pnpm typecheck` | exit 0 |

## Scope

**In scope** (the only file you may modify):
- `packages/scrapers/src/jobs/__tests__/jobs-scraper.test.ts` (restore the module mock)

**Out of scope** (do NOT touch):
- `packages/scrapers/src/lib/__tests__/scrape-first-success.test.ts` — it is correct.
- `packages/scrapers/src/lib/crawler.ts` and `packages/scrapers/src/jobs/jobs.scraper.ts`
  — no product-code change is warranted; this is a test-isolation bug.
- Any `package.json` (glob changes are plan 005) and `turbo.json` (CI is plan 006).

## Git workflow

- Branch: `advisor/019-fix-scraper-test-isolation`
- One commit; conventional-commit style (e.g. `test(scrapers): stop jobs mock.module leaking into scrape-first-success`).
- Do NOT push or open a PR unless the operator instructs it.

## Done criteria

ALL must hold:

- [ ] `cd packages/scrapers && bun test src/jobs src/lib` → 0 fail
- [ ] `cd packages/scrapers && bun test src/lib src/jobs` → 0 fail (order-independent)
- [ ] `cd packages/scrapers && bun test src/jobs` → still 0 fail (the jobs tests still use their mock)
- [ ] `cd packages/scrapers && bun test src` → 0 fail
- [ ] `pnpm typecheck` exits 0
- [ ] Only `jobs-scraper.test.ts` is modified (`git status --short`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The delegating-mock approach does not turn **both** `bun test src/jobs src/lib` and
  `bun test src/lib src/jobs` green. Do not begin editing product code (`jobs.scraper.ts`,
  `crawler.ts`) or the lib test — report exactly what you tried and the observed output.
- Making the leak-fix green **breaks a different scrapers test** (e.g. another file also
  depended, knowingly or not, on the leaked mock). Report the newly-failing test — that
  is a second hidden coupling worth surfacing, not something to paper over.
- The reproduce step already passes (`bun test src/jobs src/lib` → 0 fail before any
  edit) — the bug was fixed elsewhere; this plan is obsolete.

## Maintenance notes

- After this lands, plan 005 (broaden the scrapers test glob to `bun test src`) reaches a
  fully-green suite, and plan 006 (CI gate) can wire a suite that is actually green.
- Root rule of thumb for this repo's Bun tests: any file that calls `mock.module` must
  restore it (capture-real-then-re-register in `afterAll`), because `bun test` shares one
  process across files and `mock.module` is process-global. Reviewers should flag any new
  unrestored `mock.module`.
- This flake was previously noted informally as the "scrapeFirstSuccess flake" (site audit
  2026-07-02); this plan is its concrete root-cause fix.
