# Full-site audit — 2026-07-02

Scope: public landing (incl. the uncommitted overhaul in the tree), dashboard, settings,
API, DB, workers. Dimensions: security, performance, scalability, on-screen elements
(a11y/UX/content), operations. Method: five parallel specialized reviews (security /
web perf / backend scalability / landing / dashboard+settings), followed by manual
verification of every top-severity finding against the current source. Findings marked
**✓** were hand-verified at the cited line; the rest were reviewer-reported against
specific code and are high-confidence but not independently re-read.

Static analysis only (WSL2 — no dev server / build / lighthouse run). The prior
`docs/web-audit-2026-06-30.md` (130 findings, unverified) was used as a baseline: its
findings are **not** repeated here except for a fixed/still-present status pass (§6).

**Verdict**: the codebase's invariants hold — tenant isolation, SSRF guards at persisted
entry points, CORS, anti-enumeration, Stripe scoping, R2-before-DB, idempotence keys all
verified healthy. No critical security finding. The real exposure is concentrated in
(a) five merge-blockers on the uncommitted landing branch, (b) a cluster of
"dead-in-prod" protections (retention purge, discovery cooldown, workers Redis), and
(c) scalability debt that is invisible today and expensive at ~50 orgs.

---

## 1. P0 — merge blockers on the landing branch (fix before commit)

| # | ✓ | Finding | Where |
|---|---|---------|-------|
| 1 | ✓ | **`/og.png` does not exist** — `public/` contains only `.gitkeep`, yet root metadata (OG + Twitter) and JSON-LD `logo` all reference it. Every social share renders a blank/broken card. Ship a 1200×630 `public/og.png` or an `opengraph-image.tsx`. | `app/layout.tsx:87,99`, `components/landing/json-ld.tsx:46` |
| 2 | ✓ | **Home `<title>` double-branded** — root layout template `"%s — Outrival"` applies to `page.tsx`'s full-string title → tab/SERP show `Outrival — … written by AI — Outrival`. Use `title: { absolute: … }` or drop the page title (layout default already matches). | `app/layout.tsx:61` + `app/page.tsx:21` |
| 3 | ✓ | **Dark landing theme is dead CSS** — `.dark.landing-canvas` is a compound selector but `dark` sits on `<html>` and `landing-canvas` on a descendant `<div>`; it never matches, so the graphite canvas + softer border silently no-op. Change to `.dark .landing-canvas`. | `app/globals.css:554` vs `app/page.tsx:29` |
| 4 | — | **Footer publishes a legal identity to verify** — "© 2026 Outrival SAS · 8 rue de la Paix, 75002 Paris" + "RCS Paris 932 481 297". If the RCS number is fabricated (consistent with the fictionalize-examples pass), publishing a fake commercial-registry number is legal exposure, not polish. Confirm real or remove until incorporation. **User decision required.** | `components/landing/footer.tsx:76-78` |
| 5 | ✓ | **Footer "Product" links dead off the home page** — bare `#sources`/`#pipeline`/`#signals`/`#compare`/`#pricing`; the footer is shared with `/demo` and all doc pages where those ids don't exist. Prefix with `/` (`/#sources`, …). | `components/landing/footer.tsx:48-52` |

Also strongly recommended before merge (content integrity):

- **Business plan sells features that don't exist** — "Multi-user · API access", "audit
  logs" (`pricing.tsx:82-84`, `demo/page.tsx:21-23`); multi-user is Phase 10, public API
  Phase 11. Reword ("coming soon" / "early access") or drop.
- **Latency claims contradict on one page** — "≤5 min" (`trust.tsx:29-33`,
  `digest-feature.tsx:63`) vs "within the minute" (`alerts.tsx:54-55`). Pick ≤5 min.
- **"All systems operational" is hardcoded** in the footer (`footer.tsx:80-86`) and the
  static `/status` page — during a real incident the site asserts health. Label the link
  "Status" and mark the page informational (or wire to `/health`).
- **Primary CTAs scroll to `#cta` instead of `/auth`** (`nav.tsx:68`, `hero.tsx:53`,
  `sources.tsx:127`) — an extra hop on the conversion path. Confirm intentional.

## 2. P1 — structural production risks (backend/scale)

