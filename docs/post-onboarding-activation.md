# Post-onboarding activation & retention — killing the void

Spec for closing the two engagement voids: (I) the gap between onboarding
completion and the first real signal, and (II) the quiet periods where the
product works but has nothing to say. Eleven levers, sequenced.
Written 2026-07-01, extended same day after research round 2.

## Problem — two voids, both structural

**Void 1 (day 0).** A signal requires `snapshot A → snapshot B → diff →
change → classify (significant) → signal`. For a fresh org the second scrape
is one frequency interval away (daily/weekly), and even then a signal only
exists if the competitor *actually changed something* AND the classifier
deems it significant. Realistic first-signal latency: **days to weeks**.
Today the patch-25 streaming panel
(`apps/web/src/hooks/use-onboarding-streaming.ts`) covers the first minutes
(competitor analysis, proxy `competitors.ai_summary`), then the user faces an
empty feed with no reason to return.

**Void 2 (quiet periods).** The weekly digest **skips orgs with no signals**
— so in a calm week the product goes silent and invisible, exactly when the
user starts doubting it runs at all. For a monitoring product, absence of
change IS information; silence must be reframed as proof of work.

Known metric bug: `ONBOARDING_EVENTS.FIRST_SIGNAL_RECEIVED` fires when the
first `aiSummary` lands — NOT a real signal. The funnel cannot currently
measure true time-to-first-signal (fixed in Lever 3).

Why it matters (2026 benchmarks): first value < 14 days → ~80% retention at
M12; > 30 days → 35–50%. Aha < 5 min → +40% D30 retention. ~75% of churn
risk is decided by onboarding. Behavior-triggered lifecycle emails convert
up to +30% vs time-based drips.

Competitive read: Kompyte/Crayon/Klue fill the void with **humans** (CSMs,
assisted setup) — we are self-serve and fill it with product. Klue's instant
AI competitor profiles and Competely's instant analysis validate the
"state-of-the-world at T0" move. **Owler** is the closest self-serve
comparable: its retention engine is not the app but the **Daily Snapshot
email** (5M+ free users). The product lives in the inbox; retention for a
monitoring tool is measured in briefing opens, not DAU.

**Meta-pattern: decouple "state of the world" value (available at T0) from
"change" value (inherently delayed). Bootstrap change value from the past
(archives, dated feed content) instead of waiting for the future. Between
changes, communicate the work, not just the events.**

---

# Part I — Day 0

## Lever 1 — Day-0 Competitive Landscape

> "Here is where you stand today" — minutes after onboarding, zero diff.

Available after the **first scrape wave** (already triggered by onboarding):

| Data | Table / source | Available |
|---|---|---|
| Per-competitor AI summary | `competitors.ai_summary` | ~minutes |
| Current pricing + trial facts | `pricing_history` (extract-pricing runs on every scrape, not on diffs; patch-33 trial columns) | ~minutes |
| Hiring picture | `job_postings` + `job_counts` | ~minutes |
| Review standing + sub-scores | `review_scores` | ~minutes |
| Tech stack | `tech_stack_entries` (due at next 6h cron) | < 24h |
| Platform profile | `competitors.platform_profile` | ~minutes |
| **Recent activity (last ~90 days)** | first snapshot of feed-like sources — see below | ~minutes |

**Free backfill from feed sources (round 2 find).** The `news`, `blog`,
`changelog` (RSS/Atom, patch-32) and `jobs` sources carry *inherently dated*
content in their very first snapshot: recent funding/launch events, latest
posts, latest releases, currently-open roles. No diff, no Wayback needed —
render a "Recent activity" timeline in the landscape directly from the first
scrape. This alone makes day 0 feel alive and narrows Lever 2's scope to
homepage + pricing.

### Build

- **API**: `apps/api/src/routes/landscape.ts` — `GET /api/landscape`
  (org+product-scoped). One aggregate payload: pricing side-by-side (latest
  `pricing_history` per competitor via `distinct on`, + self), hiring (active
  postings + top departments), reviews (latest per source), summaries,
  trial-facts comparison, recent-activity timeline (parsed from the latest
  feed-source snapshots). Reads via `analytics-safe` where applicable.
- **Web**: Overview cold-start state (and/or empty Signals feed) renders the
  Landscape instead of a waiting screen. Query factory in `lib/queries.ts`,
  RSC prefetch per the TanStack pattern.
