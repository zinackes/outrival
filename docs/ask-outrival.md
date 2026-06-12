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
| `apps/api/src/routes/ask.ts` | `POST /api/ask` — `authMiddleware` + `aiIntensiveRateLimit`, SSE stream. |
| `apps/web/src/components/dashboard/ask-panel.tsx` | `/dashboard/ask` page — input, SSE-over-POST trace, answer + clickable citation chips. |

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

## Deferred

- Conversation history (`ask_conversations`/`ask_messages`) — v1 is stateless.
- Token-streaming the synthesis (would add a `completeStream` to the provider).
- command-K surface (page-first in v1).
- Slack 2-way slash-command (separate card).
