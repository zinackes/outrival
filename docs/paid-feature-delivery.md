# Paid-but-undelivered Business features — decision

The `business` tier advertised two features that **no code delivers**: `features.api`
(Public API) and `features.multiUser` (multi-user / RBAC). Selling a capability that
returns nothing is a revenue-integrity problem. This doc records what is *sold* vs what
*exists*, the deliver-vs-hide trade-off per feature, and the decision.

**Decision: HIDE both now** (reversible, ~0 cost) — stop advertising them as shipped
until they are actually delivered.

Verified at commit `b51c20c` (base of branch `advisor/018-paid-undelivered-decision`).
The three source-of-truth files (`plans.ts`, `feature-flags.ts`, `tier-limits.md`) are
unchanged since `81c4b75`, so the gap below is current.

---

## Feature 1 — Public API (`features.api`)

### Sold

- `packages/shared/src/constants/plans.ts:116` — `business` grants `features.api: true`
  (all lower tiers already `api: false` at lines 69 / 82 / 95).
- `docs/tier-limits.md:25` — the tier grid presents `features.api | ✗ | ✗ | ✗ | ✓` as a
  headline Business differentiator.
- `apps/web/src/components/outrival/usage-dashboard.tsx:142` — the usage dashboard renders
  a `Public API` entitlement reading `limits.features.api ? "Included" : "—"`, i.e. a
  Business org is shown "Included".

### Exists in code

- **No `api_keys` / token table.** `grep -rni "api_key\|apiKey" packages/db/src/schema`
  returns nothing (exit 1) — no key issuance, no token auth model.
- **No public / versioned route.** The only session-less route in `apps/api/src/routes/`
  is the share link `GET /api/public/report/:token` (`public-report.ts:16`), which serves
  one org's landscape snapshot behind an unguessable token. There is no `/v1/*`, no
  header-authenticated data API. Every other route sits behind session `authMiddleware`.
- **`features.api` is never gated on.** `isFeatureAllowed(plan, feature)`
  (`apps/api/src/lib/plan.ts:90`) is only ever called with `"crmIntegrations"`
  (`crm-destinations.ts:44`) and `"aiVisibility"` (`ai-visibility.ts:52/300/355`) — never
  `"api"`. The flag has no enforcement path; it is pure pricing-page display.

### Deliver vs Hide

- **Deliver — moderate, not trivial.** The org-scoped *service* layer a read API would
  wrap already exists: `apps/api/src/lib/ask/tools.ts` (`listCompetitors` :49,
  `getSignals` :97, `getPricingHistory` :160) and `apps/api/src/lib/analytics-safe.ts`.
  A v1 read API is therefore ~ `api_keys` table + header-auth middleware + thin
  `/v1/{signals,competitors,pricing}` wrappers over those tools + per-key rate limit. The
  real cost is not the handlers — it is key issuance/rotation, the new abuse surface,
  versioning, docs, and support. Roadmap already parks this as **Phase 11**.
- **Hide — near-zero, reversible.** Flip `business.features.api` to `false`; the flag is
  display-only, so nothing regresses. Stops over-promising immediately.

**Recommendation: HIDE now, DELIVER later as a dedicated plan.** The read API is the
inbound counterpart to the existing outbound CRM webhook and is relatively cheap to build
once there's demand, because `ask/tools.ts` is the ready-made handler layer. Reuse it then;
do not half-build it now.

---

## Feature 2 — Multi-user / RBAC (`features.multiUser`)

### Sold

- `packages/shared/src/constants/plans.ts:116` — `business` grants
  `features.multiUser: true` (lower tiers already `false`).
- `docs/tier-limits.md:63-64` — presents `features.multiUser` as "business-only".

### Exists in code

- **The feature is flagged off globally.** `packages/shared/src/feature-flags.ts:5` —
  `FEATURE_FLAGS.multiUser = false`.
- **The Members UI 404s.** `apps/web/src/app/dashboard/settings/members/page.tsx:9` —
  `if (!FEATURE_FLAGS.multiUser) notFound();`. The invitations/members screen is scaffolded
  but unreachable.
- **No invitation or role model.** There is no Better Auth org/invitation flow and no
  per-route RBAC. `features.multiUser` is read in exactly one place for display:
  `apps/web/src/app/(onboarding)/onboarding/onboarding-form.tsx:1665` adds an
  "Invite a teammate" next-step suggestion — which then leads to a 404 page.
- **Collaboration is pre-scaffolded but dormant.** `packages/db/src/schema/signal-comments.ts`
  (threaded comments with a denormalised `author_name`) is wired into the signals routes and
  web, waiting on teammates existing; `@mentions`/assignment are explicitly deferred to
  multiUser (`docs/distribution-team.md:11,49,55`).

### Deliver vs Hide

- **Deliver — larger.** The data model is pre-shaped for it (`org_id` on every table,
  denormalised comment authors, `usersPerOrg` caps in `PLAN_LIMITS`), but shipping needs a
  Better Auth org/invitation flow + a role model + per-route RBAC applied across many
  tenant-scoped routes. This is Phase 10 on the roadmap — a real project, not a flip.
- **Hide — near-zero, reversible.** Flip `business.features.multiUser` to `false`. Since the
  global `FEATURE_FLAGS.multiUser` already gates everything off, no delivered capability is
  lost; the only visible change is the pricing/entitlement copy stops claiming it.

**Recommendation: HIDE now, keep hidden until teammates are actually needed.** When
multiUser is delivered (Phase 10), the dormant `signal-comments` `@mentions`/assignment
unlock at the same time.

---

## Coupling check (why HIDE is safe)

Flipping both flags to `false` on the `business` tier does not break gating: `isFeatureAllowed`
is never called with `"api"` or `"multiUser"`, and the only readers of `features.api` /
`features.multiUser` are display surfaces (usage dashboard entitlement, onboarding next-step).
No path asserts `business.api === true` or `business.multiUser === true`. A Business customer
loses nothing they currently have, because neither feature was ever delivered.

## What to do this week

Ship the reversible HIDE: set `business.features.api = false` and
`business.features.multiUser = false` in `packages/shared/src/constants/plans.ts`, update the
`docs/tier-limits.md` grid to mark both as **planned (coming soon)** rather than shipped, and
fix the `plans.test.ts` assertion. Defer the read-API build to a dedicated future plan
(reuse `ask/tools.ts`); keep multiUser hidden until Phase 10.
