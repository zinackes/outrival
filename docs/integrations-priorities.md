# Integrations: scoping and priorities

Scoping doc for OUT-164. It answers one question: which integrations do we build
now, which do we keep for later, and which do we drop at this stage.

It is not an architecture doc. Auth, sync and field mapping are named only where
they change a build/no-build call.

**Decision vocabulary**

| Decision | Meaning |
|---|---|
| `build now` | In the next integration cycle. Sequenced below. |
| `keep for later` | Wanted, but blocked on a prerequisite or on unproven demand. |
| `do not build` | Rejected for this cycle. Revisit only on a named customer asking. |

**Evidence tags** used throughout: `[confirmed]` is read off the code in this
repo, `[probable]` is a reasonable inference we have not verified, `[unknown]`
is an open question that only product can close.

## 1. What exists today

`[confirmed]` **`Settings > Integrations` is an outbound-only surface.**
`apps/web/src/app/dashboard/settings/integrations/page.tsx` renders one section,
CRM destinations, plus a "Coming soon" placeholder. Alert channels (Slack,
email, webhook) were deliberately moved to `Settings > Notifications`, which is
now the single home for how Outrival reaches a user.

`[confirmed]` **The only shipped integration primitive is a signed outbound
webhook.** `crm_destinations` stores `name`, `url`, optional `secret`,
`enabled`, `last_pushed_at` per org. CRUD plus a test push live in
`apps/api/src/routes/crm-destinations.ts`. The fan-out happens inside the alert
dispatcher, `apps/workers/src/core/send-alert.ts:225`, best effort: a failed
push never breaks an alert. The payload is stable and documented in
`docs/distribution-team.md`:

```
{ type: "signal", signal: { id, severity, category, insight, soWhat,
                            recommendedAction, createdAt, competitor, url } }
```

Optional `secret` produces an `X-Outrival-Signature` HMAC-SHA256 of the body.

`[confirmed]` **Only one event type is ever pushed: `signal`.** Per-event
subscription routing was explicitly left out of Phase C.

`[confirmed]` **CRM destinations are business-tier only.** The `crmIntegrations`
feature flag is `true` on `business` and `false` on `free`, `starter`, `pro`
(`packages/shared/src/constants/plans.ts`, asserted by a test).

`[confirmed]` **Slack is a pasted incoming webhook URL, not an app.**
`organizations.slack_webhook_url` plus the `slack` value of `alert_channel`.
Delivery is plan-gated through `allowedChannels`. There is no Slack OAuth, no
channel picker, no interactivity, no per-competitor routing.

`[confirmed]` **There is no inbound public API and no API keys.** The `api`
feature flag exists in `PLAN_LIMITS` but is `false` on all four tiers and is
never read by any handler. No API key table exists in `packages/db`.

`[confirmed]` **There is no third-party OAuth infrastructure.** The only OAuth
provider wired is Google, in Better Auth (`apps/api/src/lib/auth.ts`), and that
is user login. Nothing stores, refreshes or scopes a third-party access token on
behalf of an org.

`[confirmed]` **Outrival is still single-user.** `multiUser` is `false` on every
tier. Assignment and @mentions were deferred to Phase 10.

`[confirmed]` **The UI already promises HubSpot and Salesforce.** The "Coming
soon" section names "Native HubSpot and Salesforce sync" and tells users to
route through Zapier or Make until then.

Not to be confused: `known_integrations` (`packages/db/src/schema/`) and
`apps/workers/src/core/ingest-integrations.ts` record which integrations a
*competitor* ships. That is competitor intel, not our own integration surface.
`[probable]` It is also a usable demand signal: the integrations our competitors
list are the ones their buyers asked for.

### The two blockers

Seven of the ten candidates below are gated on one of exactly two missing pieces
of shared infrastructure:

1. **An org-scoped OAuth token store** (connect, encrypt, refresh, revoke, show
   connection status). Every provider integration needs it. Nothing has it.
2. **A public API surface with API keys** (auth plus at least one read endpoint
   plus webhook subscribe/unsubscribe). Every automation platform app needs it.

The sequencing in section 4 is built so that each of the first two builds pays
for exactly one blocker, and the third rides on what the first two paid for.

## 2. How each candidate is scored

- **Value**: impact for the confirmed buyer, a GTM or product marketing owner
  who reads signals and wants them where they already work.
- **Complexity**: build cost including the shared infrastructure it forces us to
  build first, and any partner directory review before the first customer can
  use it.
- **Prerequisites**: what must exist before it can start.

`[unknown]` Functional depth per integration is not settled. The proposal in
section 5 is one-way push out of Outrival for every v1, with no inbound sync.

## 3. Candidates

| # | Integration | Category | Value | Complexity | Decision |
|---|---|---|---|---|---|
| 1 | Slack (real app) | Collaboration | High | Medium | `build now` |
| 2 | HubSpot | CRM | High | Medium-high | `build now` |
| 3 | Zapier | Automation | Medium-high | Medium | `build now` |
| 4 | Salesforce | CRM | Medium-high | High | `keep for later` |
| 5 | Linear | Ops | Medium | Medium | `keep for later` |
| 6 | Make | Automation | Low-medium | Medium | `keep for later` |
| 7 | Claude Code (MCP) | Dev assistant | Medium | Low-medium | `keep for later` |
| 8 | n8n | Automation | Low | Low | `do not build` |
| 9 | Jira | Ops | Low-medium | High | `do not build` |
| 10 | Codex | Dev assistant | Low | Low | `do not build` |

