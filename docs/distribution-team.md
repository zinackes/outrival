# Distribution & Team — Phase C

Third phase of the consumption track (after `docs/consumption-cockpit.md` and
`docs/activation-retention.md`). Gets the intelligence **out of Outrival** and lets
a team react to it. Scoped deliberately to avoid external-OAuth and multi-user
blockers (decided 2026-06-06):

- **CRM = generic outbound webhook** (not a provider OAuth flow). Push signals to a
  configurable URL → Zapier/Make/n8n/any CRM. Zero external app registration.
- **Collaboration = signal comments** (works single-user, multiUser-ready). No
  @mentions/assignment until multiUser (Phase 10).

Both carry **small, additive, staged migrations** (manual `db:push`, like B).

## Features

### 1. Outbound webhook (CRM destinations)

```
crm_destinations  id, org_id, name, url, secret (nullable), enabled,
                  created_at, last_pushed_at (nullable)   · index(org_id)
```

- API `crm-destinations.ts` (org-scoped): `GET /` list, `POST /` create
  (gated by the `crmIntegrations` feature → `plan_locked_feature` for non-business),
  `DELETE /:id`, `POST /:id/test` (sends a sample payload from the API).
- **Auto-push**: `send-alert` (the existing dispatch point for Slack/email) also
  POSTs the signal payload to the org's enabled destinations, best-effort (a push
  failure never breaks the alert), via `apps/workers/src/lib/crm-webhook.ts`.
  Optional `secret` → `X-Outrival-Signature` HMAC-SHA256 of the body.
- Payload: `{ type:"signal", signal:{ id, severity, category, insight, competitor,
  recommendedAction, createdAt, url } }` — stable, documented for the receiver.
- Settings UI: a "CRM & webhooks" section on `/dashboard/settings/integrations`
  (add/remove/test destinations); paywalled below business.
- **Migration**: 1 new table → staged `db:push`.

### 2. Signal comments

```
signal_comments  id, signal_id (fk signals), org_id, user_id (fk users),
                 author_name, body, created_at   · index(signal_id)
```

- API on the signals resource: `GET /api/signals/:id/comments`,
  `POST /api/signals/:id/comments` `{ body }`, `DELETE /api/signals/:id/comments/:commentId`.
  Org-scoped; a user can delete only their own comment.
- UI: a comment toggle (with count) on the signal card that expands an inline
  thread (list + add). Works single-user today; `author_name` denormalised so the
  thread reads naturally once multiUser lands. No @mentions yet.
- **Migration**: 1 new table → staged `db:push`.

## Out of scope (later)

- Provider OAuth (HubSpot/Salesforce) bidirectional sync — a separate, heavier item.
- @mentions, assignment, per-comment notifications — need multiUser (Phase 10).
- Per-event subscription routing on destinations (only `signal` pushed for now).

## Verification

`pnpm typecheck` per feature (the repo's reliable gate). Both features are inert
until their `db:push` runs; the worker push is best-effort and degrades to a no-op
when an org has no destinations. No api/web test runner exists here.