| # | ✓ | Finding | Where |
|---|---|---------|-------|
| 1 | ✓ | **Retention purge is dead in prod** — the cron is commented out (Trigger 10-schedule cap), so `historyRetentionDays` is enforced nowhere; and `scrape_runs`/`ai_runs`/`extraction_runs`/`platform_detection_runs` are deliberately excluded with **no purge path anywhere**. ~4M `scrape_runs` rows/yr at target scale. Re-enable in the pg-boss migration (no schedule cap there) + add a fixed-window purge for ops tables. When it first runs, batch the DELETEs (`purge-retention.job.ts:41-101` does unbounded single-statement deletes over a months-deep backlog). | `apps/workers/src/jobs/purge-retention.job.ts:21-23,10-13` |
| 2 | ✓ | **`scrape_runs` lacks `(competitor_id, recorded_at)`** — only `(recorded_at)` and `(monitor_id, recorded_at)` exist, while `packages/db/CLAUDE.md` and `docs/architecture.md` claim the competitor index. The Activity timeline filters `competitor_id IN (~50 ids) ORDER BY recorded_at DESC` plus a `count(*)` with two correlated `EXISTS` over the org's whole history → near-full-table scan per page load once the table grows. Add the index; align the docs; consider estimating `total`. | `packages/db/src/schema/analytics.ts:158-161`, `apps/api/src/routes/activity.ts:356-374,504-528` |
| 3 | — | **SSE fan-out: one DB query + heartbeat per connection every 3s** against the shared 10-connection postgres-js pool. Fine at 100 connections (~33 q/s); at ~1000 it funnels 333 q/s through 10 connections and any slow analytics query saturates ALL API latency. No per-user connection cap either. Replace with one shared 3s poller fanning out in-process per org (or LISTEN/NOTIFY), same wire protocol. | `apps/api/src/routes/notifications.ts:188-214`, `packages/db/src/client.ts` |
| 4 | ✓ | **`schedule-scraping` enqueues all due monitors in one unchunked `batchTrigger`** — Trigger v3 caps a batch (~500 items); daily monitors cluster on the same hour, so one oversized tick throws, the run fails, and zero monitors scrape that hour (same herd due next tick). Chunk into ≤500 slices. | `apps/workers/src/jobs/schedule-scraping.job.ts:155-163` |
| 5 | — | **Single-VPS deploy topology** — a Coolify deploy restarts the only Bun process (drops every SSE stream → reconnect storm) and `next build` competes with the running API for the same 8GB. Build images off-box (CI → registry), rolling deploys behind the health check, jitter EventSource reconnects. | infra (`docs/deployment.md`) |
| 6 | — | **Browser pool never recycles — pg-boss landmine** — one Chromium per proxy tier cached at module level, never `browser.close()` (contexts only). Safe on Trigger's per-run machines; on the coming weeks-lived pg-boss browser worker, Chromium RSS creep OOMs the 8GB VPS within days at ~10k scrapes/day. Recycle every N scrapes / RSS threshold + close tiers in the SIGTERM drain. **Must land with migration Phase 2.** | `packages/scrapers/src/lib/scrape-patchright.ts:57-65,118` |
| 7 | — | **AI pool quota/breaker state needs Redis and the Trigger workers env has none** — without Upstash, daily token quotas are unenforced, breaker state doesn't persist, and every run retries known-dead providers first (the observed cerebras-404 wasted round-trip). Provision Upstash creds on the workers env, or move breaker/quota state to Postgres. | `packages/ai/src/provider.ts:99-127` |
| 8 | — | **No `statement_timeout` anywhere** — `analytics-safe` catches errors, not slowness; one heavy LATERAL timeline query can pin a pool connection for 30s+ (three Activity tabs = 30% of the pool). Set `statement_timeout` (~10s) in postgres-js options; ideally a separate small pool for analytics reads. | `packages/db/src/client.ts`, `apps/api/src/routes/activity.ts:374-476` |

## 3. P1 — security (no criticals; mediums to schedule)

