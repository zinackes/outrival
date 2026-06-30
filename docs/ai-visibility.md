# AI Visibility / "Share of Model" — mini-spec

Status: **proposed** (P1 in `docs/page-audit-2026-06-30.md`). Mini-spec, not a full
design. Goal: track how the org's own product and its tracked competitors appear in
the answers of consumer LLM engines (ChatGPT, Perplexity, Claude, Gemini, Google AI
Overviews) for buyer-intent prompts — a competitive surface that website-diffing
cannot see.

## Why now

- **40% of B2B buyers shortlist via AI assistants before Google** (2026). Whether you
  show up in "best `<category>` tool" / "`<competitor>` alternatives" is a real, fast-
  moving competitive position with zero visibility in the current pipeline.
- **Fastest-growing CI-adjacent category in 2026** (Profound, Frase, Otterly, Peec, …)
  at $39–500/mo — Outrival's exact segment and price point.
- **Incumbents are weak here** (Crayon/Klue only "increasingly" track it) — a window.
- **Additive, not a new product.** Reuses the competitor set, AI provider pool, the
  analytics tables, and the signal pipeline. Modeled on the tech-stack scraper
  (patch-18): an independent, off-cascade job with its own cadence and analytics table
  that emits synthetic signals into the existing feed.

## Non-goals (keep it lean)

- **Not a GEO optimization suite.** No on-page audits, no "improve your citation
  likelihood" recommendations, no content generation. That's a different product.
- **Not real-time.** Weekly cadence, like reviews.
- **No prompt-engineering UI** beyond an editable prompt list in MVP.

## What it is (one paragraph)

For a small set of org-defined **prompts**, query each **engine** once per run, capture
the answer, then use the internal AI pool to extract which of {self + tracked
competitors} are **mentioned**, in what **order**, and whether **cited** (linked as a
source). Aggregate to **share-of-voice per engine** over time, surface the answer text
as evidence, and emit a **signal** when the picture shifts (a competitor overtakes you,
you drop out of an engine, a new competitor appears in answers).

## MVP scope

