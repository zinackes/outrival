# Plan 018: One authored release ledger feeds the in-app and public changelogs, plus a feed

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 74888f6..HEAD -- apps/web/src/lib/whats-new.ts apps/web/src/app/changelog apps/web/src/app/blog/rss.xml`
> If any changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P3
- **Effort**: S-M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `74888f6`, 2026-07-25

## Why this matters

Three release ledgers are maintained by hand and all three have drifted:

- The **public** `/changelog` page's newest entry is `v0.7.0`, dated "June 2026".
- The **in-app** "What's new" ledger's newest entry is dated `2026-06-26`.
- The **Notion roadmap** board is documented as hand-synced, with the project's
  own instructions admitting it has already drifted once and recording the
  "actually in production" tracking as an open TODO.

Since `2026-06-26` there have been roughly 50 commits, including more than 25
user-visible `feat(web)` pull requests (`#243` through `#271`): Discovery,
Compare, Activity, Products, Trends, AI Visibility, the roster and digests were
all rebuilt. None of it is announced anywhere a user can see.

Three concrete costs:

1. Users who just received a rebuilt Discovery, Compare and Trends have no way to
   learn it happened.
2. `apps/web/src/app/sitemap.ts:30` declares `/changelog` with
   `changeFrequency: "weekly"` and serves a month-old page to crawlers, while the
   SEO strategy doc is asking for exactly this kind of dateable, indexable content.
3. There is a `/blog/rss.xml` route and **no** changelog feed, even though
   Outrival's own `changelog` monitor source is documented as feed-first: the
   product prefers RSS when watching everyone else's changelog, and does not
   publish one for its own.

The maintainer's instructions say the Notion board stays manual on purpose. That
decision is respected here: this plan touches the two ledgers **in this
repository**, not the board.

## Current state

### Public changelog is a hardcoded array (`apps/web/src/app/changelog/page.tsx:12-30`)

```tsx
const ENTRIES = [
  {
    version: "v0.7.0",
    date: "June 2026",
    items: [
      "Staged extraction pipeline: structured-first parsing keeps AI on the cold path.",
      "Automatic platform detection routes each source to its structured connector.",
      "Expanded source coverage: more ATS connectors, multi-platform reviews, Reddit mentions.",
    ],
  },
```

Note: that third bullet advertises **Reddit mentions**, and the Reddit source was
retired on 2026-07-14 (removed from the `source_type` enum by migration 0043 over
a licensing and policy issue). So the public changelog currently advertises a
feature that was deliberately withdrawn. Fix that as part of this work.

Shape: `{ version, date: "Month YYYY", items: string[] }`, rendered through
`DocPage`, with a `text-xs text-text-subtle` date at `:44`.

### In-app ledger is a typed array (`apps/web/src/lib/whats-new.ts:1-20`)

```ts
// In-app changelog (Phase B). Static, newest-first — add a release by prepending to
// the array; no DB, no endpoint. The topbar dot compares the latest `date` to a
// localStorage last-seen marker. Each release reads as a patch note: a dated entry
// whose changes are tagged by kind (new / improved / fixed).

export type WhatsNewKind = "new" | "improved" | "fixed";

export interface WhatsNewChange {
  kind: WhatsNewKind;
  text: string;
}

export interface WhatsNewEntry {
  date: string; // ISO date (YYYY-MM-DD)
  title: string;
  changes: WhatsNewChange[];
}

export const WHATS_NEW: WhatsNewEntry[] = [
```

This is the **richer** shape: ISO dates, a title, and per-change `kind` tags. It
is the better single source. Its `date` also drives the topbar unread dot via a
localStorage marker, so its ordering and date format are load-bearing.

### The blog already has a feed

`apps/web/src/app/blog/rss.xml/` exists. Copy its structure rather than inventing
one.

### Voice constraints

`PRODUCT.md` describes the voice as direct and specific, "a sharp analyst who
respects your time". An auto-generated commit dump would read nothing like the
rest of the product. The entries stay hand-authored; only the **source** is
unified.

`.claude/rules/language.md`: English.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Web tests | `cd apps/web && bun test test/` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Whole suite | `pnpm test` | exit 0 |
| Metadata check | `pnpm check:metadata http://localhost:3000` | needs a running app; see step 5 |

