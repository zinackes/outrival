# Sources page v3: configurability and information design

Follow-up to the competitor page v2 work (PR #195), which created
`/dashboard/competitors/[id]/sources` and the shared source catalog. That page
established the right *model*: a partition of `SOURCE_TYPES`, a ten-state
`sourceState()` classifier, honest copy per state. What it did not do is give the
user anything to *do* about half of those states, and it renders every state at
the same visual weight.

Three problems, in the order they matter:

1. **`not_available` is a dead end.** When we conclude a competitor has no status
   page, no repo, no docs, no App Store listing, the row states the fact and offers
   nothing. If the user knows better, there is no way to tell us.
2. **Every non-collecting state reads as one thing.** A page we can retarget, a site
   that refuses us, and a surface that does not exist are three different facts with
   three different answers. Only the first is a task.
3. **The page is a flat wall.** Eight cards, roughly nineteen rows, every row at
   equal weight, the frequency control permanently rendered under each collecting
   one.

Visual proposal (interactive, before and after):
https://claude.ai/code/artifact/9138e062-feb4-448e-a0d3-c327c7194749

---

## Part I: the dead end

### What actually blocks it

`sourceCopy()` returns `action: null` for `not_available`, and `SourceRow` gates its
whole action cluster on `monitor && state !== "locked" && state !== "not_available"`.
With no monitor row at all (the `detectedAbsent` path for `status` and `changelog`)
the row renders a sentence and nothing else.

The important finding: **`POST /api/competitors/:id/monitors` already accepts an
optional `url` for every configurable source.** The enable route validates against
`planAllowsMonitorSource` and `validateMonitorUrl`, then stores `config.url`. So for
most sources the override path exists server-side and is simply not reachable from
the UI.

Two secondary facts that make the recovery path safe:

- `SCRAPE_SUCCESS_RESET` (`scrape-monitor.ts:179`) clears `lastError` on a successful
  capture, so a source that once threw `no_docs_surface` stops reporting
  `not_available` as soon as a pointed-at URL captures. Without this the override
  would appear to do nothing, because `hasNoTargetError` is checked *before* the
  `failing` guard in `sourceState`. Confirm the workers running in prod carry this
  commit.
- `PATCH /api/monitors/:id` on a URL change already clears the whole previous
  verdict (`markedUnscrapable`, `consecutiveFailures`, `requiresLevel`, `refusedAt`,
  `lastFailure*`) and lifts our auto-pause.

### Per-source blocker matrix

| Source | Why `not_available` | Override accepted today? | Work needed |
|---|---|---|---|
| `docs` | `no_docs_surface` | yes, optional URL, documented escape hatch | **UI only** |
| `github_repo` | `repo not found or private` | yes, `github` brand exception exists | **UI only** |
| `roadmap` | `no_roadmap_portal`, `portal_private`, `portal_empty` | yes, `ROADMAP_BRANDS` exception exists | **UI only** |
| `appstore_reviews` | no listing | yes, `validateReviewUrl` brand-locked to apps.apple.com | **UI only** |
| `changelog` | `targets.changelog` false | same-brand only | **UI only**, see the vendor note below |
| `status` | `targets.statusPage` false, or `no resolvable status host` | same-brand only | UI plus vendor brands |
| `trustpilot_public` | `no trustpilot business unit` | no, domain derived from `competitor.url` | scraper change |
| `youtube` | `no_channel` | no, in `AUTOMATIC_SOURCES`, read-only, no row | scraper plus UI |

**Six of eight are front-end only.** That is the whole shape of the plan.

All eight now carry a control. The rule applied throughout: a source gets one only
where naming a URL genuinely changes what we collect. A field that validates, stores,
and is then ignored by the scraper is worse than the dead end it replaces, because it
looks like it worked.

### The brand-lock problem (status and changelog)

`validateMonitorUrl` requires the URL's registrable brand to equal the competitor's,
with hard-coded exceptions for `jobs` (ATS_BRANDS), `github_repo` (`github`) and
`roadmap` (ROADMAP_BRANDS). Status pages routinely violate this in two ways:

- a vendor host, such as `acme.statuspage.io`, `acme.instatus.com`,
  `status.acme.betteruptime.com`
- a sibling domain, such as `vercel-status.com` for `vercel.com`, where
  `extractBrand` gives `vercel-status` which is not `vercel`, so it is rejected

The fix is the same pattern already used three times: a fixed public host list.

```ts
const STATUS_BRANDS = new Set([
  "statuspage",       // acme.statuspage.io
  "instatus",
  "betteruptime", "betterstack",
  "statuspal", "cachet", "sorryapp", "status",  // status.io
]);
const CHANGELOG_BRANDS = new Set([
  "headwayapp", "beamer", "releasenotes", "announcekit", "canny",
]);
```

The sibling-domain case is not covered by a brand list. Options, in order of
preference:

1. Accept a same-org heuristic: allow a URL whose brand contains the competitor
   brand as a hyphen-delimited token, so `vercel-status` contains `vercel`. Cheap,
   still SSRF-safe (an internal host never shares a brand token with a real product
   domain), and it covers the common `<brand>-status.com` convention.
2. Do nothing and let those competitors use a custom page monitor, except
   `validateCustomMonitorUrl` is *stricter* (exact eTLD+1), so that does not work
   either.

Recommend option 1, guarded by a unit test on the token boundary: `vercel` must not
match `vercelous.com`.

### Sequencing

**Step 1, front-end only, no API or shared change.** Ships the majority.

- `source-copy.ts`: add `action: "point_at_url"` to the `not_available` case and keep
  `tone: "neutral"`. The state must not start reading as a gap, since that rule is
  the whole reason `not_available` exists.
- `source-row.tsx`: drop `state !== "not_available"` from the action gate, and render
  the URL panel with source-specific `URL_GUIDANCE` (extend the map to `status`,
  `changelog`, `roadmap`, `trustpilot_public`).
- Copy: the affordance is the quietest control on the page, a ghost "Point us at
  one", never a primary button. The sentence stays a fact about them.
- Gate the two unsupported sources (`status` off-domain, `trustpilot_public`) behind
  step 2 rather than shipping a control that returns a 400.

**Step 2, shared and scrapers. SHIPPED**, with two deliberate changes of plan.

- `monitor-url.ts` gained three off-domain exceptions in the shape the ATS and
  roadmap ones already had: `STATUS_BRANDS`, a Trustpilot profile host, and a
  YouTube channel host.
- `STATUS_BRANDS` is **exactly `statuspage` and `instatus`**, not the longer vendor
  list the plan sketched. The scraper reads Statuspage's `/api/v2/summary.json` or
  Instatus's `/summary.json` and nothing else, so listing Better Stack or Statuspal
  would let the user turn on a source that fails every run. That is the same dead
  end this work exists to remove, dressed as a feature.
- The sibling-domain rule is **anchored on the convention** (`<brand>status`,
  `<brand>-status`, `<brand>_status`) rather than the "hyphen token contains the
  brand" heuristic the plan proposed. The loose version accepted any
  `acme-anything.com`; a `startsWith` version accepted `vercelstatus-phish.com`.
  Both are tested.
- `trustpilot.scraper.ts` gained `resolveTrustpilotDomain`: a `trustpilot.com/review/
  <domain>` URL names the domain to look up, anything else on their own site behaves
  as before. A trustpilot.com URL that is NOT a profile returns null rather than
  falling back to the host, which would have looked up Trustpilot's own business
  unit and stored a snapshot of the wrong company.

**`CHANGELOG_BRANDS` was dropped on purpose.** Opening the URL gate to
`acme.headwayapp.co` and friends is one line, but the changelog scraper probes
`CHANGELOG_PATHS` against whatever host it is handed, which assumes the competitor's
own site. The vendor URL would validate, create a monitor, and then fail. Vendor-
hosted changelogs need scraper work first; until then the same-domain override
(`acme.com/changelog`) is the only honest offer, and it already works.

**Step 3, YouTube. SHIPPED** as the narrow affordance, not the catalog move. It
stays in `AUTOMATIC_SOURCES` (seeding, plan gating and the read-only block are all
keyed on that partition, and moving it would change what every new competitor gets).
Instead:

- `isYouTubeUrl` plus a short-circuit at the top of `resolveChannelId`. The resolver
  used to fetch its input and look for a link to a channel inside it, so handing it a
  channel URL resolved only by accident. A pinned URL is now the answer: inline
  `/channel/UC…` costs zero fetches, a handle URL is fetched once and read directly.
- `PATCH /monitors/:id` needs no change. It validates ownership and the URL but does
  not gate on `isConfigurableSource`, so an existing YouTube monitor is retargetable
  once the URL validates.
- The Sources page shows one inline control on that row and nothing else. The
  always-on block is read-only by design, and one escape hatch must not turn it into
  a configuration surface.

---

## Part II: information design

The visual system is not the problem, the ranking is. Everything below stays inside
the existing tokens, type scale and components (`DESIGN.md`), so this is not a
restyle.

### 1. Three ways to be off, three groups

This is the correction that matters most, because the current page invites the user
to act on things they cannot act on. The classifier already encodes the distinction
and the UI throws it away:

| Group | States | Tone | Action |
|---|---|---|---|
| **Needs a new URL** | `fixable` | critical | the only group that asks for something |
| **Closed to us** | `blocked`, `login_required`, `geo_blocked` | limited (amber) | none, by doctrine |
| **No such surface** | `not_available` | neutral | optional override, quietest control |

`blocked` and its siblings carry `action: null` in `source-copy.ts` precisely because
under the collection doctrine we stop rather than route around a refusal. Putting
them under a heading that reads as a task list contradicts the copy printed inside
them ("No action needed from you"). Amber, its own group, and a label that says out
loud there is nothing to do.

Two refinements that fall out of the split:

- The blocked row's message is long (it names every fallback source). The row shows
  a short form and the drawer carries the full doctrine sentence.
- A refusal is re-probed every 14 days (`UNSCRAPABLE_REARM_DAYS`). The drawer says
  so, which turns a dead row into a thing that is still being watched.

### 2. Attention beats taxonomy

A `fixable` source currently waits its turn inside its group. The page is scanned to
find what needs a decision, so that group lifts to the top and the rest follow in
catalog order.

### 3. Eight cards become one sheet

Six group cards for eleven sources means three groups hold a single row, each paying
a full card's border, header and padding. Groups become inline dividers inside one
card.

### 4. Config moves into a drawer

The frequency segmented control renders under *every* tracking row today. That is
fifteen or more buttons permanently on screen, on the rows that need the least
attention. Clicking a row opens frequency, toggle and URL together. A resting row is
one line. This is the direct answer to "too much information": the page shows less
and lets you do more.

### 5. Coverage becomes a shape, and the shape is the filter

`coverageHeadline()` writes a good sentence that is buried in the subtitle. A
segmented ribbon renders the same buckets, with chips below acting as filters. Its
denominator stays the **applicable** sources only, so `not_available` gets a chip but
no segment, exactly as `coverage.ts` already specifies.

Do not caption that rule. An early draft put "surfaces they don't have never count
against them" next to the chip, which defends a denominator the user never sees,
since the page deliberately shows no ratio. Exclusion from the bar is the whole
statement. The group header in the list ("No such surface", "Add one if you know
better") carries the only part that is actionable.

### 6. Read-only collapses

Seven always-on sources (six automatic plus tech stack) carry no user decision and
occupy a seventh of the page. One summary line, expanded on demand.

**Superseded in part (OUT-11, 2026-08-05).** "Carry no user decision" was true of what
we collect, not of how often: all six are seeded weekly and a pro workspace has a real
reason to want news or the HN feed daily. The expanded block now carries ONE control per
row, a two-segment cadence (daily / weekly), and only for `features.alwaysOnCadence`
(pro+); below it the row shows the current cadence behind a lock that opens the paywall.

Two rows still render nothing, and the order of those two checks is the design:

- `subdomains` is pinned to weekly on every tier (crt.sh 429s under a daily load), so it
  is checked FIRST and shows no control at all. A lock there would advertise an upgrade
  that changes nothing about that row.
- a `not_available` row keeps the "point us at one" escape hatch instead, since a surface
  the competitor doesn't have has nothing to check more often.

`realtime` is never offered on any tier: these sources read endpoints we don't own, so an
hourly poll is not something a plan can sell. Everything else in this section stands, and
tech stack still has no cadence (its own monthly cron). See `docs/tier-limits.md`.

---

## Part III: motion spec

The accordion has to feel like the sheet opening, not like the page reflowing. Rows
below the one you clicked must travel with it.

Animate a grid track rather than `height`, so real height eases and no JS measures
anything:

```css
.source-drawer {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 280ms cubic-bezier(.4, 0, .2, 1);
}
.source-row[data-open="true"] .source-drawer { grid-template-rows: 1fr; }
.source-drawer > .clip { overflow: hidden; min-height: 0; }   /* both required */
```

Layered on top, so the content arrives just after the space exists:

- drawer content: `opacity 0 -> 1` (180ms) and `translateY(-4px) -> 0` (240ms), with
  a 60ms delay so it fades in behind the opening edge rather than stretching.
- chevron: `rotate(90deg)` on the same 260ms curve.
- open row: a one-step background lift (`--surface` to a value between it and
  `--surface-2`) over 180ms, so the row plus its drawer read as one block.
- row-level hover actions stay pinned visible while the row is open, otherwise they
  vanish the moment the pointer enters the drawer.

Constraints:

- `min-height: 0` on the clip is mandatory. Without it the grid item refuses to
  shrink below its content and the row snaps open.
- The whole set sits under `prefers-reduced-motion: reduce`, which the app already
  applies globally.
- Do not animate `max-height` with a guessed ceiling. Drawer height varies a lot
  between a bare frequency control and a blocked row's full explanation, and a wrong
  ceiling either clips content or adds dead time to the easing.

The same technique drives the two collapsed blocks (custom pages, always-on), so
there is one motion vocabulary on the page.

---

## What this does not change

- The ten-state classifier, the catalog partition, and the copy doctrine
  (`not_available` neutral, `blocked` honest about not bypassing) all stay. This
  builds on them.
- No migration, no new table, no scraper change in step 1.
- `PausedMonitors` keeps its recovery card, since it is diagnosis-specific and the
  row above it only states the problem.

## Verification

- `sourceCopy` gains a case, so extend the existing copy test with the new action and
  assert `not_available` keeps `tone: "neutral"` and `blocked` keeps `action: null`.
- `monitor-url.test.ts`: vendor brands accepted, hyphen-token same-org accepted,
  `vercelous.com` rejected for `vercel.com`, internal hosts still rejected.
- `catalog.test.ts` already fails on any unplaced enum value, so the YouTube decision
  cannot be made accidentally.
- `pnpm typecheck` plus `pnpm build --filter @outrival/web`. Note that `pnpm dev`
  OOMs on the WSL2 VM, so the build is the gate and the mockup above stands in for
  visual review.