- Self (the `type=self` competitor) + up to N tracked competitors as the parsed subject
  set (no per-competitor querying — they're parsed out of one answer).
- 3 engines to start: **Perplexity** (API, web-grounded), **OpenAI** (gpt-4o w/ web
  search), **Google AI Overviews** (via a SERP provider). Claude + Gemini in phase 2.
- 5–10 prompts/org, auto-seeded from product category + competitor names, user-editable.
- Weekly cadence. One chart (SoV-over-time per engine) + a prompt-level table with the
  actual answer excerpt as evidence.

## Data model

New **append-only analytics** table (`packages/db/src/schema/analytics.ts`, same
best-effort pattern as `review_scores` — no FK, indexed on `(competitor_id,
recorded_at)`):

```
ai_visibility_results
  id, org_id, prompt_id, competitor_id (the mentioned subject; self or external),
  engine (enum: chatgpt | perplexity | claude | gemini | google_aio),
  mentioned (bool), rank (int, nullable — order of first mention in the answer),
  cited (bool — appeared as a linked source), sentiment (real, nullable),
  answer_excerpt (text, truncated ~2KB), run_id (groups one engine×prompt sweep),
  recorded_at
```

New **config** table (relational, org-scoped, user-editable prompt list):

```
ai_visibility_prompts
  id, org_id, prompt (text), is_active (bool), source (auto | user),
  created_at  — 5–10 rows/org, seeded on first enable
```

Enum / constant touches (the resync rule from CLAUDE.md applies):
- Add `ai_visibility` to `sourceTypeEnum` (`packages/db/src/schema/monitors.ts`)
  **and** `SOURCE_TYPES` (`packages/shared/src/constants/sources.ts`) as an
  **internal anchor source** (like `tech_stack`): never user-selectable, **not** in any
  `allowedSources`, so it stays ungated *as a source*. It exists only to anchor the
  snapshot→change→signal chain. The **capability** is gated by a new org-level
  **`features.aiVisibility`** flag in `PLAN_LIMITS` (pro + business), mirroring
  `battleCards`/`realtimeAlerts` — AI Visibility is org-level, not per-competitor, so a
  per-competitor source gate would be the wrong shape. *(Implemented this way in
  migration `0015`.)*
- `engine` is plain `text` (schema-light, like every analytics column), not an enum.
- **Decision (open):** signal category — add `visibility` to the signal-category enum,
  or reuse `content`. Leaning `visibility` (it's a distinct decision surface), but that
  touches the category enum + every category filter/legend. See Risks.

The self/brand row reuses the existing `type=self` competitor, so `competitor_id`
always points at a real competitor row (self or external) — no new "brand" entity.

## Pipeline (modeled on tech-stack, patch-18)

```
[cron weekly] schedule-ai-visibility.job.ts
  └─ enqueue orgs whose ai_visibility monitor is active & due
       (last_run null || < now - AI_VISIBILITY_INTERVAL_DAYS)

[per org] scrape-ai-visibility.job.ts        (INDEPENDENT of scrape-monitor)
  └─ load active prompts + the org's competitor roster (self + external, names/aliases)
  └─ for each (prompt × engine): query the engine ONCE  → raw answer text
       (cost = prompts × engines, NOT × competitors)
  └─ internal AI pool parse (one cheap call/answer, ai_runs task `extract_ai_visibility`,
       via loggedAi): from {self + competitor names}, return [{name, mentioned, rank,
       cited, sentiment}] — deterministic schema (Zod), org-scoped, never trusts the
       model for identity (match against the known roster).
  └─ insert ai_visibility_results rows (append-only, best-effort analytics)
  └─ diff vs previous run → emit signals on meaningful deltas only:
       • a competitor overtakes self on an engine (rank/SoV crossover)
       • self drops out of an engine it was in
       • a tracked competitor newly appears
       (synthetic Classification like tech-stack: category=visibility/content,
        severity by magnitude; idempotent; feeds generate-signal → normal feed)
  └─ stamp monitor.last_run_at / next_run_at
```

The signal then rides the **existing** moderation → digest → alert path (patch-26)
with no new delivery code: "Acme overtook you in Perplexity answers this week" lands in
the feed, the weekly digest, and (if critical-ish) an alert.

## UI / nav

- New primary nav item **AI Visibility** (see the target nav in
  `docs/page-audit-2026-06-30.md` §8 — it takes one of the slots freed by the nav slim).
- Page: (1) SoV-over-time chart per engine (self vs top competitors), (2) a per-prompt
  table — each row = prompt, columns = engines, cell = mentioned/rank, expand → the
  actual answer excerpt (evidence, per the "show the work" principle), (3) a prompt
  editor (add/remove/toggle). Empty/locked state sells the feature on free/starter.
- Also surfaces a one-line tile on **Overview** ("You're in 2/3 engines for your core
  prompt; Acme is in 3/3") and a competitor-detail tab row.

## Plan gating, cost, env

- **pro + business** via the `features.aiVisibility` plan flag (org-level capability,
  like `realtimeAlerts`). free/starter see the locked state → `plan_locked_feature`
  paywall (existing mechanism), not a source paywall.
- **Cost is bounded and small:** `prompts × engines × weekly`. 10 prompts × 3 engines ×
  weekly ≈ 120 external queries/org/month + ~120 cheap internal parse calls. The
  external engine APIs (Perplexity Sonar, OpenAI web, a SERP provider for AIO) are
  **new paid dependencies** — this is the real cost/ops surface, one env var each:

```
AI_VISIBILITY_ENABLED=true            # kill-switch (off → source hidden, no job)
AI_VISIBILITY_INTERVAL_DAYS=7         # cadence per org
AI_VISIBILITY_MAX_PROMPTS=10          # cap prompts/org (cost guard)
PERPLEXITY_API_KEY=                   # engine: perplexity (sonar)
OPENAI_API_KEY=                       # engine: chatgpt (gpt-4o + web search)
SERP_API_KEY=                         # engine: google_aio (AI Overviews via SERP)
# (claude/gemini engines = phase 2)
```

Each new var → `.env.example` + `docs/architecture.md` (production rule 4).

## Risks / open decisions

1. **External-engine fidelity.** API answers ≈ but ≠ what a human sees in the consumer
   UI (personalization, A/B). Acceptable for *relative* SoV trends; say so in the UI,
   don't over-claim absolute truth.
2. **Engine API availability/ToS.** Perplexity/OpenAI have proper APIs; "ChatGPT the
   product" and Google AI Overviews don't — they need an API proxy (gpt-4o-with-search)
   or a SERP provider. Validate ToS before shipping AIO.
3. **Signal-category enum churn.** Adding `visibility` touches the enum + every
   category filter, legend, and the classify prompt. Cheaper to reuse `content` for
   MVP and split later. **Recommend: ship on `content`, revisit.**
4. **Prompt quality = signal quality.** Bad auto-seeded prompts → noise. Seed
   conservatively (category + top competitors), let the user curate, cap at
   `AI_VISIBILITY_MAX_PROMPTS`.
5. **Cost creep** if cadence/prompts grow — the caps above are the guard; surface
   spend in `/admin` next to the other ai_runs costs.

## Phased build

1. **Schema + enums** (`ai_visibility_results`, `ai_visibility_prompts`, source enum
   resync, plan gating) → migration. *Verify:* `pnpm db:generate` + typecheck green.
2. **One engine end-to-end** (Perplexity) — job + internal parse + results rows, no UI.
   *Verify:* a manual run writes rows for a seeded org.
3. **Signals** — diff + synthetic classification → feed/digest. *Verify:* a crossover
   produces one signal, idempotent on re-run.
4. **UI** — page (chart + prompt table + editor) + Overview tile + nav item.
5. **Engines 2–3** (OpenAI, Google AIO) behind the same loop.
6. **Phase 2** — Claude + Gemini engines, optional `visibility` category split.

## References

- Page audit & nav placement: `docs/page-audit-2026-06-30.md`
- Tech-stack analog (independent off-cascade scraper that emits signals): patch-18,
  `apps/workers/src/jobs/scrape-tech-stack.job.ts`, `schedule-tech-stack.job.ts`
- Moderation → digest → alert path the signals ride: patch-26
- Market: [AI visibility tools 2026 — Frase](https://www.frase.io/blog/the-10-best-ai-visibility-tools-in-2026),
  [LLM optimization 2026 — Search Engine Land](https://searchengineland.com/llm-optimization-tracking-visibility-ai-discovery-463860),
  [Affordable AI visibility for B2B SaaS — Siftly](https://siftly.ai/blog/most-affordable-ai-visibility-tools-b2b-saas-startups-2026)
```
