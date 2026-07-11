# Ask Outrival — conversational intelligence

The jump from "dashboards you visit" to "intelligence you query". A user asks a
natural-language question ("What changed at Linear this month?", "Who is hiring AEs?",
"Compare the pricing of X and Y") and gets a grounded English answer over their **own
already-tracked Postgres data** — no new ingestion, no vector RAG.

## Why a tool agent, not RAG

The data is **relational**, not documentary. So instead of embedding documents, we
expose the model a fixed set of **org-scoped, parameterised tools** and let it pick
which to call. The model never writes SQL; it only names tools and arguments. This
gives absolute tenant isolation (every tool filters by `orgId`) and exact, current
numbers (it reads the live tables the cockpit already uses).

## Two-pass loop (no native tool-calling)

`@outrival/ai`'s `complete()` is single-shot `prompt → string` (no multi-turn
function-calling), so the agent is two `complete()` passes — which is also the cheap/
smart split the feature wants:

```
question + roster(id,name) ──▶ [PLAN · fast 8b · json]  AskPlanSchema { calls:[{tool,args}] }
                                      │  (Zod-validated, unknown tools dropped)
                                      ▼
                          execute tools in the API  (orgId from session, never the model)
                                      │  results[]
                                      ▼
question + results ──────────▶ [SYNTHESIS · 70b · json]  AskAnswerSchema { answer, citations }
```

- **Name resolution**: the org's competitor roster (`id`, `name`, bounded by the plan's
  max competitors) is injected into the plan prompt, so "Linear" maps straight to an id
  in a single pass — no extra round-trip.
- **Single-pass plan**: no agentic re-planning. Enough for the v1 questions; the
  synthesis refuses cleanly ("no data") when results don't cover the question.

## Files