| # | ✓ | Finding | Where |
|---|---|---------|-------|
| 1 | — | **Redirect-following SSRF in `/products/analyze` (url mode)** — `validatePublicUrl` is syntactic-only and `quickFetch` runs `fetch(url, {redirect:"follow"})` in the API process; a 302 from a public host toward `169.254.169.254`/internal is followed, and the response text is AI-summarized into the returned profile (semi-blind exfiltration). Bounded to 10/h/user. Re-validate per hop (`redirect:"manual"`) or block private ranges at egress. | `packages/scrapers/src/lib/quick-fetch.ts:31-38` via `apps/api/src/routes/products.ts:87` |
| 2 | — | **IP rate limits trust client-controllable `x-forwarded-for`** — auth OTP cap, AI-intensive fallback, and the contact 5/h cap all key on `cf-connecting-ip ?? x-forwarded-for[0]`. Until Cloudflare proxying is on (grey→orange still TODO) and direct API reachability is closed, an attacker rotates the header for a fresh bucket per request. Derive the IP from the trusted edge only. | `apps/api/src/middleware/auth-rate-limit.ts:32-36`, `lib/auth.ts:18-24`, `routes/contact.ts:31-34` |
| 3 | — | **`/api/contact` has no Turnstile** — honeypot + (spoofable) IP cap only; bots can drive Resend sends to `CONTACT_EMAIL` at scale (inbox flood / quota burn; not an open relay — fixed recipient; header injection impossible via Resend JSON; HTML body escaped). Reuse `verifyTurnstileToken`. | `apps/api/src/routes/contact.ts:28-64` |
| 4 | ✓ | **Discovery cooldown hard-disabled by a leftover debug flag** — `DETECT_RATE_LIMIT_ENABLED = false` ("TEMP … pour les tests") ships the per-org 30-min cooldown off for the paid Exa call. Cost still bounded by monthly quota + AI rate limit. Flip back / delete the flag (note: the flag comment is in French; and `lastDetectAt` is an in-memory Map — single-instance state). | `apps/api/src/routes/candidates.ts:39-42` |
| 5 | — | **Turnstile silently bypassed if the secret is unset in prod** — returns `true` with no secret; unlike Upstash it's not boot-enforced by `env.ts` superRefine. Add it to the prod superRefine or fail-closed. | `apps/api/src/lib/turnstile.ts:8-11` |
| 6 | — | **`POST /products` accepts `url`/`repoUrl` without `validatePublicUrl` at input** — currently safe only because the worker fetch layer re-validates (defense-in-depth by accident). Add the refine for consistency with sibling endpoints. | `apps/api/src/routes/products.ts:190-198` |
| 7 | — | **Passkey sign-in path bypasses the 2FA hook** — passkeys are MFA-grade and flag-gated off, but this violates the documented "every sign-in method must extend the hook" invariant. Decide explicitly when enabling passkeys. | `apps/api/src/lib/auth.ts:156-159` |

## 4. P2 — performance

Dashboard:

- ✓ **`PageReveal` `key={pathname}` remounts the whole page subtree on every navigation**
  and paints it at opacity 0 for up to 500ms — state lost, effects re-run, TanStack
  observers resubscribed, nested layouts remounted. The replay is by design
  (`page-reveal.tsx:6-9` comment) but the cost isn't: drop the key or key on the
  first-level segment, and shorten to ~200-250ms opacity-only.
  (`components/dashboard/page-reveal.tsx:13-16`, `app/dashboard/layout.tsx:176`)
- **framer-motion full renderer in the shell chunk** — `motion`/`AnimatePresence`
  imported directly in sidebar/shell/lists (~30-40KB gz in every dashboard page's
  initial JS). Adopt `LazyMotion features={domMax} strict` + `m.*`.
  (`sidebar-competitors.tsx:7`, `dashboard-shell.tsx:5`, `competitors-list.tsx:8`,
  `discovery-view.tsx:5`)
- **Overview idle polling: 3 heavy queries every 30s** (signals `limit:200` with
  insight/so_what/narrative ≈ 100KB+, competitors, landscape) + aiStatus 60s + open SSE
  ≈ 7 req/min per idle tab. Invalidate from the existing SSE channel instead, or 60s +
  smaller recent-list limit. (`overview.tsx:94-95`, `landscape.tsx:159`)
- **Sidebar roster polls every 60s even when the section is collapsed**
  (`sidebar-competitors.tsx:72,149`) — `refetchInterval: open ? 60_000 : false`.
- Roster rows animate `height` (per-frame layout) and the 60s poll can reorder rows →
  background FLIP animations. Capped at 8 rows so tolerable; `layout="position"` if
  it's ever felt. (`sidebar-competitors.tsx:48-53`)

Landing (public, conversion/SEO-critical):

- ✓ **posthog-js (~50-60KB gz) statically imported in the root layout** and hydrated on
  the landing while capture is opt-out by default until consent. Dynamic-`import()` it
  in the effect, init after consent or on idle. (`lib/posthog/provider.tsx:4` via
  `app/layout.tsx`)
- **`Nav` pulls the Better Auth client and fires a cross-origin `get-session` XHR for
  every anonymous visitor** (`components/landing/nav.tsx:8,20`). Keep signed-out CTAs
  static; resolve session on idle or via a presence cookie.
- **`DigestMockup` is a client component whose only interactive path is disabled**
  (`animate={false}` at the sole call site) — hydration + JS for nothing.
  (`digest-mockup.tsx:1,89`, `digest-feature.tsx:35`)
- **`/demo` is dynamically rendered because the page reads `searchParams`** — read
  `?plan=` client-side in the form instead and let the page prerender.
  (`app/demo/page.tsx:26-31`)