- **AI-free v1.** Deterministic comparisons only.

No migration, no new job, no new env var. All tiers.

## Lever 2 — Archive backfill (Wayback Machine)

> Real signals at minute 0, by diffing the archived past against the present.
> The differentiator — Crayon/Klue don't backfill. Scope: homepage + pricing
> (feed sources already self-backfill, see Lever 1).

### Mechanism

1. Event-triggered job `backfill-history` fired from onboarding complete
   (and optionally manual competitor add). See "Queue constraints" below —
   no cron either way.
2. For each competitor × source in `BACKFILL_SOURCES` (homepage, pricing):
   query the Wayback CDX API for snapshots near `now - BACKFILL_LOOKBACK_DAYS`
   (default 90). Fetch the **raw** archived page via the `id_` flag
   (`https://web.archive.org/web/<ts>id_/<url>`) so the Wayback toolbar/
   rewriting chrome is absent. No key required; sequential per org, ~1 req/s.
3. If found: R2 upload **before** DB (as always), insert a `snapshots` row
   with `scraped_at` = archive capture time and `origin = 'archive'`.
4. Create a `changes` row (`snapshot_before` = archive, `snapshot_after` =
   current first scrape) → hand off to the **existing**
   `classify-change → generate-signal` chain untouched. FK chain satisfied
   with real rows.
5. **Pricing history seeding (round 2)**: for the pricing source, fetch 2–3
   archive points (e.g. 30/90/180 days) and run each through
   `extract-pricing` → backdated `pricing_history` rows → the pricing trend
   chart has depth on day 0 instead of a single dot. (Analytics tables are
   append-only, best-effort — backdating `recorded_at` is safe.)
6. No archive coverage → skip silently (best-effort, logged).

### Dispatch & presentation

- Backfilled signals must **never** email/Slack: the generate-signal payload
  carries `backfill: true`; stamp `signals.filtered_reason = 'backfill'`,
  `dispatched_channel = 'in_app_only'`. No dispatcher logic change.
- UI badge: "From archive — happened between {archive date} and today"
  (derived via change → snapshot_before.origin).

### Migration (single column)

```
snapshots + origin  text NOT NULL DEFAULT 'live'   -- 'live' | 'archive'
```

### Env

```bash
BACKFILL_ENABLED=true
BACKFILL_LOOKBACK_DAYS=90
BACKFILL_SOURCES=homepage,pricing
```

All tiers in v1; deeper lookback for pro+ is a later monetization knob.

### Risks

