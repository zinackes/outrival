# Plan 029: A client-rendered pricing page gets a browser render before we record "no prices"

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 0d35d0f..HEAD -- packages/scrapers/src/pricing .env.example docs/architecture.md`
> If any in-scope file changed since this plan was re-anchored, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **Base your branch on `origin/main` (`0d35d0f`).**

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW–MED (adds at most one local L1 browser render per pricing scrape
  whose L0 capture shows no prices; no proxy spend)
- **Depends on**: none
- **Category**: bug (coverage — pricing is the flagship source)
- **Planned at**: commit `6639163` (origin/main), 2026-07-09
- **Re-anchored at**: commit `0d35d0f` (origin/main), 2026-07-10 — plans 025–028
  (#155/#156/#157/#159), pricing PRs #151/#152/#158, and skills chore #160 have all
  landed on main. `pricing.scraper.ts` (the wiring target) is **byte-identical** to
  `6639163`; `harvest.ts`/`discover-url.ts` were widened (currencies, catalog,
  URL discovery) but are **consumed, not modified** by this plan and `harvestPricing`'s
  contract (`{ plans }` from `./harvest`) is intact. The finding still holds: origin/main
  has **no render-retry logic** in `packages/scrapers/src/pricing`. NOTE: the final
  single-page return point is now at **line 81** (`return scrapePage(candidate.url, opts)`),
  not 82 — match the code, not the line number.

## Why this matters

The scraping cascade accepts an L0 (plain fetch) result whenever the page carries
≥ 500 chars of visible text (`scrape-direct.ts:59`). A very common pricing-page
shape — SSR marketing copy with the actual price cards mounted client-side (React/
Stripe pricing tables, Framer) — passes that bar with **zero prices in the HTML**.
Because the capture never reaches a browser level, the scroll and the
Monthly↔Annual toggle never run either, and extraction reports `plans: []` as a
*success* (`{ok:true, plansInserted:0}`). The competitor's pricing then reads
"unknown" forever with no error anywhere (2026-07-09 audit, finding SCR-4 —
severity critical). PR #124's harvest floor guarantees "if prices are *visible* we
never show no tiers" — but it cannot float prices that were never captured. The
jobs source already solved this exact problem with a render floor
(`JOBS_RENDER_ENABLED`); this plan mirrors it for pricing with a cheaper trigger:
re-render only when the L0 capture contains no harvestable price.

## Current state

All excerpts verified at `origin/main` = `6639163`; re-verified at `0d35d0f`:
`pricing.scraper.ts` unchanged (82 lines; return points at lines 31, 48, 79, 81),
`harvestPricing` still exported from `./harvest` as `harvestPricing(html): PricingHarvest`
with `{ plans: HarvestedPlan[] }`.

- `packages/scrapers/src/pricing/pricing.scraper.ts` (82 lines, post-#124) — the
  orchestrator. `opts = { blockResources: true, knownLevel, progressiveScroll: true,
  captureBillingToggle: … }` (lines 22–27; scroll/toggle are browser-only no-ops at
  L0). Return points:
  - line 31: keyword URL → `return scrapePage(url, opts);`
  - line 48: discovered direct pricing page → `return scrapePage(candidate.url, opts);`
  - lines 55–74: catalog aggregation (multi-page, out of this plan's trigger — see
    Scope note below)
  - line 79: embedded/none → `return homepage;`
  - line 82: nav/footer candidate → `return scrapePage(candidate.url, opts);`
- `packages/scrapers/src/pricing/harvest.ts` (added by #124) — DOM walk for price
  elements. `export function harvestPricing(html: string): PricingHarvest` (line 81)
  returns `{ plans: HarvestedPlan[] }`; internally uses `PRICE_RE`
  (`/([€$£¥])\s?(\d[\d.,\s]*\d|\d)|(\d[\d.,\s]*\d|\d)\s?([€$£¥])/`, line 40). This
  is the package's existing "does this page show prices?" oracle — reuse it, do not
  add a new regex.
- Render-floor exemplar: `packages/scrapers/src/jobs/jobs.scraper.ts` lines 120–124 —
  `const renderJobs = process.env.JOBS_RENDER_ENABLED !== "false";` and the kept
  page is scraped with `{ render: true, progressiveScroll: true }`. `render: true`
  makes the cascade start at L1 (browser) instead of L0.
- `ScrapeOutcome` carries `level` (0–4) and `html` — `result.level === 0` identifies
  a capture that never saw a browser.
- Env-var conventions: every new var goes to `.env.example` with a comment AND to
  `docs/architecture.md`'s env section (`.claude/rules/production.md` §4).
- Tests: `cd packages/scrapers && bun test src`. Pure-module tests colocate
  (exemplar: `src/pricing/harvest.test.ts` from #124). Avoid `mock.module` for the
  orchestration unless you follow the capture-before-mock pattern in
  `src/jobs/__tests__/jobs-scraper.test.ts` (Bun's `mock.module` is process-global —
  see that file's comments).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0 |
| Scrapers tests | `cd packages/scrapers && bun test src` | all pass, 0 fail |

## Scope

**In scope** (the only files you should modify/create):
- `packages/scrapers/src/pricing/pricing.scraper.ts`
- `packages/scrapers/src/pricing/render-retry.ts` (create — the pure trigger)
- `packages/scrapers/src/pricing/__tests__/render-retry.test.ts` (create)
- `.env.example` (add `PRICING_RENDER_RETRY_ENABLED`)
- `docs/architecture.md` (document the new var, one entry in the env block)

**Out of scope** (do NOT touch):
- `harvest.ts`, `discover-url.ts`, `product-lines.ts` — #124's modules are consumed,
  not modified (if `harvestPricing` needs re-exporting somewhere, import it directly
  from `./harvest`).
- The catalog-aggregation branch (lines 55–74): its candidate pages were already
  ranked by price-token density at L0, so a no-token catalog page doesn't reach it;
  adding render-retry there multiplies browser renders × MAX_PRODUCT_LINES for
  little gain. Deliberately excluded.
- `scrape-page.ts` / cascade internals; `extract-pricing.job.ts`.
- `JOBS_RENDER_ENABLED` and the jobs scraper.

## Git workflow

- Branch: `advisor/029-pricing-render-floor` off `origin/main`.
- Conventional commits, subject ≤ 50 chars, e.g. `fix(scrapers): render retry for priceless pricing captures`.
- Multi-line commit messages via `git commit -F <file>` (RTK proxy mangles multi-line `-m`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create the pure trigger `packages/scrapers/src/pricing/render-retry.ts`

```ts
import { harvestPricing } from "./harvest";

