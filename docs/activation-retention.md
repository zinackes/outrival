# Activation & Retention — Phase B

Second phase of the consumption track (after `docs/consumption-cockpit.md`).
Phase A made the intelligence *visible*; Phase B turns the passive reader into an
active user who comes back: a place to track what to act on, saved views to return
to, an activation checklist for new workspaces, and an in-app changelog.

> Phase split recap: **A** (cockpit, shipped) · **B** (this doc) · **C** (CRM,
> collaboration — later). Phase B carries **small, staged migrations** (manual
> `db:push`, like patch-28/32). The two no-migration features ship first.

## Features & order (by migration risk)

| # | Feature | Migration | Risk |
|---|---|---|---|
| 1 | What's new (in-app changelog) | none (static content) | none |
| 2 | Onboarding checklist | none (derives existing state) | none |
| 3 | Watchlists / saved views | new `saved_views` table | low (additive) |
| 4 | Intel → action loop | 3 columns on `signals` | low (additive, nullable) |

Ship 1 + 2 first (no `db:push`), then 3 + 4 (each needs a staged `db:push` run by
the user, as for patch-28/32).

### 1. What's new — `/dashboard/whats-new`

In-app changelog so users see what shipped. **No DB.**

- Content = a typed array in `apps/web/src/lib/whats-new.ts`
  (`{ date, title, tag, items[] }`), newest first. Seeded with the consumption
  cockpit (Trends, Compare, Usage, Sector).
- Page renders the entries. An "unseen" dot compares the latest entry `date`
  against a `localStorage` last-seen timestamp; opening the page clears it.
- Surface: a small trigger in the dashboard topbar (sparkle/megaphone icon + dot).
- Adding an entry later = append to the array; no migration, no endpoint.

### 2. Onboarding checklist

A dismissible activation card on the overview that guides a new workspace to value.
**No DB** — derive each step from existing data.

- `GET /api/onboarding/checklist` → `{ steps: [{ key, done }], complete }`.
  Steps (all from existing tables): product profile set, ≥1 competitor added,
  ≥1 source/monitor enabled, notifications configured, first signal received.
- Component: shown on the overview while `!complete` and not dismissed; dismissal
  persisted in `localStorage` (no DB). Each incomplete step links to where to do it.
- Re-uses existing endpoints where possible; the new endpoint only aggregates
  booleans (read-only).

### 3. Watchlists / saved views — `saved_views` table

Saved filter sets on the Signals feed, so a user returns to "just pricing for
A & B" in one click.

```
saved_views   id, org_id, user_id, name, filters (jsonb), created_at, updated_at
              index (org_id)
```

- `filters` jsonb = the feed filter state (competitorIds[], categories[],
  severities[], view mode). Org-scoped; `user_id` = creator (multiUser is off, so
  effectively per-user today, but org-scoped is forward-compatible).
- API `saved-views.ts`: `GET /` (list), `POST /` (create `{name, filters}`),
  `DELETE /:id`. All org-scoped.
- Signals feed: a "Saved views" control to apply / save the current filters.
- **Migration**: 1 new table → staged `db:push` (user runs it).

### 4. Intel → action loop — columns on `signals`

Close the loop: each signal's `recommended_action` becomes trackable.

```
signals  + action_status      text       (null = untriaged; todo | doing | done | dismissed)
         + action_note        text        (optional user note)
         + action_updated_at  timestamptz (when the status last changed)
```

- Columns on `signals` (not a side table): the feed already selects signals, so
  status comes for free, and the "action board" = signals filtered by
  `action_status in (todo, doing)`. App-level validation of the status set (text
  column, no new enum → lighter migration).
- API: `PATCH /api/signals/:id/action` `{ status, note? }` (org-scoped) stamps the
  three columns. The signals list/detail returns them.
- Web: a status control on each signal (feed + detail) and an **Action board** view
  (`/dashboard/signals?view=actions` or a tab) listing open actions.
- **Migration**: 3 additive nullable columns → staged `db:push` (user runs it).

## Out of scope (Phase C)

- Assignment to teammates / @mentions / comments → needs multiUser (Phase 10).
- CRM push of actions/battle cards.
- Action SLAs / reminders.

## Verification

Per-feature: `pnpm typecheck` (the repo's reliable gate; no api/web test runner).
Features 3 & 4 are inert until their `db:push` runs — the code typechecks before,
the columns/table simply don't exist yet (same staged pattern as patch-28/32).
