# Capability activation conditions

`/admin/system` (`GET /api/admin/capabilities`) shows whether each capability below
is live **right now**, from a behavioural probe (a recent row in an existing table)
rather than an env read: the API and the workers are separate services with
separate environments, so an env value on one tells you nothing about the other. A
capability listed here as intentionally off is a **decision**, not a bug: check its
entry before assuming it needs fixing.

## Archive backfill

1. `BACKFILL_ENABLED` (default `true`).
2. Workers (`apps/workers/src/core/scrape-monitor.ts`).
3. Already on by default; no further condition to flip it on. The condition worth
   watching is the opposite one: it can go quietly dark (Wayback Machine reachability,
   queue throttling) with nothing paging anyone, which is exactly why this readout exists.
4. No owner named for a live/dark alert; no date set.

## Staged extraction

1. `STAGED_EXTRACTION_ENABLED` (default `true`).
2. Workers (`apps/workers/src/lib/staged-extract.ts`).
3. Already on by default. `live: false` while the flag is `true` means every recent
   run resolved on the AI-fallback floor, i.e. the structured/cache/heal tiers are not
   doing their job; that is worth investigating before assuming the pipeline is fine.
4. No owner named; no date set.

## Platform detection

1. `PLATFORM_DETECTION_ENABLED` (default `true`).
2. Workers (`apps/workers/src/lib/platform-detect.ts`).
3. Already on by default; no further condition. Dark means the periodic
   re-detection cadence (30d) has produced nothing recently.
4. No owner named; no date set.

## AI Visibility

1. `AI_VISIBILITY_ENABLED` (default `true`) + `GEMINI_API_KEY`.
2. Workers (`apps/workers/src/core/schedule-ai-visibility.ts`).
3. Key configured, quota not exhausted, and the pinned model
   (`AI_VISIBILITY_GEMINI_MODEL`) actually carries free grounding quota. The
   11-day 2026-07-13 to 2026-07-24 outage was a `-latest` alias sliding onto a
   quota-less generation, not a missing key.
4. Ops watches the free-tier grounding quota; no date set for a paid upgrade.

## Faithfulness gate

1. `FAITHFULNESS_GATE_ENABLED` (default `false`).
2. Workers (`packages/ai/src/faithfulness/gate.ts`, called from
   `apps/workers/src/lib/faithfulness-gate.ts`).
3. Written in `docs/architecture.md`: enable only where the provider pool is
   healthy and `pnpm --filter @outrival/ai eval:faithfulness` passes, since the
   judge's false-block rate is a property of the model, not the code.
4. Plan 017 (spike, not yet executed) owns the measure-then-recommend decision;
   no date set.

## Standing queries

1. `INTERNAL_API_SECRET` (16+ chars).
2. **Both** api and workers, same value on each. This is the exact split this
   readout exists to catch (an API-side env read would be meaningless for this one).
3. Set on both services so `POST /api/internal/ask/run` resolves instead of
   404ing; missing it lets users save queries that are never re-evaluated.
4. No owner named; no date set.

## Share links

1. No switch. Created on the user's explicit "Share snapshot" action.
2. Web (create) + API (`apps/api/src/routes/share.ts`, resolves the public token).
3. None; available on every plan today.
4. Not applicable, no decision pending.

## CRM webhook

1. Plan flag `features.crmIntegrations` (`packages/shared/src/constants/plans.ts`).
2. API (`apps/api/src/routes/crm-destinations.ts` gates the create route).
3. Org must be on the `business` plan, then add a destination URL in Settings.
4. Not applicable, already gated as designed, no pending decision.

## Ask Outrival

1. No plan gate. Available on every plan, rate-limited 10/h/user.
2. API (`apps/api/src/routes/ask.ts`).
3. None; ships to everyone by design.
4. Not applicable.

## Signal comments

1. No switch. Available to any user with access to a signal.
2. API (`apps/api/src/routes/signals.ts`).
3. None.
4. Not applicable.

## Saved views

1. No switch. Created on explicit user action.
2. API (`apps/api/src/routes/saved-views.ts`).
3. None.
4. Not applicable.

## Passkeys

1. `NEXT_PUBLIC_PASSKEYS_ENABLED` (build-time, default off).
2. Web, baked in at Docker build time. A runtime env change does nothing.
3. Written in `docs/architecture.md`: validate on staging with a real WebAuthn
   device before flipping it, since a broken passkey flow can lock a user out.
4. No owner named for the staging validation; no date set.

## Visual diff

1. `VISUAL_DIFF_ENABLED` (default `true`).
2. API (`apps/api/src/routes/signals.ts`).
3. Already on by default; this is the one entry where reading the API's own env
   value is correct, since the feature is entirely API-side.
4. Not applicable.

## Multi-user orgs

1. Static flag `FEATURE_FLAGS.multiUser` (`packages/shared/src/feature-flags.ts`),
   not an env var. Changing it requires a code change.
2. Web (gates the Members settings section).
3. Invitations and RBAC need to actually ship (roadmap Phase 10); the decision to
   keep this off for now is recorded in `docs/paid-feature-delivery.md`.
4. Product decision already made (stay off); no date set for Phase 10.