- ✓ `will-change: opacity, transform` never removed after reveal — 13 persistent
  compositor layers; set `will-change: auto` in `.reveal-in`. (`globals.css:592`)
- Zodiak woff2 (2×21KB) preloaded on the dashboard where the font is never used —
  `preload: false` or move the declaration to the landing tree. (`app/layout.tsx:37-44`)

## 5. P2 — dashboard & settings UX (new findings)

- **Billing: post-checkout plan refresh is cancelled by `router.replace`** ✓ — the 2s
  `invalidateQueries` timer is cleared by the effect's own cleanup when `replace`
  changes `searchParams`; the user who just paid sees the old plan until reload while
  the toast promises "a few seconds". Invalidate before the replace, or poll until the
  plan flips. (`components/outrival/billing-dashboard.tsx:149-167`)
- **Compare: an API failure renders "Nothing to compare."** — `.catch(() =>
  setMatrix([]))` turns errors into a lying empty state, no retry/toast. Keep an error
  state + preserve the previous matrix. (`compare-view.tsx:765-769,1137-1140`)
- **Overview: competitors-query failure → skeleton forever** (error gate only checks
  `signals === null`). (`overview.tsx:198-210`)
- **Compare: products/competitors query failure → h-9 skeleton forever** (no `isError`
  branch). (`compare-view.tsx:1059-1061`)
- **Billing history section silently disappears on fetch error** (`invoices =
  data ?? []` + `length > 0 &&`) — distinguish `isError` from zero invoices.
  (`billing-dashboard.tsx:139-147,427`)
- **No path to switch monthly↔yearly on the current plan** — `selectPlan` early-returns
  on same plan and the card's button is disabled; show "Switch to yearly billing" when
  `period !== effPeriod`. (`billing-dashboard.tsx:203-212,593-600`)
- **Discovery: optimistic mutations write only the active tab's cache** — badge vs list
  desync up to 60s across tabs; invalidate/write the sibling tab key too.
  (`discovery-view.tsx:101-122,234-329`)
- **Hover-only tooltips on non-focusable spans** (Compare takeaway pill,
  `MonitoringPausedBadge`) — keyboard/SR users can't reach the explanation.
  (`compare-view.tsx:~596-618`, `competitors-list.tsx:127-151`)
- Low: `Kpi` sets prose in mono (`kpi.tsx:95,104`); sidebar shows raw plan slug
  ("· pro") (`sidebar.tsx:240`); Landscape error masquerades as healthy state +
  "captured" icon-only for SR (`landscape.tsx:162-168,456-467`); Discovery ToggleGroups
  unnamed (`discovery-view.tsx:428-452`); `scrollIntoView smooth` not reduced-motion
  gated (`billing-dashboard.tsx:312-315`).

Landing on-screen (beyond P0):

- Skip link targets `#main-content` which only the home page defines — `/demo` and doc
  pages leave keyboard users a dead first Tab. (`layout.tsx:129-133` vs
  `demo/page.tsx:51`, `doc-page.tsx:37`)
- Mockups contain real focusable dead controls — five tabbable `<Button>`s in
  `alerts.tsx:95-148`, an `href="#"` "See all" inside a `role="img"` container in
  `digest-mockup.tsx:113,140-142` (WCAG 4.1.2). Render as non-interactive spans or
  `aria-hidden` + `pointer-events-none` the whole mockup.
- Comparison "table" is a div grid with zero column association for SR + empty first
  header (`comparison.tsx:58-105`); its `overflow-x-auto` region isn't
  keyboard-scrollable (`:77`).
- Hero timeline: `aria-hidden` + hover-only tooltips while the caption points users at
  it; 50 bars ≈ 297px clip inside the 272px content box at 320px wide.
  (`hero.tsx:66-95`)
- Mobile menu: Escape + scroll-lock present, but no focus move/trap/restore.
  (`nav.tsx:87-128`)
- Sitemap lists only `/` — add `/demo`, docs, legal, status. (`sitemap.ts:7-14`)
- Demo form success replaces the form with no focus move / live region — silent for SR.
  (`demo-form.tsx:54-67`)
- JSON-LD FAQ already drifted from the visible FAQ (cancel answer) — share one FAQS
  array. (`json-ld.tsx:26` vs `faq.tsx:33`)
- "29 € / month" is French currency styling on an English page → `€29/month`.
  (`pricing.tsx:23,39`)
- Trust stats reverse `<dt>`/`<dd>` semantics. (`trust.tsx:12-41`)

