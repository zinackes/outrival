# Plan 025: A deny/soft-404/login page can no longer become a "success" snapshot or an archive baseline

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 6639163..HEAD -- packages/scrapers/src/lib apps/workers/src/jobs/scrape-monitor.job.ts apps/workers/src/lib/completeness.ts apps/workers/src/jobs/backfill-history.job.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **Base your branch on `origin/main` (`6639163`), NOT on `feat/shadcn-improve`** —
> that stale branch lacks the R1 completeness layer this plan builds on.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (a too-aggressive detector could mark real pages partial → silence real diffs; mitigations inline)
- **Depends on**: none
- **Category**: bug (signal reliability)
- **Planned at**: commit `6639163` (origin/main), 2026-07-09

## Why this matters

The 2026-07-09 pipeline audit (`docs/audits/pipeline-audit-2026-07-09.md`) labeled 110
production signals: **8 of them were fabricated by a corrupted "before" state** — a
challenge page, login wall, or client-rendered 404 that was stored as a *successful*
snapshot and later diffed against real content. Examples from prod: TargetRecruit's
hero recorded as "Checking the site connection security" then "radically changed"
(relevance 1.0, high severity, daily digest); Codebenders/Lane/MTGStocks "published
new pricing tiers" where the before was a 404 body; HebergHub "launch delayed"
deduced from a Wayback-archived Cloudflare interstitial. These are the worst class of
false signal — confidently narrated non-events. The block heuristics that would catch
these pages exist today but only run on the *failure* path; this plan applies them on
the success path and in the archive backfill.

## Current state

All excerpts verified at `origin/main` = `6639163`.

- `packages/scrapers/src/lib/block-detection.ts` — vendor challenge markers, browser-free.
  `isCloudflareChallenge(html)` (line 48) matches `CHALLENGE_MARKERS` (lines 22–46:
  Cloudflare / DataDome / PerimeterX / Imperva / Akamai / Kasada strings) plus a
  `<title>…cloudflare` regex. It is checked at L0 (`scrape-direct.ts:26`) and in the
  browser tiers — but a deny page whose vendor string is NOT in the list, or generic
  soft-404/login/geo copy, passes.
- `packages/scrapers/src/lib/scrape-direct.ts` — L0. Status ≥ 400 fails fast
  (`http_error`, line 40) and stripped text < 500 chars → `needs_render` (line 59).
  **A 200 response with ≥ 500 chars of any text is accepted** — this is how soft-404s
  and worded deny pages get in.
- `packages/scrapers/src/lib/diagnose-failure.ts` — has exactly the copy heuristics we
  need, but only on the failure path:
  - `detectsLoginPage(html)` (lines 179–184): password input, or sign-in copy in the
    first 5 KB.
  - `detectsGeoBlock(html)` (lines 186–190): `not available in your (region|country)|
    access denied|geographic(al)? restriction|…` in the first 8 KB.
- `apps/workers/src/jobs/scrape-monitor.job.ts` — success path:
  - Hash-dedup early return at line 584.
  - Collapse guard line 625: `if (lastSnapshot && isContentCollapsed(afterContent))` —
    **gated on `lastSnapshot`, so the FIRST capture of a monitor has no emptiness
    guard at all** and a shell/error page becomes the permanent baseline.
  - Anti-void median guard lines 647–671 (also `lastSnapshot`-gated; needs priors).
  - R1 completeness grading lines 705–729:
    ```ts
    const completeness = COMPLETENESS_ENABLED
      ? assessCompleteness({ contentLength: afterContent.length, priorSizes,
          homepageIncomplete, ratioEligible: !SIZE_VARIABLE_SOURCES.has(monitor.sourceType),
          minRatio: COMPLETENESS_MIN_RATIO, minPriors: COMPLETENESS_MIN_PRIORS })
      : { complete: true, reason: null };
    ```
    Snapshot insert stores `status: completeness.complete ? "success" : "partial"`
    (line 737) and the diff chain is skipped when either side is partial
    (`skipDiffForPartial`, lines 791–799). **This is the mechanism to reuse: a deny
    page should be graded `partial` so it is stored (forensics) but never diffed.**
    Note its ratio band requires `priorSizes.length >= minPriors`, so new monitors
    are NOT protected by it.