| File | Role |
|---|---|
| `packages/ai/src/tasks/ask.ts` | **Pure** (no DB): `AskPlanSchema`, `AskAnswerSchema`, `buildAskPlanPrompt`, `buildAskSynthesisPrompt`, `AskToolSpec`/`AskRosterEntry`. |
| `apps/api/src/lib/ask/tools.ts` | Org-scoped tool registry (`run(orgId, args)`), thin wrappers over the same reads as `trends.ts`/`compare.ts`/`signals.ts`. |
| `apps/api/src/lib/ask/agent.ts` | `runAskAgent(orgId, question, emit)` — plan → execute → synthesise, streams progress, logs `ai_runs`. |
| `apps/api/src/lib/ai-runs.ts` | `logAskRun` — best-effort `ai_runs` insert (the API had no AI-run logger; the workers' `loggedAi` is job-side only). |
| `apps/api/src/lib/ask/history.ts` | `persistAskHistory` — best-effort insert into `ask_history` after the answer is emitted (modelled on `logAskRun`; never breaks the stream). |
| `apps/api/src/routes/ask.ts` | `POST /api/ask` (SSE, accepts `{ question, context? }`) + `GET /api/ask/history` (consultable past questions, per user, no AI rate-limit) + `GET /api/ask/suggestions`. |
| `apps/web/src/components/dashboard/ask-panel.tsx` | Ask page **and** dock body — input, SSE-over-POST trace, answer + citation chips, page-context chip, and a "Recent questions" history list (click re-displays a stored answer with no model call). |
| `apps/web/src/components/dashboard/ask-context.tsx` | `useSetAskContext` — each dashboard page declares what it's "about" (`competitor`/`product`/`signal`/`view` + label + optional `competitorId`); the dock reads it and sends it as `POST` `context`. |

## Tools

`listCompetitors`, `getSignals`, `getPricingHistory`, `getJobTrends`, `getReviewThemes`,
`getTechStackChanges`, `compareCompetitors`. Each returns a small serialisable object
the synthesis grounds on.

## Tenant isolation (the guardrail that matters)

- `orgId` comes from `ensureUserOrg(user.id)`, **never** from the model (tool `args`
  schemas have no `orgId` field).
- The analytics tables (`pricing_history`, `job_counts`, `review_scores`,
  `tech_stack_history`) carry **no `org_id` and no FK**. So every competitor-keyed tool
  first resolves the competitor **within the org** (`ownedCompetitor(orgId, id)` →
  `competitors WHERE id AND org_id AND deleted_at IS NULL`); a foreign or forged
  `competitorId` yields an empty result. This relational gate — not the analytics filter
  — is what enforces isolation.
- An unknown tool named by the model is ignored (no arbitrary execution).

## Cost & resilience

- Hard rate limit: `aiIntensiveRateLimit` (10/h/user), same as onboarding analyze.
- Two AI calls per question (fast plan + 70b synthesis); both logged to `ai_runs`
  (`task='ask'`, free-text — no enum/migration).
- Breaker open (`AIUnavailableError`) → a clean "AI temporarily unavailable" event; the
  rest of the product is unaffected.
- No caching in v1 — an intelligence tool must reflect current data.

## Streaming

SSE **event-streaming** (not token-streaming): the stream emits `status` → `tool` (×N)
→ `answer`/`citations` → `done`, so the UI shows the work without any change to the
shared provider layer. `POST` + SSE is read client-side via a `fetch` stream reader
(EventSource can't POST).

## History & page context

- **History** (`ask_history`, per `org_id` + `user_id`): one row = one complete exchange
  (`question`, `answer`, `citations`, `context`). Written best-effort at the answer-emit
  point (`agent.ts`) — only real answers, never the parse-failed fallback. `GET
  /api/ask/history` returns the user's recent exchanges; the panel shows them as a
  consultable "Recent questions" list and re-displays a stored answer on click without
  spending a model call (the live panel also prepends new answers optimistically). A
  multi-turn conversation model (an `ask_conversations` parent + threading the prior
  turns into the prompts) stays deferred — the assistant is single-turn.
- **Page context**: every dashboard page declares what it's "about" via
  `useSetAskContext` (`competitor`/`product`/`signal` entity, or a `view` + its active
  filters). The dock sends it as a structured `context: { label, competitorId? }` on
  `POST /api/ask`; the agent flattens it into a `<context>` block in both the plan and
  synthesis prompts (replacing the old "Regarding X:" question prefix). `competitorId`
  is only a hint — every tool still re-resolves it within the org.

## Standing queries — watched questions

A saved Ask answer kept under watch (`standing_queries`, migration 0036). "Watch this
question" on any answer stores the question + its **baseline** (answer, validated
citations, the sorted set of cited signal ids + hash) and the **watched entities**,
extracted ONCE at creation: cited competitors (+ competitors of cited signals) and
signal categories (cited signals' categories + deterministic keywords in the
question). Empty lists = org-wide / any-category wildcard. Plan-capped BACKEND-side
(`PLAN_LIMITS.standingQueries`: 3 free / 10 starter / 999 pro+, 403
`plan_limit_standing_queries` → paywall).

- **Targeted re-evaluation, no blind cron**: `generate-signal` fires
  `evaluate-standing-queries` (fire-and-forget, never for backfill) after each fresh
  signal; only active queries matching the signal's competitor/category above their
  `min_severity` and outside their `cooldown_hours` (default 6) re-run.
  `signal-batching` is NOT hooked — every batched signal already went through
  generate-signal (hooking both would double-trigger).
- **One Q&A path**: the worker re-runs the question through the SAME agent via
  `POST /api/internal/ask/run` (shared secret `INTERNAL_API_SECRET`, mounted outside
  authMiddleware; unset → 404 + workers skip). The run is headless:
  `runAskAgent(..., { persistHistory: false })` so re-evals never pollute "Recent
  questions"; the parse-miss fallback is marked `grounded: false` and treated as a
  failed run (state untouched).
- **Change = cited-signal SETS, never answer text** (the LLM rephrases freely). Same
  set → silence, judge never consulted → a reformulation can't alert. Different set →
  fast-tier judge (`standing_query_judge` in ai_runs) arbitrates substance over the
  baseline vs fresh answers + added/removed signal insights. Known blind spot
  (accepted): an answer grounded only on pricing/jobs/reviews data cites no signals,
  so its set never moves.
- **Hysteresis**: `pending_count` — first material eval arms (no alert), a second
  consecutive one alerts, promotes the fresh answer to baseline and stamps
  `last_alerted_at`/`last_change_summary`; any non-material eval disarms.
- **Alert**: routed through `decideDispatch` (quiet hours/caps/muted consistent with
  signals) → in-app notification `standing_query` + immediate email only for
  realtime-alert plans (best-effort). **Digest**: queries alerted during the week land
  in the weekly email as "Your watched questions" (`content.watchedQuestions`,
  attached deterministically like `sectoralTrends`).
- **UI**: watch button on the answer card (ask-panel), watched list on
  `/dashboard/ask` (pause/resume re-enters the plan cap, delete).

## Deferred

- Multi-turn conversation (`ask_conversations` parent + prior-turn prompting).
- Token-streaming the synthesis (would add a `completeStream` to the provider).
- command-K surface (page-first in v1).
- Slack 2-way slash-command (separate card).
