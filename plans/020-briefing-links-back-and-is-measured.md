# Plan 020: Every recurring briefing email has a way back into the product, and its click-through is measurable

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report, do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 74888f6..HEAD -- packages/shared/src/email apps/workers/src/core/generate-weekly-digest.ts apps/workers/src/core/generate-daily-digest.ts apps/api/src/routes/digests.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S-M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `74888f6`, 2026-07-25

## Why this matters

`docs/post-onboarding-activation.md:288` states the product's retention thesis in
one line: "North-star retention metric for the product: **briefing open rate**, not
DAU. The app is where you dig; the inbox is where the habit lives."

Three of the recurring briefing emails contain **no link back into the app at all**.
The weekly digest, the all-quiet digest and the daily digest render a footer with a
thumbs-up/thumbs-down link (to the API) and an unsubscribe link (to the API), and
nothing else. A reader who wants to act on what they just read has to remember the
URL. The one-off lifecycle emails do it right already: `welcome`, `celebration` and
`monthly recap` each end with a CTA button (`packages/shared/src/email/lifecycle.ts:37,62,98`).
It is the *recurring* surface, the one the habit is supposed to form on, that is a
dead end.

The measurement consequence: there is no click to attribute, so the declared
north-star metric has never had a number. Production analytics show
`user_logged_in` last firing on 2026-07-06 and weekly dashboard actives in the
1 to 10 range. Whether people read the briefings and never return, or never read
them, is currently unknowable, and those two problems have opposite fixes.

This plan gives the three recurring briefings a CTA carrying a source parameter, so
click-through becomes countable from the `$pageview` events already collected. It
deliberately does **not** add an open-tracking pixel: opens require an image beacon,
which is a privacy surface on a product that already publishes a subprocessors page,
and clicks are the stronger signal anyway. That trade-off is recorded in the
maintenance notes so the next person does not re-litigate it silently.

## Current state

### The files

- `packages/shared/src/email/digest.ts` — `renderDigestEmail` (weekly + on-demand
  resend) and `renderAllQuietDigest`. Pure render functions, no DB, no Resend.
- `packages/shared/src/email/lifecycle.ts` — the one-off emails that already have a
  CTA, and the private `button()` helper this plan promotes to shared.
- `packages/shared/src/email/shell.ts` — `emailShell`, imported by both files above.
  This is the neutral home for the shared button.
- `apps/workers/src/core/generate-weekly-digest.ts` — the weekly job. Calls
  `renderAllQuietDigest` at line 175 and `renderDigestEmail` at line 389.
- `apps/workers/src/core/generate-daily-digest.ts` — the daily job. Builds its email
  inline with `emailShell` at line 173, so it needs its own CTA rather than a
  renderer parameter.
- `apps/api/src/routes/digests.ts:358` — the on-demand send/resend, the second
  caller of `renderDigestEmail`.
- `packages/shared/src/email/digest.test.ts` and `shell.test.ts` — the existing
  test pattern for these renderers. Model new tests on them.

### The CTA that already exists, and must be reused

`packages/shared/src/email/lifecycle.ts:9-14`:

```ts
// The CTA is an accent fill in both modes. It used to be a white pill (readable
// only because the canvas was always dark) — on a light canvas that is a white
// button on white.
function button(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" ${e("btn", "display:inline-block;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;")}>${escapeHtml(label)}</a>`;
}
```

Do not write a second button. The comment records a real bug that was already fixed
(a white pill invisible on a light canvas); a fresh implementation will reintroduce
it. Emails are authored light with a dark override, and the override must be
`!important` to win.

### The renderer signature you extend

`packages/shared/src/email/digest.ts:41-49`:

```ts
export function renderDigestEmail(
  digest: DigestEmailData,
  weekStart: string,
  weekEnd: string,
  // Optional one-click feedback links (patch-21). Absent → footer without them
  // (e.g. when the signing secret or API base URL isn't configured).
  feedbackLinks?: { useful: string; notUseful: string },
  unsubscribeUrl?: string,
  // Sub-heading under the wordmark. Daily resends override the default weekly copy.
  subtitle = "Your weekly competitive briefing",
): string {
```

Both call sites pass positional arguments, and the API caller passes all six
(`apps/api/src/routes/digests.ts:358-364`). A new parameter must therefore be added
**last**, so neither call site breaks.

The footer it currently produces, `packages/shared/src/email/digest.ts:150-163`:

```ts
      ${
        feedbackLinks
          ? `<div ...>
        Was this briefing useful?
        <a href="${feedbackLinks.useful}" ...>👍 Yes</a>
        <a href="${feedbackLinks.notUseful}" ...>👎 No</a>
      </div>`
          : ""
      }
      <div ${e("faint", "margin-top:32px;font-size:11px;text-align:center;")}>Outrival · Automated competitive intelligence${
        unsubscribeUrl
          ? ` · <a href="${unsubscribeUrl}" ...>Unsubscribe</a>`
          : ""
      }</div>`,
```

### The URL idiom to copy

`apps/workers/src/core/send-welcome-digest.ts:35-38`:

```ts
    const webUrl = process.env.WEB_URL ?? "https://outrival.app";
    const email = renderWelcomeEmail({
      competitorNames: comps.map((c) => c.name),
      dashboardUrl: `${webUrl}/dashboard`,
    });
```

Note that the digest jobs currently derive `apiBase` from `NEXT_PUBLIC_API_URL`, not
`WEB_URL`, because their existing links point at the API. The CTA points at the
**web app**, so it must use `WEB_URL` with the same fallback as above.

The destination route exists: `apps/web/src/app/dashboard/digests/[id]/` renders a
stored digest, and the weekly job already has the stored row's id in scope
(`stored.id`, used at `generate-weekly-digest.ts:201`).

### Conventions that apply

- **English only, from the first commit** (`.claude/rules/language.md`). All CTA
  labels are English.
- **`@outrival/shared` sits at the bottom of the dependency graph** and must not
  import from an app (`packages/shared/src/email/digest.ts:5-8` says so explicitly).
  Keep the renderers pure: they receive a URL, they never build one.
- **Emails are authored light with a `@media (prefers-color-scheme: dark)` /
  `[data-ogsc]` dark override, and the override must be `!important` to win.** The
  `e()` helper in `theme.ts` is what emits the class plus inline-style pair that
  makes this work. Use `e("btn", ...)` via the shared button and add no raw styles.
- No em-dashes in user-facing copy; rephrase rather than substituting a hyphen.

## Commands you will need

| Purpose       | Command                               | Expected on success    |
|---------------|---------------------------------------|------------------------|
| Typecheck     | `pnpm typecheck`                      | exit 0, 8 tasks        |
| Tests         | `pnpm test`                           | exit 0, all pass       |
| Shared tests  | `pnpm --filter @outrival/shared test` | exit 0                 |

**Environment gotcha**: `turbo` is not on `PATH`. A bare `turbo test` prints
`turbo: command not found` and reads as silence when piped. Use the `pnpm` scripts.

**Do not run `pnpm build`**: a full web build exhausts RAM on the WSL2 dev box.

## Scope

**In scope**:
- `packages/shared/src/email/shell.ts` (add the exported button)
- `packages/shared/src/email/lifecycle.ts` (import it, delete the local copy)
- `packages/shared/src/email/digest.ts` (both renderers gain the CTA)
- `packages/shared/src/email/digest.test.ts` (extend)
- `apps/workers/src/core/generate-weekly-digest.ts` (pass the URL, both paths)
- `apps/workers/src/core/generate-daily-digest.ts` (add the CTA to the inline shell)
- `apps/api/src/routes/digests.ts` (pass the URL on the on-demand send)
- `docs/post-onboarding-activation.md` (record the measurement convention)

**Out of scope** (do NOT touch, even though they look related):
- `apps/api/src/routes/digest-feedback.ts` — the unsubscribe and feedback token
  routes. Plan 013 is rewriting that file (POST-only unsubscribe plus a token TTL);
  editing it here creates a conflict for no benefit.
- Any open-tracking pixel, `openTracking` flag, or Resend webhook route. Explicitly
  deferred, see maintenance notes.
- `packages/shared/src/email/theme.ts` — the palette is settled; the button already
  has a `btn` role.
- The alert email path (`send-alert`) and the battle-card PDF. Different surfaces,
  different jobs.
- Any change to the digest's AI content, sections, or the faithfulness gate.

## Git workflow

- Branch: `advisor/020-briefing-cta`
- Conventional Commits, subject at most 50 chars, imperative. Example from
  `git log`: `fix(web): put the search settings in the header (#265)`.
  Suggested: `feat(email): give every briefing a way back in`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Promote the button to the shared shell

Move the `button` function from `packages/shared/src/email/lifecycle.ts:12-14` into
`packages/shared/src/email/shell.ts`, exported as `emailButton`, keeping its
comment verbatim (it records a fixed bug). Have `lifecycle.ts` import it and delete
its local copy. Do not change the markup or the styles.

Check whether `packages/shared/src/index.ts` (or whatever the package's barrel file
is) re-exports the email module's members, and add `emailButton` there only if the
existing members are exported that way. Match what is already done for `emailShell`.

**Verify**: `pnpm typecheck` → exit 0, and
`grep -n "function button" packages/shared/src/email/lifecycle.ts` returns nothing.

### Step 2: Give both digest renderers a CTA

In `packages/shared/src/email/digest.ts`:

- Add a final optional parameter `readUrl?: string` to `renderDigestEmail`, after
  `subtitle`. When present, render `emailButton(readUrl, "Open the full briefing")`
  immediately **above** the feedback block, inside a wrapper with
  `margin-top:28px;text-align:center;`. When absent, render nothing (same
  degradation contract as `feedbackLinks`).
- Add `readUrl?: string` to the `AllQuietDigestData` interface
  (`digest.ts:168-176`) and render the same button in `renderAllQuietDigest`, above
  the footer, with the label `"See what we checked"`. The all-quiet email's whole
  job is to prove work happened, so its CTA should lead to the evidence rather than
  to an empty feed.

Do not change any existing markup, spacing, or copy.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Cover the renderers with tests

Extend `packages/shared/src/email/digest.test.ts`, matching its existing structure
(open it first and copy the assertion style; do not introduce a new test helper).
Add cases:

- `renderDigestEmail` with `readUrl` → output contains the URL and the label
  `Open the full briefing`.
- `renderDigestEmail` without `readUrl` → output contains neither, and is otherwise
  byte-identical to the current output for the same inputs (assert the absence of
  the label; a full snapshot is not required).
- `renderAllQuietDigest` with `readUrl` → contains the URL and `See what we checked`.
- A `readUrl` containing `&` and `"` → the output escapes it (the shared button runs
  `escapeHtml` on the href; assert the raw characters do not appear unescaped).

**Verify**: `pnpm --filter @outrival/shared test` → exit 0, 4 new cases pass.

### Step 4: Pass the URL from all three send paths, with a source tag

Every CTA URL carries a `src` query parameter naming the email it came from. That
parameter is the entire measurement mechanism, so the values are a contract:
`digest_weekly`, `digest_allquiet`, `digest_daily`, `digest_resend`.

**`apps/workers/src/core/generate-weekly-digest.ts`**, all-quiet path (near line 169,
where `apiBase` is derived): add
`const webUrl = process.env.WEB_URL ?? "https://outrival.app";` and pass
`readUrl: \`${webUrl}/dashboard/digests/${stored.id}?src=digest_allquiet\`` into the
`renderAllQuietDigest` call at line 175.

Same file, weekly path (near line 389): pass
`\`${webUrl}/dashboard/digests/${stored.id}?src=digest_weekly\`` as the new seventh
argument to `renderDigestEmail`.

**`apps/api/src/routes/digests.ts:358`**: pass a seventh argument built the same way,
with `src=digest_resend`. Read how that handler already obtains the digest id and
the web base URL before adding a new env read; reuse whatever it has.

**`apps/workers/src/core/generate-daily-digest.ts`**: this one builds its HTML inline
with `emailShell` at line 173. Import `emailButton` and insert it after `${rows}` and
before the unsubscribe div, wrapped in
`<div style="margin-top:28px;text-align:center;">`, pointing at
`${webUrl}/dashboard/signals?src=digest_daily`. The daily digest carries deferred
signals rather than a stored digest row, so the feed is the right destination; do
not invent a digest id for it.

If `WEB_URL` is unset the fallback `https://outrival.app` applies, so the CTA is
always present in production. Do not make the CTA conditional on an env var.

**Verify**: `pnpm typecheck` → exit 0, and
`grep -rn "src=digest_" apps/workers/src apps/api/src` returns exactly 4 matches.

### Step 5: Record the measurement convention

Append a short subsection to `docs/post-onboarding-activation.md` under Lever 11
(around line 279-289), titled `### Measuring the briefing habit`. It must state:

- Every recurring briefing CTA carries `?src=<tag>`, and list the four tags.
- Click-through is read from the existing PostHog `$pageview` events, with the query
  to use:

  ```sql
  SELECT properties.$pathname AS path, count() AS clicks, uniq(person_id) AS people
  FROM events
  WHERE timestamp >= now() - INTERVAL 30 DAY
    AND event = '$pageview'
    AND properties.$current_url LIKE '%src=digest%'
  GROUP BY path
  ```

- **Open rate stays unmeasured, on purpose**: it needs an image beacon, which is a
  privacy surface this product does not currently have, and click-through is the
  stronger retention signal. Whoever wants opens must decide that trade-off
  explicitly, not inherit it.
- The baseline: state that at the time of writing the value is zero clicks, because
  no briefing had a link.

**Verify**: `grep -n "Measuring the briefing habit" docs/post-onboarding-activation.md`
returns one match.

## Test plan

- 4 new cases in `packages/shared/src/email/digest.test.ts` (step 3), covering the
  CTA present, the CTA absent, the all-quiet variant, and href escaping.
- No new worker or API tests: the job changes are argument passing, covered by
  typecheck, and the workers package has no email-send test harness.
- Verification: `pnpm test` → exit 0, including the 4 new cases.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0, with 4 new passing cases in the shared email tests
- [ ] `grep -n "function button" packages/shared/src/email/lifecycle.ts` returns no
      match (the helper moved, it was not duplicated)
- [ ] `grep -rn "src=digest_" apps/workers/src apps/api/src` returns exactly 4
      matches, one per tag
- [ ] `docs/post-onboarding-activation.md` contains the
      `### Measuring the briefing habit` subsection with the four tags and the query
- [ ] `git status` shows no modified file outside the in-scope list
- [ ] `plans/README.md` status row for 020 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `renderDigestEmail`'s signature at `packages/shared/src/email/digest.ts:41` does
  not match the excerpt above, or a third caller of it exists that this plan does
  not list. Adding a positional parameter is only safe because there are exactly two
  callers.
- `apps/web/src/app/dashboard/digests/[id]/` no longer exists, which would make the
  weekly CTA point at a 404.
- The `btn` role is missing from `packages/shared/src/email/theme.ts`, meaning the
  button would render unstyled.
- A step's verification fails twice after a reasonable fix attempt.
- You find yourself needing to edit `apps/api/src/routes/digest-feedback.ts`. That
  file belongs to plan 013; report the collision instead of resolving it.

## Maintenance notes

- **Deliberately deferred: open tracking.** Opens need a beacon image and a place to
  store the events (a Resend webhook route plus an append-only table). It was left
  out because of the privacy surface, not because it is hard. If it is ever added,
  the `src` tag convention should carry over so opens and clicks share one taxonomy.
- **Also deferred: bounce and delivery visibility.** Today a digest that hard-bounces
  is invisible; the job logs a success as long as the Resend call returns. A Resend
  webhook consuming `email.bounced` and `email.delivered` would fix that and is a
  better first webhook than opens. It needs a new table, so it is its own plan.
- A reviewer should check two things: that the CTA is above the feedback block (a
  CTA below the unsubscribe link is a CTA nobody sees), and that the button renders
  on a light canvas, since `lifecycle.ts:9-11` records that exact regression.
- `src` values are a measurement contract. Renaming one silently breaks the
  historical series in PostHog; add new tags rather than renaming old ones.
