---
name: outrival-new-source
description: >
  Use when adding a new monitoring source to Outrival — subdomains, docs,
  roadmap, newsletter, sitemap, news, status, or any future source. Encodes the
  end-to-end pattern (enum sync → scraper → snapshot → diff → signal) so each new
  source is a reliable workflow, not a from-scratch rebuild. Triggers: "add a
  monitoring source", "new source_type", "monitor <X> pages", "track <X> feed".
license: MIT
metadata:
  version: 1.0.0
  author: outrival
  category: engineering
  updated: 2026-07-10
---

# Add a monitoring source to Outrival

You are wiring a new source into Outrival's `snapshot → diff → change → classify →
signal` pipeline. Your goal is a source that produces a **deterministic snapshot**
and lets the generic pipeline do the work — not a bespoke scraper with its own diff.
This file is the decision map + checklist + the traps. Exact file paths, code
anchors, and worked `sitemap`/`news` examples live in
[references/source-pipeline-map.md](references/source-pipeline-map.md) — read it when
you start step 1.

Reference implementations to copy from: `packages/scrapers/src/sitemap/`
(pure-fetch, sorted-list snapshot) and `packages/scrapers/src/news/`
(feed-backed, brand-derived). Both are INTERNAL sources shipped in patch-32.

## Step 0 — Decide INTERNAL vs user-visible FIRST

This is the fork that decides where everything else branches. Get it right before
writing code.

| | **INTERNAL** (e.g. `sitemap`, `news`, `tech_stack`, `ai_visibility`) | **User-visible** (e.g. `jobs`, `g2_reviews`, `status`) |
|---|---|---|
| Who turns it on | **Seeded** at competitor creation, always | User enables it, **gated by plan** |
| Selectable in UI | Never — hidden from picker, tabs, activity | Yes, in the source picker |
| Plan gating | Excluded from `PLAN_LIMITS.allowedSources` | Listed in `allowedSources` per tier |
| Where it seeds | provisioning in `routes/competitors.ts` + `candidates.ts` + `onboarding.ts` | onboarding-selected sources + `POST /competitors/:id/monitors` enable route |
| Extra wiring | Must be added to **4 exclusion sets** (see Gotchas) | Must be added to `allowedSources` + rendered as a tab |

If the source is infra/anchor data the user shouldn't manage → INTERNAL. If it's a
signal surface the user picks and pays for → user-visible.

## The checklist (in order)

Each step is a **goal + constraint**, not a script. Files and anchors are in the
reference map.

1. **Enum ↔ constant, in sync.** Add the string to the DB enum
   (`sourceTypeEnum` / `pgEnum("source_type", …)` in `packages/db/src/schema/monitors.ts`)
   **and** to `SOURCE_TYPES` in `packages/shared/src/constants/sources.ts`, in the
   same change. `SourceType` is derived from the constant; the DB rejects any value
   not in the enum. These two drifting apart is the #1 bug (see Gotchas).

2. **Scraper** in `packages/scrapers/src/<source>/<source>.scraper.ts`, exporting
   `scrape(competitorId, url, options?): Promise<ScrapeOutcome>`, then registered in
   `packages/scrapers/src/index.ts` (`scrapers` map). Follow the staged extraction
   order: **structured-first (JSON-LD / feed / API island) → cached deterministic
   parser → AI fallback (floor)**. For plain XML/feeds/sitemaps use pure `fetch`
   (`safeFetch`), not the browser cascade — they aren't JS-rendered.

3. **AI-free leaf for feeds.** If the source is a feed (RSS/Atom) or a structured
   list, parse it with pure code (see `packages/scrapers/src/feeds/rss.ts` — regex,
   no XML dep, no AI). A non-feed payload returns `[]`, never a guess. AI belongs on
   the cold path (parser generation / heal), never in a per-scrape feed leaf.

4. **Snapshot = a sorted list; let the generic diff work.** Emit a
   `ScrapeOutcome` whose body is the entries **one per line, already sorted**, so
   `+`/`-` diff lines map 1:1 to added/removed items. Add a stable summary header
   (counts) that only moves when the mix changes. Do **not** write source-specific
   diff logic in `apps/workers/src/core/scrape-monitor.ts` — sitemap/news add zero extraction code
   there; the generic `snapshot → diff → change → classify-change` chain surfaces
   and categorizes new entries for you.

5. **Never let an empty scrape become a success snapshot.** A scrape that finds
   nothing must `throw` (like sitemap's `throw new Error("no_sitemap_found")`), so
   pg-boss retries and the monitor can eventually be marked unscrapable — **not**
   write an empty snapshot. An empty success becomes the baseline and the next run
   diffs it as "everything removed" (phantom signal), then masks the real content.
   Also register append-y sources (they legitimately grow) in
   `SIZE_VARIABLE_SOURCES` so the anti-void / completeness band
   (`apps/workers/src/lib/completeness.ts`) doesn't flag a shorter run as `partial`.

6. **Versioned migration — generate and commit, never apply to prod.** Run
   `pnpm db:generate` to produce `packages/db/migrations/NNNN_*.sql` + snapshot and
   commit both. Apply locally with `pnpm db:migrate`. **Never** `db:push` on a
   shared env, and **never** run the prod migration yourself — that's an explicit
   user go at deploy time (see `.claude/rules/production.md`).

7. **Wire the source-type surfaces.**
   - INTERNAL → add it to the 4 exclusion sets (see Gotchas) and to the provisioning
     seed. That's it — no gating, no tab.
   - User-visible → add it to `PLAN_LIMITS.allowedSources` for the tiers that get it,
     make the enable route accept it, and render its data tab.

8. **Tests.** Cover: structured parsing (well-formed → items; malformed/non-feed →
   `[]`), the sorted snapshot so the diff surfaces a genuinely new entry, and clean
   degradation (fetch failure / empty → throw, not empty snapshot). Mirror
   `packages/scrapers/src/news/news.test.ts` and `feeds/rss.test.ts`. Gate:
   `pnpm typecheck` green (build OOMs on WSL2 — typecheck is the real gate).

## Gotchas (read this section twice)

- **Enum sync missed.** Adding to `SOURCE_TYPES` but not the DB `pgEnum` (or vice
  versa) → either `monitor.sourceType` stops being assignable to `SourceType`
  across the pipeline, or the DB rejects the insert at runtime. They move together,
  plus a migration. This is the classic silent break.
- **Empty scrape treated as success.** The single most damaging trap. Zero entries
  must throw, never snapshot. See step 5 — phantom "everything removed" diff, then
  the real content gets masked under the empty baseline.
- **INTERNAL source leaks into the product.** An internal source that isn't added to
  **all four** exclusion sets shows up where users can't manage it. The four:
  `INTERNAL_SOURCES` in `apps/api/src/lib/landscape-data.ts`, `HIDDEN_SOURCES` in
  `apps/api/src/routes/activity.ts`, the enable-route reject + tab-exclude filters in
  `apps/api/src/routes/competitors.ts`, and staying **out** of
  `PLAN_LIMITS.allowedSources` (`packages/shared/src/constants/plans.ts`, asserted by
  `plans.test.ts`). Miss one → it surfaces in the picker, gating, a tab, or the
  activity feed.
- **Append-y source flagged by the anti-void guard.** News/sitemap grow over time; a
  legitimately shorter run below the median gets graded `partial` and its diff is
  skipped unless the source is in `SIZE_VARIABLE_SOURCES` (`apps/workers/src/core/scrape-monitor.ts`).
- **Migration committed but not applied in prod.** Prod runs the pre-deploy migrator
  on explicit user go. If you forget, the enum/column is missing in prod and every
  insert for the new source fails. Committing the SQL is not deploying it.
- **Reinventing the diff.** Writing per-source diff logic instead of
  snapshot-as-sorted-list defeats the whole pattern. If you're diffing by hand,
  reshape the snapshot instead.

## Related skills

- `.claude/rules/scraping.md`: the cascade contract (L0/L1/L2, refusal handling,
  `scrapePage` / `scrapeStatic`). Read it before writing any capture code.
- `.claude/rules/jobs.md`: only if the source needs its own pg-boss job rather than
  the generic `scrape-monitor` path (rare — most sources need no new job).
- **data-quality-auditor**: use to profile a new source's extracted rows
  (`pricing_history`, `job_counts`, …) for missingness before trusting the feed.