Backend P2 remainders: `GET /competitors/:id/jobs` unpaginated (multi-MB on enterprise
ATS competitors, `competitors.ts:947-951`); competitor-list handler is a ~7-query
serial waterfall that could be `Promise.all`'d (`competitors.ts:603-630`, same in
`compare.ts:173-196`); `signals.product_ids` `@>` has no GIN index (fine now, slow at
20-50k signals/org — `schema/signals.ts:64,75-84`); multi-replica blockers list for
production.md (Better Auth in-memory rate limit, translate cache, `lastDetectAt` Map).

## 6. Status of the 2026-06-30 web-audit criticals/highs

Fixed since:
- ✅ CRITICAL digest rows mouse-only → full keyboard support (`digests-view.tsx:215-226`)
- ✅ (partial) competitors list: table-view name is a real focusable `<Link>`; **left**:
  `<th onClick>` sort without button/`aria-sort`, cards-view span+onClick, unnamed kebab
- ✅ (partial) activity rows keyboard-operable; nested-link semantics remain
- ✅ (partial) shell now RSC-seeds products/structural/aiStatus; sidebar roster still
  client-fetch + 60s poll

Still present (re-verified in current code): stacked FABs Ask+Feedback at the same
`bottom-5 right-5` slot; French "Fermer" in the shared Dialog (27 modals —
`components/ui/dialog.tsx:49`, one-string fix); hand-rolled notifications bell (no
ARIA/Escape/focus); Signals listbox unreachable by keyboard; search → `router.replace`
per keystroke; sub-3:1 focus ring (`button.tsx:15`); AA-failing muted tokens untouched
by the landing-only globals.css diff; systemic missing `aria-live` on saves; unlabeled
OTP input in email change; double `listAccounts()` in security settings; onboarding
3s poll storm (now compounded by Overview's two permanent 30s `refetchInterval`s);
Activity timeline still has no error branch; sidebar roster has no skeleton/error state.

## 7. Verified healthy (spot-checked invariants)

- **Tenant isolation** on all newer routes (ask tools, activity, battle-cards,
  products/my-product, candidates, competitors) — forged ids resolve to null/404.
- **SSRF guards** at all persisted scrape-target entry points + worker-layer
  re-validation; GitHub path host-locked.
- **CORS** single explicit prod origin, credentialed, no reflection; contact router
  correctly mounted public; anti-enumeration intact on the OTP route; CSV formula
  injection neutralized; `json-ld` feeds only static constants.
- **Landing architecture**: page is ~pure RSC (only Nav/DigestMockup/ScrollReveal are
  client); `ScrollReveal` is a model implementation (single observer, unobserve +
  disconnect, reduced-motion early-return, no-JS-safe). No motion/recharts on landing;
  html2canvas dynamic-imported at click; TanStack Query defaults sane (staleTime 60s,
  no focus refetch); all pollers verified to clean up.
- **English-only** holds across landing and dashboard except the one "Fermer".
- **DB discipline**: notifications SSE query exactly matches its index; monitors due
  partial index matches the scheduler predicate; pagination bounded on
  signals/notifications/ask/reviews/activity; no classic N+1 in hot routes; signal
  idempotence enforced in schema (`signals_change_id_uq`); R2-before-DB everywhere;
  quotas that matter (rescan, discovery monthly) are DB-counted and Redis-free.
- **Reduced motion**: global CSS kill-switch + `MotionConfig reducedMotion="user"` +
  per-component gates cover PageReveal, roster, Discovery, Compare.
- **Paywall coverage** wired on every gated action checked; downgrade flow enumerates
  frozen competitors before confirming; monitoring-pause states honest.

## 8. Suggested order of attack

1. **Landing P0** (§1) — five fixes + the content-integrity items; all small, all
   pre-merge. The RCS line needs a user decision.
2. **One-line flips**: `DETECT_RATE_LIMIT_ENABLED`, "Fermer", Turnstile on `/api/contact`,
   `scrape_runs` index + doc alignment, `will-change: auto`.
3. **Billing checkout invalidation bug** (§5, user-visible money path) + the four
   error-state gaps (Compare/Overview/invoices/Activity).
4. **Scale cluster** (§2) — fold the purge-cron re-enable + browser-pool recycling into
   the pg-boss migration (both are worker-lifecycle items); chunk `batchTrigger`;
   `statement_timeout`; SSE shared poller can wait until real connection counts justify it.
5. **Perf pass**: PageReveal remount, posthog dynamic import, LazyMotion, Overview
   polling → SSE-driven invalidation.
6. Cloudflare grey→orange + trusted-IP derivation together (they're one workstream),
   then the Redis-on-workers decision (Upstash vs Postgres state).