- `apps/workers/src/lib/completeness.ts` — pure, tested-style module:
  `assessCompleteness(input): { complete, reason: "incomplete_render" | "below_median_band" | null }`.
- `apps/workers/src/jobs/backfill-history.job.ts` — Wayback L2 backfill. Line 115:
  `const content = extractContent(page.html, monitor.sourceType);` then inserts a
  snapshot with `origin: "archive"` (lines 120–129). **No challenge/deny check on the
  archived HTML** — an archived interstitial becomes a diff baseline.

Conventions:
- Pure detection logic lives in `packages/scrapers/src/lib/*` with colocated
  `*.test.ts` run by `bun test` (exemplar: `block-detection.ts` + the guard style of
  `anti-void.ts`). No DB access in `packages/scrapers` (see `packages/scrapers/CLAUDE.md`).
- Error handling in workers jobs: throw to let Trigger.dev retry (see the collapse
  guard at `scrape-monitor.job.ts:625–639` for the exact pattern and log style).
- Comments state constraints, English only.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0 (all workspace tasks pass) |
| Scrapers tests | `cd packages/scrapers && bun test src` | all pass, 0 fail |
| Workers tests | `cd apps/workers && bun test src` | all pass, 0 fail |

## Scope

**In scope** (the only files you should modify/create):
- `packages/scrapers/src/lib/deny-page.ts` (create)
- `packages/scrapers/src/lib/deny-page.test.ts` (create)
- `packages/scrapers/src/index.ts` or the relevant subpath export file — only to
  export the new module (inspect how `block-detection.ts` is exported and mirror it;
  workers imports use `@outrival/scrapers/...` subpaths — check `packages/scrapers/package.json` `exports`)
- `apps/workers/src/lib/completeness.ts` (extend the reason union)
- `apps/workers/src/jobs/scrape-monitor.job.ts` (wire detector + first-capture guard)
- `apps/workers/src/jobs/backfill-history.job.ts` (guard archived HTML)
- `apps/workers/src/lib/__tests__/` or colocated test for completeness wiring if a
  test file for it exists (check `apps/workers/src` for existing `completeness` tests
  and extend them; if none, add tests only in packages/scrapers)

**Out of scope** (do NOT touch):
- `packages/scrapers/src/lib/block-detection.ts` — do not widen `CHALLENGE_MARKERS`;
  the new module handles worded pages, the marker list stays vendor-string-only.