/** True when an L0 (no-browser) pricing capture shows no harvestable price at all —
 * the signature of a client-rendered pricing page (SSR shell, JS-mounted price
 * cards). One browser render then reveals what L0 structurally cannot see. Never
 * true for browser-level captures: if L1+ saw no prices, rendering again won't help. */
export function needsRenderRetry(html: string, level: number): boolean {
  if (level !== 0) return false;
  return harvestPricing(html).plans.length === 0;
}
```

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Tests for the trigger

`packages/scrapers/src/pricing/__tests__/render-retry.test.ts` (model after
`__tests__/commerce-candidates.test.ts` for style; fixtures inline):

1. L0 capture of an SSR marketing shell (real-looking HTML, > 500 chars of copy,
   ZERO price tokens) → `true`.
2. L0 capture containing `<div class="price">€29/mo</div>` → `false`.
3. Same priceless HTML at `level: 1` → `false`.
4. L0 capture with a price only in FR format (`29 € / mois`) → `false` (harvest
   parses it — guards against the trigger double-rendering FR pages).

**Verify**: `cd packages/scrapers && bun test src/pricing/__tests__/render-retry.test.ts`
→ 4 pass, 0 fail.

### Step 3: Wire the retry into the scraper's single-page return points

In `pricing.scraper.ts`:

1. Read the kill-switch once at module scope, next to `AGGREGATE_ENABLED` (line 9):
   `const RENDER_RETRY_ENABLED = process.env.PRICING_RENDER_RETRY_ENABLED !== "false";`
2. Add a local helper:
   ```ts
   async function scrapeWithRenderRetry(url: string, opts: ScrapeOptions): Promise<ScrapeOutcome> {
     const result = await scrapePage(url, opts);
     if (RENDER_RETRY_ENABLED && needsRenderRetry(result.html, result.level)) {
       return scrapePage(url, { ...opts, render: true });
     }
     return result;
   }
   ```
   (If a rendered retry throws, let it propagate — same failure semantics as any
   scrapePage call; do NOT swallow it back to the L0 result, which would mask a
   block behind a priceless success.)
3. Replace the three single-page return points with the helper:
   - line 31 (`keyword URL`) → `return scrapeWithRenderRetry(url, opts);`
   - line 48 (`candidate.source === "direct"`) → `return scrapeWithRenderRetry(candidate.url, opts);`
   - line 82 (final candidate) → `return scrapeWithRenderRetry(candidate.url, opts);`
4. The `return homepage;` path (line 79 — pricing embedded in the homepage or not
   found): apply the retry to the homepage TOO, but reuse the already-fetched
   result: `if (RENDER_RETRY_ENABLED && needsRenderRetry(homepage.html, homepage.level)) return scrapePage(resolvedBase, { ...opts, render: true });`
   before `return homepage;` — a client-rendered homepage with an embedded pricing
   widget is the same failure shape.
5. Do NOT touch the catalog-aggregation branch.

**Verify**: `pnpm typecheck` → exit 0, and
`grep -c "scrapeWithRenderRetry\|needsRenderRetry" packages/scrapers/src/pricing/pricing.scraper.ts`
→ ≥ 4 usages.

### Step 4: Document the kill-switch

- `.env.example`, next to `PRICING_TOGGLE_CAPTURE_ENABLED`:
  ```
  PRICING_RENDER_RETRY_ENABLED=true  # pricing source only — when the L0 (no-browser) capture contains no harvestable price, re-scrape once with a browser render (local L1, no proxy). Catches client-rendered pricing pages that L0 accepts as text-rich marketing shells. false = previous L0-accepting behaviour exactly
  ```
- `docs/architecture.md`: add the same var + one-line description in the scraping
  env block (near `PRICING_TOGGLE_CAPTURE_ENABLED`). Touch nothing else.

**Verify**: `grep -n "PRICING_RENDER_RETRY_ENABLED" .env.example docs/architecture.md` → both present.

### Step 5: Full verification

**Verify**: `pnpm typecheck` → exit 0 · `cd packages/scrapers && bun test src` →
all pass, 0 fail (including #124's existing pricing tests — the scraper's public
signature is unchanged).

## Test plan

Step 2 (trigger) is the required coverage. An orchestration test (mocking
`scrapePage` to assert the second call carries `render: true`) is OPTIONAL: only
attempt it following the capture-before-mock pattern documented in
`src/jobs/__tests__/jobs-scraper.test.ts`; if Bun's `mock.module` leakage makes the
suite unstable, drop the orchestration test and say so in your report.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `cd packages/scrapers && bun test src` exits 0, incl. ≥ 4 new render-retry tests
- [ ] `grep -n "needsRenderRetry" packages/scrapers/src/pricing/render-retry.ts` → exported
- [ ] All three single-page return points + the homepage-return path use the retry (step 3 verify)
- [ ] `.env.example` + `docs/architecture.md` document `PRICING_RENDER_RETRY_ENABLED`
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `pricing.scraper.ts` no longer matches the 82-line post-#124 shape excerpted above.
- `harvestPricing` is not importable from `./harvest` (moved/renamed).
- `ScrapeOptions` has no `render` flag honored by the cascade (check how
  `jobs.scraper.ts:124` passes it — if jobs uses a different mechanism, mirror THAT
  and report the discrepancy).
- Adding the retry makes any existing pricing test fail for a reason other than an
  outdated mock of `scrapePage`.

## Maintenance notes

- **Cost profile**: worst case is one extra local L1 render per scrape for monitors
  whose pricing page genuinely shows no prices (gated "contact sales" pages). No
  proxy spend (the retry does not force a proxy level). If Trigger machine time
  becomes a concern, the lever is remembering "renders needed" on the monitor
  (requires worker-side state — out of the scrapers package's reach by design).
- The trigger reuses `harvestPricing` as the price oracle: if harvest's `PRICE_RE`
  ever gets stricter, the retry fires more often — keep them co-reviewed.
- Related-but-different: the audit's DIF-6 (annual-only price changes invisible
  because the toggle block is stripped from the content hash) is NOT addressed here
  — it needs a hash-side change, own plan.
- Reviewer focus: step 3.4 (homepage path) — confirm the re-render targets
  `resolvedBase` (the post-redirect URL), not the stored monitor URL.
