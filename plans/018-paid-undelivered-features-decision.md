# Plan 018: Resolve the paid-but-undelivered Business features (`api`, `multiUser`) — decide deliver-or-hide

> **Executor instructions**: This is a **decision / spike** plan, not a build-everything
> plan. Your deliverable is (1) a short written recommendation and (2) EITHER a small,
> reversible "hide" change OR a design/spike doc for delivery — per the decision reached.
> Do NOT build a full API or RBAC system from this plan. If anything in "STOP conditions"
> occurs, stop and report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 81c4b75..HEAD -- packages/shared/src/constants/plans.ts packages/shared/src/feature-flags.ts docs/tier-limits.md`
> If any changed, re-read them before proceeding.

## Status

- **Priority**: P2
- **Effort**: S (decision + hide) to L (if delivery is chosen — that's a separate build plan)
- **Risk**: LOW (decision/hide) / MED–HIGH (delivery, deferred)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `81c4b75`, 2026-07-07

## Why this matters

The `business` tier advertises two features that **no code delivers**, which is a
revenue-integrity problem (customers can pay for capabilities that return nothing):

- **Public API** (`features.api`): `packages/shared/src/constants/plans.ts` grants `business`
  `api: true`, and `docs/tier-limits.md` presents `features.api ✗ ✗ ✗ ✓` as a headline
  Business differentiator — but there is **no `api_keys`/token table** anywhere in
  `packages/db/src/schema/` and **no public/versioned route** in `apps/api/src/routes/`
  (every route is behind session `authMiddleware`).
- **Multi-user / RBAC** (`features.multiUser`): the tier grants `multiUser: true`, but
  `packages/shared/src/feature-flags.ts` hard-codes `FEATURE_FLAGS.multiUser = false`, and
  `apps/web/src/app/dashboard/settings/members/page.tsx` does `if (!FEATURE_FLAGS.multiUser)
  notFound()` — the Members page 404s. There is no invitation/role model.

Either the features get delivered, or they should stop being sold as live. This plan forces
that decision and ships the cheap, honest interim (hide) so the tier stops over-promising,
while scoping what real delivery would take.

## Current state (verify each before deciding)

- `packages/shared/src/constants/plans.ts` — the `business` limits object includes
  `api: true, multiUser: true` (and `fullMonitoring`/others). `free`/`starter`/`pro` have
  `api: false, multiUser: false`.
- `packages/shared/src/feature-flags.ts`:
  ```ts
  export const FEATURE_FLAGS = { multiUser: false } as const;
  ```
- `apps/web/src/app/dashboard/settings/members/page.tsx`: `if (!FEATURE_FLAGS.multiUser) notFound();`
  — the Members list/invitations UI is scaffolded but gated off.
- Collaboration is pre-scaffolded FOR multiUser: `packages/db/src/schema/signal-comments.ts`
  (threaded comments with denormalised `author_name`), wired in the signals routes + web —
  dormant until teammates exist.
- The service layer a read-API would wrap already exists and is org-scoped:
  `apps/api/src/lib/ask/tools.ts` (`listCompetitors`/`getSignals`/`getPricingHistory`/…) and
  `apps/api/src/lib/analytics-safe.ts`.
- `docs/tier-limits.md` and `docs/architecture.md` roadmap (Phase 10 multi-user, Phase 11
  public API) name both as future — so selling them now is ahead of delivery.
- **Contradiction guard**: do not propose anything a decision doc already rejected; note
  contradictions instead. `docs/distribution-team.md` / `docs/ask-outrival.md` scope some
  adjacent items (OAuth CRM sync, multi-turn Ask) out — respect those.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Confirm no api_keys table | `grep -rni "api_key\|apiKey" packages/db/src/schema` | no table definition |
| Confirm no public route | `grep -rn "public\|/v1/" apps/api/src/routes` | only the existing `/api/public/report/:token` share route |
| Typecheck (if you make the hide change) | `pnpm typecheck` | exit 0 |
| Shared tests (if hide changes plans.ts) | `pnpm --filter @outrival/shared test` | pass (needs plan 005) |

## Scope

**In scope** (pick ONE track after the decision):
- **Decision doc** (always): `docs/paid-feature-delivery.md` (create) — the recommendation.
- **Track HIDE (interim, reversible)**: minimal edits to stop advertising the undelivered
  features — e.g. flip `api`/`multiUser` off in the `business` limits (or add a "coming soon"
  presentation flag), and adjust `docs/tier-limits.md` so the tier grid doesn't claim them as
  shipped. Update `plans.ts` tests if the grid values change.
- **Track DELIVER (spike only here)**: the design doc scopes the build; the actual
  implementation is a SEPARATE future plan, not this one.

**Out of scope**:
- Building the API (`api_keys` table, key auth middleware, `/v1/*` routes, rate limiting,
  OpenAPI) — that's a full build plan if DELIVER is chosen.
- Building invitations/RBAC (Better Auth org flow, role model, per-route `assertRole`) —
  likewise a full build plan.
- Touching `signal-comments` schema/UI.
- Any change to billing/Stripe.

## Git workflow

- Branch: `advisor/018-paid-undelivered-decision`
- One commit, conventional: `docs: decide on paid-but-undelivered Business features`
  (plus a `chore`/`fix` commit if the HIDE track edits `plans.ts`/`tier-limits.md`).
- Do NOT push unless instructed. **Do NOT** self-decide to build; the operator picks the track.

## Steps

### Step 1: Verify the gap is real (both features)

Run the two greps above and read the cited files. Confirm: (a) no `api_keys` table + no
public non-share route exists; (b) `FEATURE_FLAGS.multiUser = false` + Members page 404s +
no invitation/role model. Write the confirmed facts into `docs/paid-feature-delivery.md`.

**Verify**: the doc states, per feature, exactly what is sold vs what exists in code, with
`file:line` evidence.

### Step 2: Write the recommendation

In `docs/paid-feature-delivery.md`, for **each** feature, lay out:
- **Deliver** cost/benefit: for the API, note the service layer already exists
  (`ask/tools.ts`, `analytics-safe.ts`) so v1 = `api_keys` table + header-auth middleware +
  thin `/v1/{signals,competitors,pricing}` wrappers + per-key rate limit (the real cost is
  key issuance/rotation, abuse surface, versioning, docs, support). For multiUser, note the
  data model is pre-shaped (`org_id` everywhere, denormalised comment authors, `usersPerOrg`
  caps) but it needs Better Auth org/invitation flow + a role model + per-route RBAC across
  many tenant-scoped routes.
- **Hide** cost/benefit: near-zero, reversible; stops over-promising immediately; buys time.
- A clear **recommendation** (e.g. "HIDE both now; DELIVER the read API next quarter because
  the service layer makes it cheap and it's the inbound counterpart to CRM webhooks; keep
  multiUser hidden until there's demand"). Keep it honest — strategy is the operator's call;
  present grounded options with trade-offs.

**Verify**: the doc ends with an explicit recommendation and a one-line "what to do this week."

### Step 3: If the operator chooses HIDE — ship the reversible interim

Only if the decision is HIDE (confirm with the operator via the plan's reviewer, or if
running non-interactively, DEFAULT to HIDE as the safe reversible interim and say so):
- Stop advertising the undelivered features on the Business tier. Prefer the least-surprising
  edit: set `api`/`multiUser` to `false` in the `business` limits in `plans.ts` **or**
  introduce a "coming soon" presentation that the pricing UI renders distinctly (don't
  silently keep `true` while the feature 404s). Whichever you choose, `pausedByPlanCap` and
  other gating that reads these flags must still typecheck and behave (a Business customer
  loses nothing they currently have, since neither feature is delivered).
- Update `docs/tier-limits.md` so the grid doesn't present `api`/`multiUser` as shipped
  (mark "planned"/"coming soon").
- Update the `plans.ts` test (`packages/shared/src/constants/plans.test.ts`) if it asserts the
  changed grid values.

**Verify**: `pnpm typecheck` → exit 0; `pnpm --filter @outrival/shared test` → pass (or
`cd packages/shared && bun test src/constants` if plan 005 hasn't landed). Confirm the pricing
UI no longer lists a live capability that returns nothing.

## Test plan

- If HIDE edits `plans.ts`: update/verify `plans.test.ts` reflects the new grid values.
- If DELIVER: no code tests here (the doc is the deliverable); the build plan that follows
  carries its own test plan.
- Verification: `pnpm typecheck` + the shared test (only if `plans.ts` changed).

## Done criteria

ALL must hold:

- [ ] `docs/paid-feature-delivery.md` exists with per-feature evidence, cost/benefit, and a
      clear recommendation
- [ ] The paid-vs-delivered gap is confirmed via grep (no `api_keys` table, no public route;
      `multiUser` flag false + Members 404s)
- [ ] IF HIDE chosen/defaulted: Business tier no longer advertises `api`/`multiUser` as
      shipped; `docs/tier-limits.md` updated; `pnpm typecheck` + shared test pass
- [ ] IF DELIVER chosen: a scoped design/spike section exists; no half-built API/RBAC code
      was added
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- The gap is NOT real (e.g. an `api_keys` table or `/v1` routes actually exist now — drift):
  report; the premise is wrong.
- The decision requires product/pricing judgment the operator hasn't given and you're running
  interactively — surface the recommendation and wait, rather than editing the tier grid.
- Hiding `api`/`multiUser` would break existing gating code in a non-obvious way (some path
  assumes `business.multiUser === true`) — report the coupling before flipping.

## Maintenance notes

- If DELIVER (API) is later chosen, the build plan should reuse `ask/tools.ts` as the handler
  layer and pair the read API with the existing outbound CRM webhook to close the
  inbound/outbound asymmetry.
- If DELIVER (multiUser) is later chosen, unlock the dormant `signal-comments` @mentions once
  teammates exist.
- Reviewer should confirm no customer currently relying on these features is affected by HIDE
  (they can't be — neither is delivered), and that the pricing page and `tier-limits.md` now
  tell the same story as the code.
