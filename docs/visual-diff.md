# Visual diff — before/after homepage screenshots (Phase 8 / "E")

> Engineering spec. Surface the **before/after screenshot** of a homepage change on
> the signal, with the changed areas made obvious — the Visualping "show me the
> change, don't describe it" move. **No AI** (pure image / structured-diff driven).
> Roadmap: Notion *Feature — Diff visuel before/after (screenshots)* (Later).
> Companion grounding for `architecture.md` (R2 layout, pipeline).

## 1. Goal / non-goals

**Goal.** From a signal whose change is a homepage diff, let the user see the page
*before* and *after* side by side (and via a wipe slider), with changed regions
highlighted, to confirm the finding in one glance.

**Non-goals (v1).** Non-homepage sources (pricing/jobs/reviews already have
structured tabs); AI/LLM involvement; mobile-viewport diffs; historical backfill of
old changes; pixel-perfect region detection on reflowed pages (see §6 caveat).

## 2. Current state (grounded — verified 2026-06-26)

What already exists, so v1 is mostly *plumbing + UI*, not new capture:

- **Screenshots are captured and stored.** `packages/scrapers/src/lib/scrape-patchright.ts`
  captures `screenshotBuffer` when `options.screenshot` is set (homepage-only, for the
  patch-17 pHash). `apps/workers/src/jobs/scrape-monitor.job.ts` uploads it to R2 at
  **`{r2Key}.png`** (derived from the HTML key by extension swap) when the buffer is
  non-empty. `fullPage: true`.
- **Schema is ready.** `snapshots.r2_key` + `snapshots.screenshot_phash` (hex dHash,
  homepage-only, populated post-patch-17). No separate PNG-key column — the `.png` key
  is derived. `changes.snapshot_before_id` (**nullable**) + `changes.snapshot_after_id`
  (not null) → `signals.change_id` (unique). Full linkage exists.
- **R2 read works.** `packages/shared/src/r2/client.ts` → `getBytesFromR2(key)` returns
  bytes. A **serving pattern already exists**: `apps/api/src/routes/admin/feedback.ts`
  streams an R2 PNG to the browser (`getBytesFromR2` → `new Response(bytes, {Content-Type})`).