### 1. Slack, as an installed app. `build now`

Main use case: signals land in the channel the GTM team already watches, routed
per competitor or per severity, instead of a single pasted webhook URL.

Value is the highest of the ten because it upgrades a surface users already
have rather than opening a new one, and because Slack is where the buyer works
all day. Complexity is medium: Slack OAuth, a channel picker, message
formatting. No object model, no field mapping, no bidirectional sync. `[probable]`
Directory listing needs Slack review, but private distribution to a customer
workspace does not, so the first customer is not blocked on it.

Prerequisite: the OAuth token store. This is the cheapest possible first payer
for it, since Slack scopes are simple and a failed token refresh degrades to a
missed message rather than corrupted CRM data.

### 2. HubSpot. `build now`

Main use case: a competitive signal appears on the CRM record the rep opens
before a call, without anyone copying it there.

Value is high and already committed: the UI names it. HubSpot is the CRM of the
SMB and mid-market segment our business tier is priced for. Complexity is
medium-high: OAuth plus token refresh plus one object mapping decision. It is
the flagship, so it justifies the cost that Slack has already partly absorbed.

Prerequisite: the OAuth token store, reused from Slack.
`[unknown]` Which object we write is not settled. See section 5.

### 3. Zapier. `build now`

Main use case: an org routes signals into whatever we will never build natively.

Value is partly distribution: a directory listing is a discovery channel, not
only a feature. Complexity is lower than it looks, because `crm_destinations`
already is a webhook subscription table. A Zapier REST hook trigger is subscribe
equals create a destination, unsubscribe equals delete it. What is missing is
the API key auth and the public endpoints around it.

Prerequisite: the public API with API keys.
`[confirmed]` Users can already use a Zapier catch hook as a CRM destination
today, and the shipped copy tells them to. So the native app buys discovery and
actions, not raw capability. That is why it ranks third and not first.

### 4. Salesforce. `keep for later`

Same job as HubSpot for a heavier segment. Complexity is meaningfully higher:
SOQL, sandbox testing, and `[probable]` an AppExchange security review before
public listing. Build it directly after HubSpot, reusing the same token store
and the same object mapping vocabulary. `[unknown]` No confirmed Salesforce
demand from an actual customer today.

### 5. Linear. `keep for later`

Main use case: turn a signal into a tracked piece of work. Clean OAuth, good
API, low mapping cost (team plus project plus label). Held back for one reason:
`[confirmed]` Outrival is single-user, so a created ticket has no one to assign
to and no thread to notify. This unblocks with Phase 10, not before.

### 6. Make. `keep for later`

Same shape as Zapier, smaller reach. It shares the public API prerequisite, so
its marginal cost after Zapier ships is small. That is exactly why it waits:
after Zapier, not instead of it.

### 7. Claude Code, through an MCP server. `keep for later`

Main use case: ask about a competitor from the terminal, or let an assistant
pull competitive context while drafting a positioning page. `[probable]` The
retrieval already exists behind Ask Outrival (`docs/ask-outrival.md`), so an MCP
server is largely a transport over the public read API.

Held back because the buyer is not a developer. It is a strong wedge if we ever
target dev-tool companies, and cheap once the API exists. It is not a reason to
build the API.

### 8. n8n. `do not build`

n8n users are technical and its HTTP Request node already consumes our webhook
payload with zero work from us. A dedicated node adds discovery inside a
self-hosted tool with no directory leverage.

### 9. Jira. `do not build`

Same job as Linear for a heavier stack, and the most expensive of the ten:
Atlassian Connect or Forge, Cloud versus Data Center split, marketplace review.
It carries the same single-user blocker as Linear on top of that. Revisit only
if an enterprise deal names it.

### 10. Codex. `do not build`

Redundant with candidate 7. If a coding assistant speaks MCP, the same server
serves it. A Codex-specific integration would be a second implementation of one
capability, which is why it is a drop rather than a wait.

## 4. Prioritized shortlist

1. **Slack app**, which pays for the OAuth token store.
2. **HubSpot**, which reuses that token store and honors a shipped promise.
3. **Zapier**, which pays for the public API and API keys, and by doing so
   converts the existing webhook into a distribution channel.

Then, in order, once the blockers are paid: Salesforce, Make, Claude Code MCP,
and Linear when multi-user lands.

The ordering is not by raw value. It is by which build leaves the most behind
for the next one.

## 5. Open questions for product

Each has a proposed default so the shortlist stays actionable if no answer
comes back. None of the defaults is decided.

**Q1. What depth do we target per integration?**
Proposed default: v1 is one-way push out of Outrival, no inbound sync, no field
mapping UI beyond picking one target. Bidirectional sync is a separate decision
per provider, never a v1.

**Q2. Which objects do we write?**
Proposed default: HubSpot writes a Note on the Company record matched to the
competitor, and nothing else. Slack posts a message in a chosen channel.
`[unknown]` How a competitor maps to a CRM company record, by domain or by name,
is unresolved and is the first real design question of the HubSpot build.

**Q3. What criteria arbitrate the shortlist?**
Proposed default, all three must hold for `build now`:
- It serves the confirmed buyer, a GTM or product marketing owner.
- It forces at most one new piece of shared infrastructure.
- The first customer can use it without waiting on a partner directory review.

**Q4. Does the current gating hold?**
`[confirmed]` CRM destinations are business-tier only today. `[unknown]` Whether
Slack as an app stays a notification-tier feature or moves behind
`crmIntegrations` changes both pricing and the build. Worth settling before the
Slack build starts, not after.