Note: `turbo` is **not** on `PATH`. Use the `pnpm` scripts. **Do not run
`pnpm build`**: a full web build exhausts this box's RAM. Typecheck is the gate.

## Scope

**In scope** (the only files you should modify or create):
- `apps/web/src/lib/whats-new.ts` (becomes the single source; may gain optional fields)
- `apps/web/src/app/changelog/page.tsx` (render from the shared source)
- `apps/web/src/app/changelog/rss.xml/route.ts` (create)
- `apps/web/test/whats-new.test.ts` (create)
- `apps/web/src/app/sitemap.ts` (only if the feed needs listing)

**Out of scope** (do NOT touch, even though they look related):
- The Notion roadmap board and any attempt to automate it. The project's own
  instructions say it stays manual by design.
- Generating entries from git history. The voice constraint rules it out, and a
  commit dump would be worse than the current gap.
- `apps/web/src/app/blog/` and its RSS route. Read it as a pattern; do not change it.
- The topbar unread-dot logic and its localStorage marker. It reads the latest
  `date` from `WHATS_NEW`; keep that contract intact.
- Backfilling all 25 missing releases as individual entries. See step 4: one
  honest catch-up entry beats 25 reconstructed ones.

## Git workflow

- Branch: `feat/unify-changelog` off `main`.
- Commit message style, matching `git log`: `feat(web): one source for the changelog`.
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Confirm the drift

```bash
grep -n 'date:' apps/web/src/lib/whats-new.ts | head -3
grep -n 'version\|date' apps/web/src/app/changelog/page.tsx | head -6
git log --oneline --since=2026-06-26 | wc -l
ls apps/web/src/app/blog/rss.xml apps/web/src/app/changelog
```

**Verify**: in-app newest is `2026-06-26`, public newest is "June 2026", the
commit count since is around 50, and a blog RSS route exists while a changelog
one does not.

### Step 2: Make `whats-new.ts` the single source

Keep `WhatsNewEntry` as the canonical shape (ISO date, title, tagged changes) and
add whatever optional field the public page needs, most likely
`version?: string`, plus a way to mark an entry as internal-only if some in-app
notes should not be public.

Add a short comment at the top of the file recording that it now feeds three
surfaces (in-app, public page, RSS), so nobody re-adds a second array.

**Verify**: `pnpm typecheck` exits 0.

### Step 3: Render `/changelog` from it

Replace the hardcoded `ENTRIES` array with a mapping from `WHATS_NEW`. Preserve
the existing visual structure (the `DocPage` wrapper, the date styling). Format
the ISO date into the human "Month YYYY" form the page currently shows, using the
repo's existing date helpers rather than a new one, and following the project's
convention of English locale formatting.

Filter out any entry marked internal-only.

**Verify**: `pnpm typecheck` exits 0, and
`grep -c "const ENTRIES" apps/web/src/app/changelog/page.tsx` returns 0.

### Step 4: Add one honest catch-up entry

Do **not** reconstruct 25 individual releases from git history. Write **one**
dated entry covering the July work, in the product's voice, naming what a user
would notice: Discovery rebuilt as a triage desk, Compare rebuilt around the
verdict, Activity rebuilt around coverage, Products rebuilt around the
portfolio, Trends reading like a market report, AI Visibility around one
reading, digests reading like a brief.

Use `git log --oneline --since=2026-06-26` as your source material, but write
user-facing prose, not commit subjects.

While you are here, **fix the retired-Reddit claim** in the older public entry:
the Reddit source was withdrawn on 2026-07-14 and the changelog still advertises
it. Either amend that bullet or add a line to the new entry noting the removal.
Advertising a withdrawn source is worse than saying nothing.

**Verify**: the newest `WHATS_NEW` date is in July 2026, and
`grep -rn "Reddit" apps/web/src/lib/whats-new.ts apps/web/src/app/changelog/` shows
no live claim that Reddit monitoring is available.

### Step 5: Add the RSS feed

Create `apps/web/src/app/changelog/rss.xml/route.ts`, modelled on the existing
blog feed. Same content type, same escaping, same absolute-URL construction.
Each item: the entry title, its date as `pubDate`, and its changes as the
description.