- Archived HTML stale/partial → the classifier already filters noise; worst
  case backfill yields nothing (= today's status quo).
- Homepage archive-vs-live diff is lexical (no stored `homepage_structure`
  for the archive side) → fine, that's exactly the lexical fallback path.

## Lever 3 — Named aha moment + quick win + investment

> Aha = **"I learned something about a competitor I didn't know"** — not
> "I configured monitoring".

- **Quick-win cards**: 2–3 "Did you know?" cards atop the Landscape, from
  deterministic rules over Lever 1 data (pricing delta vs self, hiring
  spike, review-score gap). Pure functions in the API, unit-testable, no AI.
- **Investment step (round 2, Hooked model)**: right after the reward, ask
  for it — useful / not useful on the first insight shown. This feeds the
  existing relevance-threshold learning (patch-26) and starts the stored-
  value loop on day 0. One tap, no new schema (`quality_feedback` exists).
- **Checklist (3–4 items max)** on the Overview, derived from existing data
  (no migration): ① See your landscape (auto) ② Ask Outrival a question
  (`ask_history`) ③ **Choose your briefing cadence** (Lever 11 — replaces
  the generic "configure notifications") ④ Generate a battle card
  (plan-aware).
- **Fix the funnel**: keep `FIRST_SIGNAL_RECEIVED` (analysis-ready) for
  continuity; add `onboarding_first_insight_viewed` (the aha) and a
  server-side `first_real_signal` milestone stamped into
  `onboarding_sessions.timings` by generate-signal on the org's first-ever
  signal. Activation = % orgs with first_insight_viewed in session 1; north
  star = median true time-to-first-signal (collapses once Lever 2 ships).

## Lever 4 — Transparent waiting

> Never an empty state without a horizon.

- **Per-source progress lights** per competitor (pricing ✓, hiring ✓,
  blog ⏳) from `monitors.last_run_at` / snapshots — extends the existing
  streaming panel / analysis-status indicator, no new mechanism.
- **Honest expectation copy**: "Next change check: in ~Xh" (min
  `monitors.next_run_at`) — never promise a signal ETA.
- **Example signal card** in the empty feed, labeled "Example" (reuse the
  PR #25 sample-mode pattern).

## Lever 5 — Behavioral lifecycle sequence (upgraded from "welcome digest")

Behavior-triggered, never purely time-based; exit the sequence the moment
the user activates.

1. **D0 welcome digest** at onboarding complete: landscape summary — "Here's
   your starting position; we'll email when it moves." Reuses digest HTML
   shell + Resend.
2. **D+2 nudge, only if the user hasn't returned**: "Here's what we've
   already checked" (counts from `scrape_runs`). Post-queue-migration this
   is a native delayed job (`startAfter`); until then Resend `scheduledAt`
   + cancel-on-return, or piggyback on an existing daily cron.
3. **First-change celebration** (any time it happens): the single most
   important email in the product — "Your monitoring just paid off",
   deep-link to the signal. Distinct template, not a digest line.
4. **Ask Outrival prefills** on the empty feed/landscape: "Who changed
   pricing recently?", "Where am I the most expensive?", "Who is hiring
   fastest?" — turns waiting into exploration. Web-only.

---

# Part II — Beyond day 0 (the quiet-period problem)

## Lever 6 — "All quiet" digest (validated)

Stop skipping no-signal orgs in the weekly digest. Send the light variant:
"We checked N pages, M times this week. No significant moves — your market
was calm." Counts from `scrape_runs` (org-scoped, best-effort). Optionally
surface the one minor below-threshold change. In-app mirror: "Last check:
2h ago — all quiet" on the feed empty state. Trivial effort, closes Void 2.

## Lever 7 — AI Visibility teaser at onboarding (validated, cost ≈ 0)

The feature exists (docs/ai-visibility.md, ships dormant). One **free
one-time run** during onboarding: "AI answer engines recommend
{competitor} 3× more often than you." Emotional, instant, no CI competitor
does it at onboarding — and a natural upgrade hook for the pro+ tracked
version.

**Cost-zero design (hard requirement):**

- **Engine = Gemini Flash + Google Search grounding, free tier**: 1,500 free
  grounded requests/day (Gemini 2.5 family; 3.x family: 5,000/month). New
  engine adapter next to the Perplexity one; skipped if `GEMINI_API_KEY`
  empty — same pattern as `PERPLEXITY_API_KEY`. At 3 prompts/org that is
  ~500 onboardings/day before spending a cent. Bonus: "your visibility in
  Google's AI answers" is the most relatable engine for users.
- **3 prompts max** for the teaser (`AI_VISIBILITY_TEASER_MAX_PROMPTS=3`),
  vs 10 for the paid tracked runs.
- **Cross-org result cache** keyed by (engine, prompt hash), TTL ~7 days:
  orgs in the same category generate overlapping prompts ("best {category}
  tools") → marginal cost trends to zero at scale. Same cross-org-cache
  precedent as `parser_extractors`.
- **One run ever per org** (flag on org / derived from existing
  ai_visibility run rows), kill-switch env, never blocks onboarding
  (best-effort, renders when ready).

Fallback if no Gemini key: Perplexity `sonar` at 3 prompts ≈ $0.02/org, or
teaser silently absent. Never a paid call without an explicit key present.

## Lever 8 — Shareable artifacts / send-to-boss loop (validated)

- **Public read-only share links** for battle cards (PDF already exists) and
  the Landscape as a "Competitive Snapshot Report".
- Mechanism: unguessable token per artifact (new small table or column,
  org-scoped, revocable), public Next route rendering a static view.
  "Powered by Outrival" footer → acquisition loop. Sharing offered at the
  moment of completion (generate/battle-card ready), per the PLG pattern —
  not buried in menus.
- No dependency on multi-user (Phase 10); this is artifact-level, not
  workspace-level.
- Security note: share links expose competitive analysis — default OFF,
  explicit user action to create, revocable list in settings, no index
  (`noindex`, no sitemap).

## Lever 9 — Monthly "Competitive Recap" (validated)

Monthly email + in-app page: N changes tracked, biggest move, most active
competitor, quietest competitor, your feedback stats. All from
`signal_feed` / `scrape_runs` / `signals`. Year-in-review-style emails are
among the highest-engagement SaaS emails and re-activate dormant users;
monthly cadence fits competitive tempo. 3–5 metrics max, visual. Reuses the
digest shell. (Quarterly "wow" edition later, shareable via Lever 8.)

## Lever 10 — Visible learning loop (validated)

The auto-adjusted relevance threshold (patch-26) is invisible today.
Surface it: "Signal quality: learning from your feedback — 7/10 marked
useful" (from `quality_feedback` + `org_relevance_threshold.source =
'auto_adjusted'`). Small settings/feed widget. Users who see their
investment working invest more (Hooked: investment phase) and churn less
(perceived switching cost). No migration.

## Lever 11 — "Daily Briefing" packaging (validated)

The `digest_daily` channel mode (patch-26) exists but is buried in
notification settings. Repackage, don't rebuild:

- Onboarding checklist item: "Choose your briefing cadence" (daily /
  weekly / real-time per severity) — explicit habit contract on day 0.
- Brand the sends: "Your Monday Competitive Briefing" (weekly),
  "Daily Briefing" (daily digest, already sent at local `quiet_hours_end`).
- North-star retention metric for the product: **briefing open rate**, not
  DAU. The app is where you dig; the inbox is where the habit lives.

---

## Sequencing

| Phase | Content | Effort | Why this order |
|---|---|---|---|
| 1 | Lever 1 (landscape + recent activity) + Lever 3 (aha/quick wins/checklist) + Lever 4 (transparent waiting) | M+S+S | The day-0 experience, all data already exists, no migration |
| 2 | Lever 6 (all-quiet digest) + Lever 11 (briefing packaging) + Lever 10 (visible learning) | S+S+S | Three trivial retention wins while Phase 1 is fresh |
| 3 | Lever 2 (archive backfill + pricing-history seeding) | L | The differentiator; own chantier (job + migration + Wayback client) |
| 4 | Lever 7 (AI Visibility teaser, Gemini free tier) + Lever 8 (share links) | M+M | Wow + distribution, after the core void is closed |
| 5 | Lever 5 (full behavioral sequence) + Lever 9 (monthly recap) | M+S | Lifecycle polish on top of everything above |

## Reuse vs build

| Reused untouched | New |
|---|---|
| Pipeline `classify-change → generate-signal` (backfill feeds real rows) | `routes/landscape.ts` + Landscape view + queries factory |
| Dispatcher patch-26 (backfill stamps; digest_daily channel) | `backfill-history` job + Wayback CDX client (`packages/scrapers`) |
| `ai_summary`, `pricing_history`, `job_counts`, `review_scores`, `tech_stack_entries`, `platform_profile`, feed-source snapshots | Migration: `snapshots.origin` (+ share-token storage for Lever 8) |
| Digest HTML shell + Resend + local-time send (quiet_hours_end) | Quick-win rules module + checklist + learning-loop widget |
| AI Visibility engine abstraction + prompts/results tables | Gemini grounding engine adapter + teaser cap + cross-org cache |
| `quality_feedback` + `org_relevance_threshold` (patch-26) | New PostHog events + `first_real_signal` milestone |
| Sample mode / streaming panel / SSE / Ask panel | Public share routes + token table (Lever 8) |

## Constraints checklist (repo invariants)

- **Queue migration in flight** (`docs/trigger-to-pgboss-migration.md`,
  pg-boss chosen, `packages/queue` Phase 0 done): every new job must be
  added to the `@outrival/queue` registry so it doesn't widen the migration
  surface. Until the migration lands, no new Trigger crons (cap 10/10 —
  an 11th declarative cron aborts the deploy); event-triggered semantics
  work identically on both sides. Post-migration, delayed jobs
  (`startAfter`) replace the Resend `scheduledAt` workaround in Lever 5.
- R2 before DB for any snapshot (backfill included).
- `signals.change_id` NOT NULL FK chain → backfill creates real
  monitor/snapshot/change rows, never synthetic signals.
- English-only UI/emails from the first commit.
- Migrations versioned (`db:generate` → `db:migrate`), **direct** Neon
  endpoint (the pooler hangs drizzle-kit).
- No paid AI call without an explicit provider key configured (teaser
  degrades to absent, never to a surprise bill).
- WSL2: typecheck is the gate, no local `next build`.