- `packages/scrapers/src/lib/diagnose-failure.ts` — keep the failure-path diagnostics
  as they are; you may COPY its regex patterns, do not import from it into the new
  module if that would create an export cycle (it's fine to leave light duplication).
- The cascade escalation logic (`scrape-page.ts`, `scrape-patchright.ts`).
- `ENRICHMENTS_*` / relevance / diff code.
- Any DB schema change (the `partial` status already exists in the enum).

## Git workflow

- Branch: `advisor/025-deny-page-guard` off `origin/main`.
- Conventional commits, subject ≤ 50 chars, e.g. `fix(scrapers): grade deny pages partial`.
- Multi-line commit messages via `git commit -F <file>` (the RTK shell proxy mangles
  multi-line `-m`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create the pure detector `packages/scrapers/src/lib/deny-page.ts`

Export:

```ts
export type DenyPageKind = "soft_404" | "access_denied" | "login_wall" | "verification_wall";
export function detectDenyPage(html: string): DenyPageKind | null;
```

Detection rules — all case-insensitive, scoped to limit false positives:

- `soft_404`: `<title>` matches `/\b(404|not found|page (not|introuvable)|doesn.t exist)\b/i`
  **or** the first 3 KB of *visible text* (strip tags the way `scrape-direct.ts:53-58`
  does) matches `/\b(404|page not found|page you requested (does not|doesn.t) exist|this page (isn.t|is not) available)\b/i`
  **and** the total visible text is < 3 000 chars (a long article merely mentioning
  "404" must not trip it).
- `access_denied`: first 8 KB of visible text matches
  `/\b(access denied|not available in your (region|country)|geographic(al)? restriction|forbidden|request blocked|unusual traffic)\b/i`
  and visible text < 3 000 chars.
- `login_wall`: `<input type="password"` anywhere, **or** (sign-in copy per
  `diagnose-failure.ts:179-184`: `/\b(sign in|log in|sign-in|log-in)\b/i` together with
  `/\b(continue with|email address|password)\b/i` in the first 5 KB) **and** visible
  text < 3 000 chars.
- `verification_wall`: first 3 KB of visible text matches
  `/\b(verify(ing)? (you are|that you.re) (a )?human|one moment, please|request is being verified|robot challenge)\b/i`
  (catches worded interstitials NOT covered by the vendor markers).
- Return the first matching kind in the order above; otherwise `null`.

The `< 3000 visible chars` guard is load-bearing: real content pages are long; deny
pages are short but above the existing 500-char L0 floor. Implement one shared
`visibleText(html)` helper inside the module.

**Verify**: `cd packages/scrapers && bun test src/lib/deny-page.test.ts` → all pass
(write the tests in step 2 first if you prefer TDD; both orders acceptable).

### Step 2: Tests for the detector

`packages/scrapers/src/lib/deny-page.test.ts`, `bun:test`, model the structure after
an existing lib test (e.g. the tests colocated in `packages/scrapers/src/lib/` —
`guarded-fetch.test.ts` is a good pattern). Fixtures as inline template strings:

1. Client-rendered 404 (`<title>404 — Not Found</title>`, short body) → `"soft_404"`.
2. Access-denied page ("Access Denied", "You don't have permission", short) → `"access_denied"`.
3. Geo block ("not available in your country") → `"access_denied"`.
4. Login wall with `<input type="password">` → `"login_wall"`.
5. Worded verification page ("One moment, please... your request is being verified",
   no Cloudflare vendor strings) → `"verification_wall"`.
6. **Negative**: a long real page (> 3 000 chars of body text) that contains the words
   "sign in" in a footer and mentions "404" in an article → `null`.
7. **Negative**: a real pricing page with prices and > 3 000 chars → `null`.
8. **Negative**: a short-but-legit landing page (~800 chars: hero + CTA, no deny
   copy) → `null`.

**Verify**: `cd packages/scrapers && bun test src/lib/deny-page.test.ts` → 8 pass, 0 fail.

### Step 3: Extend the completeness reason union

In `apps/workers/src/lib/completeness.ts` add `"deny_page"` to `CompletenessReason`.
Do NOT change `assessCompleteness` logic — the deny check is a separate signal wired
in the job (it needs the raw HTML, which `assessCompleteness` deliberately doesn't take).

**Verify**: `pnpm typecheck` → exit 0.

### Step 4: Wire the detector into the scrape-monitor success path

In `apps/workers/src/jobs/scrape-monitor.job.ts`, right after the `completeness`
grading block (lines 712–729), add:

```ts
const denyKind = detectDenyPage(result.html);
const graded =
  completeness.complete && denyKind
    ? { complete: false, reason: "deny_page" as const }
    : completeness;
```

- Import `detectDenyPage` from the scrapers subpath export you set up in step 1.
- Log a warning when `denyKind` fires (match the existing "Partial capture graded"
  log style at line 723, include `denyKind`).
- Use `graded` instead of `completeness` in BOTH downstream uses: the snapshot
  `status` (line 737) and `skipDiffForPartial` (line 792).
- Gate the deny check behind the same `COMPLETENESS_ENABLED` kill-switch (find where
  it is read at the top of the file and reuse it) so the whole layer stays
  switch-off-able as one unit.

**Verify**: `pnpm typecheck` → exit 0. Then
`grep -n "graded" apps/workers/src/jobs/scrape-monitor.job.ts` → shows it used for
snapshot status and skipDiffForPartial.

### Step 5: First-capture collapse guard

At the collapse guard (line 625), the `lastSnapshot &&` gate leaves the first capture
unguarded. Change the logic so that when `lastSnapshot` is **null** and
`isContentCollapsed(afterContent)` is true, the job throws
(`Extracted content collapsed on first capture for monitor ${monitor.id}`) — same
pattern as the existing throw at lines 631–638, without the prior-snapshot R2
comparison (there is no prior). Keep the existing `lastSnapshot` branch untouched.

This means a monitor whose very first scrape yields an empty shell retries (and can
escalate/mark-unscrapable honestly) instead of storing an empty baseline that turns
the next healthy scrape into a phantom "everything added" change.

**Verify**: `pnpm typecheck` → exit 0, and
`sed -n '615,650p' apps/workers/src/jobs/scrape-monitor.job.ts` shows both branches
(first-capture throw + existing prior-compare throw).

### Step 6: Guard the archive backfill

In `apps/workers/src/jobs/backfill-history.job.ts`, immediately before the content
extraction at line 115 (`const content = extractContent(page.html, ...)`), skip the
archived capture when `isCloudflareChallenge(page.html)` (already exported from
`@outrival/scrapers` — check how the workers import block-detection helpers; if not
yet exported to workers, export it the same way as in step 1) **or**
`detectDenyPage(page.html) !== null`. "Skip" = log and `return`/`continue` consistent
with the surrounding best-effort style (the job never retries — see its header
comment); do NOT throw.

**Verify**: `pnpm typecheck` → exit 0.

### Step 7: Full verification

**Verify**:
- `pnpm typecheck` → exit 0
- `cd packages/scrapers && bun test src` → all pass, 0 fail
- `cd apps/workers && bun test src` → all pass, 0 fail (run only if this suite is
  green on your base commit — check first with the same command on an unmodified
  checkout; if it is red at base, limit to the files you touched)

## Test plan

- New: `packages/scrapers/src/lib/deny-page.test.ts` (8 cases, step 2).
- If `apps/workers` has an existing test for completeness grading (search:
  `grep -rn "assessCompleteness" apps/workers --include=*.test.ts`), add a case
  asserting the reason union accepts `"deny_page"`; otherwise skip (job wiring is
  covered by typecheck + the pure detector tests).
- Verification: commands in step 7.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `cd packages/scrapers && bun test src` exits 0, including ≥ 8 new deny-page tests
- [ ] `grep -n "detectDenyPage" apps/workers/src/jobs/scrape-monitor.job.ts` → ≥ 1 match
- [ ] `grep -n "detectDenyPage\|isCloudflareChallenge" apps/workers/src/jobs/backfill-history.job.ts` → ≥ 1 match
- [ ] `grep -n "deny_page" apps/workers/src/lib/completeness.ts` → 1 match in the reason union
- [ ] First-capture collapse guard present (step 5 verify)
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The "Current state" excerpts don't match the live code (drift since `6639163`) —
  in particular if the R1 completeness block (`assessCompleteness`, `status: "partial"`,
  `skipDiffForPartial`) is absent or has been restructured.
- `packages/scrapers/package.json` has no subpath-export mechanism you can mirror for
  the new module (don't invent a new export style).
- The negative fixtures (step 2, cases 6–8) can't be made to pass without weakening
  the positive cases — report the conflict instead of shipping a detector that flags
  real pages.
- `apps/workers && bun test src` is red on the UNMODIFIED base commit (pre-existing
  failure) — note it and verify only your own additions.

## Maintenance notes

- The detector deliberately errs conservative (visible-text < 3 000 chars gate). A
  deny page longer than that will still slip through — acceptable; revisit only with
  evidence.
- Follow-up deliberately deferred: surfacing the `partial` rate (and `deny_page`
  reason split) in `/admin` — belongs to the audit's instrumentation batch (SCR-2),
  not this plan.
- A monitor pointing at a permanently walled page (e.g. Gartner login) will now
  produce an unbroken series of `partial` snapshots and zero diffs — honest, but
  invisible until the instrumentation lands. Reviewers should check the deny regexes
  against a handful of real tracked competitor pages before merging.
- If a future PR widens `CHALLENGE_MARKERS`, keep the two modules' responsibilities
  distinct: vendor strings there, worded/generic copy here.