- **Signal detail route already joins the change + after-snapshot** but **deliberately
  exposes only `resolvedUrl`**, never the R2 key ("NEVER the R2 snapshot … lives in
  admin tooling" — `apps/api/src/routes/signals.ts` ~L177-214). v1 relaxes this *for
  the owning org only*, via a proxy (keys still never leave the server).
- **Structured homepage diff exists.** The diff path already produces section-level
  changes (hero / sections by H2 / nav / footer / social proof) + enrichments
  (`visual_redesign` from pHash Hamming distance). This is a semantic signal for
  *which* regions changed — useful for highlighting without pixel math (§6).
- **Not built:** any `/api/.../screenshot` endpoint for snapshots; web `Signal` /
  `SignalDetail` / `SignalChange` types carry **no image references**; the
  `diffs/{change_id}/` R2 layout is docs-only; no screenshot is shown in
  `why-insight-panel.tsx` / `signal-card.tsx` today.

## 3. Design overview

```
signal ──> change ──> snapshot_after  (r2_key → {r2_key}.png)
                 └──> snapshot_before (nullable; {r2_key}.png)
```

- **Never expose R2 keys to the client.** Stream PNGs through an **org-scoped proxy**
  (reuse the feedback-route pattern). The signal→org check already exists in the
  detail route; reuse it.
- **Availability is computed server-side** and returned as booleans on the signal
  detail, so the UI only renders the diff section when both images exist.
- **No DB migration for v1** (keys derived). A diff cache (v3) may add columns later.
- **Kill-switch:** `VISUAL_DIFF_ENABLED` (default true), matching the project's
  feature-flag convention (`STAGED_EXTRACTION_ENABLED`, `PLATFORM_DETECTION_ENABLED`).

## 4. Phased plan

### Phase 1 — MVP: side-by-side + wipe slider (the 80% value)

**API** (`apps/api/src/routes/signals.ts`)
1. Extend `GET /api/signals/:id/detail` response with:
   ```ts
   screenshots: {
     before: boolean;   // before snapshot exists, homepage, screenshot_phash != null
     after:  boolean;
     sourceType: SourceType;
   }
   ```
   `screenshot_phash != null` is the cheap, reliable proxy for "a PNG was captured"
   (avoids an R2 HEAD per request). Gate the whole block on `sourceType === "homepage"`
   and `VISUAL_DIFF_ENABLED`.
2. New streaming route `GET /api/signals/:id/screenshot/:side` (`side` ∈ before|after):
   - `authMiddleware`; resolve signal → its `org_id`, **403 if not the caller's org**
     (same isolation as the detail route).
   - Resolve `changeId` → before/after snapshot → `r2_key` → `getBytesFromR2(`${r2_key}.png`)`.
   - `Response(bytes, { "Content-Type":"image/png", "Cache-Control":"private, max-age=86400" })`.
   - 404 when the side/snapshot/PNG is absent (before is nullable; old snapshots).

**Web**
3. Types (`apps/web/src/lib/api.ts`): add `screenshots` to `SignalDetail`.
4. New component `components/outrival/visual-diff.tsx`:
   - **Side-by-side** before/after (two scaled `<img>` from the proxy URLs), labels
     "Before · {date}" / "After · {date}" (mono meta), each opening full-res in a dialog.
   - **Wipe slider** mode (a draggable handle revealing after-over-before) — beloved
     Visualping UX, needs no pixel math, handles differing heights by anchoring top.
   - Lazy: only fetch images when the section is opened/visible (`loading="lazy"` +
     render under a "Visual change" disclosure).
   - Empty/degraded states: "No before snapshot" (first capture) / "No screenshot for
     this source" (non-homepage) — never a broken image.
5. Mount it in `why-insight-panel.tsx` as a **"Visual change"** section (the existing
   evidence/detail surface), shown only when `detail.screenshots.before && .after`.

**DoD Phase 1:** open a homepage signal → see before/after + slider, scoped to the
org, degrade gracefully when a side is missing. typecheck + build green.

### Phase 2 — changed-zone highlighting (pure image diff)

- Add `pixelmatch` + `pngjs` (or canvas) to **@outrival/web** (client-side; keeps it
  off the hot worker path, no R2 writes).
- In `visual-diff.tsx`, an **"Overlay" mode**: draw both PNGs to canvas, **normalize to
  a common width** (scale), diff the overlapping height, render changed pixels as a
  tinted mask + bounding boxes over the after-image.
- Toggle: **Side-by-side · Slider · Overlay**.
- Caveat handling: see §6 (reflowed full-page heights). Overlay is best-effort; the
  slider + side-by-side remain the reliable default.

### Phase 3 — future (own cards / not now)

- **Worker-precomputed diff** at the documented `diffs/{change_id}/{before,after,overlay}.png`
  + a `bounding_boxes` JSON, written by `scrape-monitor` when a homepage change is
  detected → instant render, no client compute. (Adds R2 writes + a `changes.diff_r2_key`
  column → migration.)
- **Structured-section highlighting:** capture element bounding boxes at scrape time and
  map the *structured* diff sections (hero/nav/footer…) to screenshot regions — more
  meaningful than pixelmatch, avoids reflow noise. Scraper change.
- **Heatmap** (the second Notion card *Diffs visuels (before/after + heatmap)*): change
  density over time. Keep that card for this.

## 5. Security / privacy

- R2 keys never reach the client; only the proxy streams bytes.
- The proxy re-runs the **org ownership check** per request (signal → org_id === session
  org). Mirrors the existing detail route; a forged signal id from another org → 403/404.
- `Cache-Control: private` so a shared cache can't leak a competitor screenshot.

## 6. Edge cases & the reflow caveat

- **Before is null** (first-ever snapshot for the monitor) → after-only, no diff.
- **Non-homepage sources** → no screenshot (capture is homepage-only today) → section
  hidden. Extending capture to other sources is a separate scope.
- **Pre-patch-17 snapshots** → `screenshot_phash` null → treated as "no screenshot".
- **Differing dimensions (the real wrinkle):** `fullPage` screenshots change *height*
  between captures (content added/removed), so naive `pixelmatch` (which requires equal
  dimensions) fails. Phase 1 sidesteps this entirely (side-by-side + top-anchored
  slider). Phase 2 normalizes width and diffs the overlapping height only, and is
  explicitly best-effort; the trustworthy long-term answer is structured-section
  highlighting (Phase 3), which is reflow-immune.
- **Large/tall PNGs:** lazy-load; cap displayed width; full-res on click only.

## 7. Dependencies, env, files touched

- **Deps (Phase 2 only):** `pixelmatch`, `pngjs` → `--filter @outrival/web`.
- **Env:** `VISUAL_DIFF_ENABLED=true` (kill-switch) → `.env.example` + `architecture.md`.
- **No migration** for Phases 1–2.
- **Files:** `apps/api/src/routes/signals.ts` (detail field + new route),
  `apps/web/src/lib/api.ts` (type), `apps/web/src/components/outrival/visual-diff.tsx`
  (new), `apps/web/src/components/outrival/why-insight-panel.tsx` (mount). Docs:
  `architecture.md` (R2 `diffs/` + new route + env).

## 8. Testing

- API: `signals/:id/screenshot/:side` returns 200+PNG for an owned homepage signal with
  a captured snapshot; 403 cross-org; 404 missing before/non-homepage. Detail
  `screenshots` flags correct (homepage w/ phash vs not).
- Web: build green; visual-diff renders side-by-side + slider; degraded states; no
  broken images when a side is absent.

## 9. Open questions

1. Surface a small **before/after thumbnail on the signal card** (feed), or keep the
   diff only in the "Why this insight" panel? (Recommend: panel first, thumbnail later.)
2. Phase-2 region diff **client-side** (chosen — no worker cost) vs worker-precomputed
   (Phase 3, faster render, adds storage). Start client-side.
3. Should `visual_redesign` signals (pHash-flagged) get a **"Redesign" badge** linking
   straight to the overlay? (Cheap, high-signal — likely yes.)