Check whether the blog feed is listed in `sitemap.ts` or `robots.ts` and mirror
whatever it does.

**Verify**: `pnpm typecheck` exits 0. Note in your report that the rendered XML
was not validated locally (no build on this box) and should be checked once
deployed.

### Step 6: Test it

Create `apps/web/test/whats-new.test.ts` (the package runs `bun test test/`).

Cases:

1. `WHATS_NEW` is sorted newest-first. The topbar unread dot depends on the first
   entry being the latest; an out-of-order prepend would silently break it.
2. Every `date` parses as a valid ISO date.
3. Every entry has a non-empty title and at least one change.
4. Every change `kind` is one of `new` / `improved` / `fixed`.
5. **The freshness guard**: the newest entry is no older than a stated number of
   days relative to a date the test computes. Pick something forgiving, like 120
   days, so it flags a year-long gap rather than nagging weekly. Write the intent
   in a comment; a test that fails every quarter gets deleted, one that fails
   after a real drought gets fixed.

The existing web tests are deliberately scoped to extracted pure logic, which
this is. Model on any of the 12 existing files.

**Verify**: `cd apps/web && bun test test/` passes.

### Step 7: Full check

**Verify**: `pnpm typecheck` exits 0 and `pnpm test` exits 0.

## Test plan

- `apps/web/test/whats-new.test.ts` with the five cases above. Case 1 is the one
  with a real failure mode today (the unread dot). Case 5 is the one that stops
  this plan's problem from recurring.
- Structural pattern: any existing pure test under `apps/web/test/`.
- Not covered: the rendered RSS XML and the rendered page, since a web build is
  not runnable here. Say so and hand off the post-deploy check.
- Verification: `cd apps/web && bun test test/` all pass; `pnpm test` exit 0.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c "const ENTRIES" apps/web/src/app/changelog/page.tsx` returns 0
- [ ] `apps/web/src/app/changelog/page.tsx` imports from `@/lib/whats-new`
- [ ] `apps/web/src/app/changelog/rss.xml/route.ts` exists
- [ ] The newest `WHATS_NEW` entry is dated July 2026 or later
- [ ] No surface claims Reddit monitoring is available
- [ ] `apps/web/test/whats-new.test.ts` exists with the five cases and passes
- [ ] `cd apps/web && bun test test/` exits 0
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The in-app and public ledgers turn out to serve genuinely different audiences
  such that one source cannot feed both (for example, in-app entries reference
  dashboard-only surfaces that make no sense publicly). Then the answer is an
  `internal?: boolean` flag, not two arrays. If even that does not fit, report it
  rather than keeping the duplication silently.
- The topbar unread-dot logic depends on `WHATS_NEW` in a way your changes would
  break. Its localStorage marker compares against the newest `date`; verify
  before changing the array's shape or ordering.
- You are tempted to generate entries from commit subjects. The voice constraint
  in `PRODUCT.md` rules it out, and it would produce exactly the "generic SaaS"
  register listed under anti-references.
- Writing the catch-up entry requires claiming something shipped that you cannot
  verify from the repository. Under-claim rather than over-claim; a changelog
  that advertises a withdrawn feature is the failure mode already present.

## Maintenance notes

- **The durable fix is the habit, not the code.** Add a line to whatever release
  or pull-request checklist exists so a user-visible change appends to
  `whats-new.ts` in the same pull request that ships it. The freshness test in
  step 6 is the backstop for when that is forgotten.
- **The Notion board stays manual on purpose.** The project's instructions are
  explicit about that, and this plan deliberately does not touch it. If the
  "actually in production" tracking TODO is ever resolved, this ledger is the
  natural input, since an entry lands with the feature.
- **The RSS feed closes a real asymmetry.** Outrival's own `changelog` monitor
  source is feed-first, so competitors publishing an RSS changelog get better
  detection than those who do not. Publishing one is both dogfooding and an
  argument in the sales conversation.
- A reviewer should check the dates render in English locale format and that the
  feed's URLs are absolute, since a relative URL in RSS resolves against the
  reader, not the site.
