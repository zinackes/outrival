# Plan 013: A link prefetch can no longer silently disable an org's digests

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 74888f6..HEAD -- apps/api/src/routes/digest-feedback.ts packages/shared/src/feedback-token.ts apps/api/src/routes/digests.ts`
> If any changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `74888f6`, 2026-07-25

## Why this matters

`GET /api/digest-feedback/unsubscribe?token=...` performs a state change: it
sets `organizations.digestEnabled = false` for the whole organisation.

Unauthenticated GET requests are issued by machines all the time. Outlook
SafeLinks, Slack link unfurling, corporate mail-scanning gateways and browser
prefetch all fetch links they encounter. Any one of them hitting that URL turns
off the product's core recurring deliverable for an entire organisation, with no
user action, no confirmation, and no notification to anyone.

The token compounds it. It is a stateless HMAC over `unsub:digest:<orgId>` with
no timestamp and no server-side record. The module docstring states this
plainly: "Stateless, nothing to store or expire". So the capability never
expires: every archived copy of every digest email retains the power to disable
digests forever, and forwarding a digest hands that power to the recipient.

The same file has a second GET that writes: `GET /api/digest-feedback/` inserts
or updates a `qualityFeedback` row, so a scanner also silently records feedback
nobody gave. That is lower stakes but the same defect, and it pollutes the
feedback signal that drives the relevance-threshold auto-tuning.

There is a standard answer for the header case, and this codebase already emits
it: RFC 8058 `List-Unsubscribe-Post`, which tells mail clients to use POST.

## Current state

### The state-changing GET (`apps/api/src/routes/digest-feedback.ts:26-39`)

```ts
// flipping digestEnabled off (reversible from Settings > Notifications).
digestFeedbackRouter.on(["GET", "POST"], "/unsubscribe", async (c) => {
  ...
    .set({ digestEnabled: false, updatedAt: new Date() })
```

The route accepts both verbs and mutates on either.

### The second writing GET (`apps/api/src/routes/digest-feedback.ts:48`)

```ts
digestFeedbackRouter.get("/", async (c) => {
```

Inserts or updates a `qualityFeedback` row.

### The never-expiring token (`packages/shared/src/feedback-token.ts:1-6, 28-35`)

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

// Short signed token for one-click digest feedback from an email (patch-21).
// No session: the link itself is the credential. HMAC-SHA256 over the payload,
// signed with the app secret (BETTER_AUTH_SECRET), so it can't be forged or
// tampered with. Stateless — nothing to store or expire server-side.
```

```ts
// One-click digest unsubscribe from the email footer — same stateless HMAC
// scheme. Only ever flips organizations.digestEnabled to false, so a leaked
// link can't do worse than stopping emails the user can re-enable in settings.
export function signUnsubscribeToken(orgId: string, secret: string): string {
  const body = b64url(Buffer.from(`unsub:digest:${orgId}`, "utf8"));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}
```

Note the payload has no timestamp, so `verifyUnsubscribeToken` has nothing to
expire against.

The comment's risk assessment ("can't do worse than stopping emails") is
reasonable about a *leak*. It does not account for an automated GET doing it
without anyone leaking anything.

### The router is deliberately unauthenticated

`apps/api/src/index.ts:107-108`:

```ts
// Public (token-authenticated) digest email feedback — no session middleware.
app.route("/api/digest-feedback", digestFeedbackRouter);
```

That is correct and stays. The token is the credential.

### The email already emits the RFC 8058 header pair (`apps/api/src/routes/digests.ts:355, 376-381`)

Both a body link and `List-Unsubscribe` / `List-Unsubscribe-Post`. The header
path already implies POST; only the body link needs a confirmation step.

### Language rule

`.claude/rules/language.md`: all user-facing copy is English.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| API tests | `cd apps/api && bun test --timeout 60000 test/` | all pass |
| Shared tests | `cd packages/shared && bun test src` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Whole suite | `pnpm test` | exit 0 |

Note: `turbo` is **not** on `PATH`. Use the `pnpm` scripts.

## Scope

**In scope** (the only files you should modify or create):
- `apps/api/src/routes/digest-feedback.ts` (split GET from POST on both routes)
- `packages/shared/src/feedback-token.ts` (add an issued-at claim and a TTL)
- `packages/shared/src/feedback-token.test.ts` (create or extend)
- `apps/api/test/digest-feedback.test.ts` (create)
- `apps/api/src/routes/digests.ts` (only if the token call site needs the new argument)

**Out of scope** (do NOT touch, even though they look related):
- Mounting the router behind `authMiddleware`. It is unauthenticated by design;
  the token is the credential. Do not "fix" that.
- The `List-Unsubscribe` / `List-Unsubscribe-Post` headers. They already point at
  POST and are correct.
- The HMAC scheme itself (algorithm, `timingSafeEqual` comparison, base64url
  encoding). Only the payload gains a timestamp.
- `signDigestFeedbackToken`'s verdict semantics.
- The notification-preferences UI and the settings path for re-enabling digests.

## Git workflow

- Branch: `fix/unsubscribe-post-only` off `main`.
- Commit message style, matching `git log`: `fix(api): stop GET from killing digests`.
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Confirm both defects

```bash
grep -n 'on(\["GET", "POST"\]' apps/api/src/routes/digest-feedback.ts
grep -n "digestEnabled: false" apps/api/src/routes/digest-feedback.ts
grep -n "Stateless" packages/shared/src/feedback-token.ts
```

**Verify**: the route accepts GET and mutates, and the token module documents
itself as non-expiring. If the route is already POST-only, STOP.

### Step 2: Make GET safe, keep POST as the mutation

Split the handler:

- **POST `/unsubscribe`**: verify the token and perform the update, exactly as
  today. This is the path RFC 8058 mail clients use.
- **GET `/unsubscribe`**: verify the token, mutate **nothing**, and return a
  small self-contained HTML confirmation page with a form that POSTs back to the
  same URL with the token. One button, English copy, in the product's register.

Reuse the existing HTML-escaping helper rather than interpolating the token into
markup unescaped. Check what the neighbouring email/HTML code uses
(`apps/workers/src/lib/escape-html.ts` re-exports one from `@outrival/shared`),
and use the same one on the API side.

Apply the same treatment to the second writing route: `GET /` must not insert a
`qualityFeedback` row. Give it a confirmation step, or move the write to POST.

**Verify**: `pnpm typecheck` exits 0. `grep -c 'on(\["GET", "POST"\]' apps/api/src/routes/digest-feedback.ts`
returns 0.

### Step 3: Give the token an expiry

Add an issued-at value to the signed payload. The current payload is a plain
colon-joined string (`unsub:digest:<orgId>`), so append a field rather than
switching format:

- sign `unsub:digest:<orgId>:<issuedAtEpochSeconds>`
- `verifyUnsubscribeToken` parses the timestamp and rejects a token older than
  a TTL constant

Pick a TTL that is generous relative to how long someone might reasonably act on
an emailed digest. 30 days is a defensible default for a weekly digest; put it in
a named constant with a comment stating the reasoning, not a bare number.

**Backwards compatibility is the decision to make here.** Old tokens have no
timestamp. Choose one and state it in your report:

- **(a)** Reject tokens without a timestamp. Cleanest, but every unsubscribe link
  in every already-sent digest stops working, which is a real deliverability and
  compliance consideration: a broken unsubscribe link is worse than a
  long-lived one.
- **(b)** Accept a timestamp-less token as valid (legacy grace), and add a
  comment with a date when the branch should be removed.

**Prefer (b).** A dead unsubscribe link in a mailbox is a worse outcome than the
capability living slightly longer, and the GET fix in step 2 already removes the
prefetch hazard, which is the sharp edge.

**Verify**: `cd packages/shared && bun test src` passes with the new cases.

### Step 4: Update the token issuer if needed

If `signUnsubscribeToken`'s signature changed (a new `issuedAt` argument), update
its call site in `apps/api/src/routes/digests.ts`. If you defaulted `issuedAt` to
"now" inside the function, no call site changes.

**Verify**: `pnpm typecheck` exits 0.

### Step 5: Test the routes

Create `apps/api/test/digest-feedback.test.ts` (the package runs
`bun test test/`). Use the existing harness, and follow its documented ordering:
install mocks first, then dynamically import the router. A static top-level
import of a router without the harness makes the test order-dependent.

Cases:

1. **The regression**: `GET /unsubscribe` with a valid token returns 200 and
   `organizations.digestEnabled` is **unchanged**.
2. `POST /unsubscribe` with a valid token sets `digestEnabled` to false.
3. An invalid or tampered token does not mutate, on either verb.
4. `GET /` (feedback) with a valid token does not insert a `qualityFeedback` row.

**Verify**: `cd apps/api && bun test --timeout 60000 test/` passes, whole
directory (not just your file), to catch a mock leak.

### Step 6: Full-suite check

**Verify**: `pnpm typecheck` exits 0 and `pnpm test` exits 0.

## Test plan

- `packages/shared/src/feedback-token.test.ts`: a fresh token verifies; a token
  older than the TTL is rejected; a tampered signature is rejected; under option
  (b), a legacy timestamp-less token still verifies.
- `apps/api/test/digest-feedback.test.ts`: the four cases in step 5, with case 1
  being the specific regression this plan exists for.
- Structural pattern: an existing route test under `apps/api/test/` that uses the
  harness (for instance the monitors or competitors tests), for the mock-then-
  dynamic-import ordering.
- Verification: both suites pass; `pnpm test` exit 0.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c 'on(\["GET", "POST"\]' apps/api/src/routes/digest-feedback.ts` returns 0
- [ ] No `db.update(...)` or `db.insert(...)` is reachable from a GET handler in
      `apps/api/src/routes/digest-feedback.ts`
- [ ] `packages/shared/src/feedback-token.ts` verification rejects an expired token
- [ ] A test asserts `GET /unsubscribe` leaves `digestEnabled` unchanged
- [ ] `cd apps/api && bun test --timeout 60000 test/` exits 0
- [ ] `cd packages/shared && bun test src` exits 0
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] Your report states which backwards-compatibility option you took and why
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `List-Unsubscribe-Post` header in `digests.ts` turns out to point at a
  different path than the POST route you kept. A mismatch means mail clients
  silently fail to unsubscribe, which is a compliance problem worse than the one
  being fixed. Verify the paths agree before finishing.
- You cannot confirm that mail clients honouring RFC 8058 will reach the POST
  route unauthenticated. They send no cookies; the token must be the only
  credential and it must be accepted from the request body or the query string,
  whichever the header advertises.
- Adding the timestamp changes the token format such that
  `verifyDigestFeedbackToken` (the other token type in the same module) also
  breaks. They share helpers; keep the feedback-verdict token working.
- You are tempted to put the router behind `authMiddleware`. Do not: recipients
  of a digest email are not necessarily logged in, and an unsubscribe that
  requires a login is a compliance problem.

## Maintenance notes

- **The GET fix is the important half.** The TTL reduces the window on a leaked
  or forwarded link; the verb split is what stops an automated scanner from
  disabling a customer's digests with nobody involved.
- **Check the mail-client path after deploy.** Send yourself a digest and use the
  client's native unsubscribe control (the header path), not just the body link.
  The body link now shows a confirmation page; the header path must still work in
  one step.
- **Legacy tokens under option (b)** should get a removal date in a comment.
  Once every digest containing a timestamp-less token has aged out of relevance,
  delete the branch and the grace period with it.
- **The same pattern is worth auditing elsewhere**: any other unauthenticated GET
  in this codebase that writes. This plan fixes the two in this router; a broader
  sweep would be a separate, cheap piece of work.
- A reviewer should check that the confirmation page escapes the token before
  putting it in markup, and that it is `noindex`.
