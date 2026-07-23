# E2E prod audit — 2026-07-23 (card A3)

Target: `https://outrival.app`, real infrastructure.

## Status: PARTIAL — the signed-in journey never started

The connected half of this audit (steps A–H of the card) could not run. This is
not a tooling problem and it was not worked around, because the card forbids
exactly that (*"pas de « on tente et Turnstile laissera peut-être passer »"*).

Two blockers, both named as prerequisites on the card itself:

1. **No audit mailbox.** Outrival authenticates by email OTP: a 6-digit code
   sent to the address you type. Without a mailbox we can read, there is no
   signup **and no login** — the whole signed-in surface is unreachable. This
   also blocks the deliverability metrics (delay, inbox vs spam), which were a
   headline deliverable.
2. **Turnstile decision not taken.** Confirmed live: `/auth` serves
   `<div id="cf-turnstile">`, and the audit hook does not exist in the codebase
   (`X-Audit-Token`: zero occurrences). The card offers a sanctioned server-side
   hook or a manual first signup; neither is in place.

Everything below is what production can be asked without a session.

## Method

Playwright (Chromium), four viewports — 320 / 375 / 768 / 1280 — over 15 public
routes plus a deliberate 404 probe. Console errors, uncaught page errors and
failed requests were recorded per page; horizontal overflow measured as
`documentElement.scrollWidth > clientWidth`. Screenshots in this directory.

## Findings

### 🟠 `/sample` overflows horizontally at 320px — already fixed, not yet deployed

Production: `scrollWidth 338` against a `clientWidth` of 320. Reproducible on
every attempt. The page is the site's primary proof, so it sideways-scrolls on
the narrowest common phone.

Cause: the old sample fixture carried an unbreakable URL —
`https://js.hsforms.net/forms/embed/v2.js` — inside the JobTetris signal text.

Already resolved by the A2 commit, which replaced the fixture with a week whose
signals contain no long tokens. Verified by measuring both builds side by side:

| Build | scrollWidth @320 | |
|---|---|---|
| production (current) | 338 | overflow |
| local (this branch) | 320 | clean |

No further action — it ships with the branch. Worth keeping in mind as a class
of defect: any user-visible string can carry an unbreakable token, so the digest
components would be safer with `break-words`.

### 🟠 `/demo` overflows horizontally at 320px

`scrollWidth 374` against 320 — a 54px overflow, larger than `/sample`'s. Not
isolated to a single element: the form and its ancestors measure correctly
(`left: 24, width: 272`) once the page settles, so the overflow comes from
something transient or from a portalled node (the Radix `Select` used for "Team
size" is the prime suspect — its option list measured at `left: 49, right: 349`
in one pass).

This page now matters more than when the audit was written: the sample-digest
offer (D5) points at it, and that offer is aimed at readers arriving from blog
posts, who skew mobile.

Not fixed here — the root cause needs a browser session to pin down properly,
and guessing at it would risk changing layout that is currently correct.

### 🟡 `/demo` logs console noise and a 401, at every viewport

```
%c%d font-size:0;color:transparent NaN
401 https://challenges.cloudflare.com/cdn-cgi/challenge-platform/…
```

Both come from Turnstile: the formatting artefact is its own logging, and the
401 is the challenge platform refusing an automated browser. Benign for real
users — and useful evidence that Turnstile does block automation, which is
precisely why the E2E needs the sanctioned hook rather than a hopeful attempt.

### ✅ 404 page

`/this-page-does-not-exist-404-probe` returns a real **HTTP 404** (not a soft
200) and renders the styled shell: skip-link, "This page could not be found",
cookie banner. Correct.

### ✅ Console cleanliness everywhere else

Fourteen public routes across four viewports produced **zero** console errors,
zero uncaught exceptions and zero failed requests, apart from the Turnstile
entries above. The two items the external audit listed as unchecked — console
errors and the 404 page — both come back clean.

### ✅ No overflow on any other page or viewport

`/`, `/vs/crayon`, `/alternatives/crayon`, `/security`, `/about`, `/blog` and the
rest fit at 320px, and nothing overflows at 375, 768 or 1280.

## What is still owed, and what unblocks it

| Deliverable | State |
|---|---|
| Findings report | this file — public surface only |
| Email delay + spam placement | **blocked** on the audit mailbox |
| TTFV measured in production (feeds B3) | **blocked** — needs a real signup |
| `e2e/smoke.prod.spec.ts` | scaffolded, cannot be run or trusted until login works |
| D6 (`/security` deep links into `/dashboard/settings/*`) | **blocked** — needs a session |

To unblock, one of each is needed:

- **Mailbox**: a dedicated address with IMAP and an app password, in
  `.env.local` as `AUDIT_IMAP_*`. `scripts/poll-inbox.ts` is written and waiting
  for those variables; it polls INBOX and spam and reports delay, folder,
  extracted codes and links.
- **Turnstile**: either implement the sanctioned server-side hook
  (`X-Audit-Token` + `audit+*` address, feature-flagged and logged), or perform
  one signup by hand and hand over the session — automation then starts at login.
