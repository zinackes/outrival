# Plan 014: Turning off 2FA requires the same step-up as changing a password

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 74888f6..HEAD -- apps/api/src/routes/auth.ts apps/api/src/lib/auth.ts apps/api/src/lib/reauth.ts apps/api/src/index.ts`
> If any changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (touches the auth route mount order; a mistake breaks sign-in)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `74888f6`, 2026-07-25

## Why this matters

This codebase already decided that credential changes need step-up
re-authentication. `POST /api/auth/set-password` and
`POST /api/auth/regenerate-backup-codes` both call `verifyReauthCode`, and the
surrounding comment cites the OWASP guidance directly: re-authenticate before
any credential change, so a hijacked session alone cannot take over the account.

The three operations that most deserve that treatment do not get it:

- **disabling 2FA**
- **enabling 2FA**
- **enrolling a passkey**

They are handled by Better Auth's catch-all `/api/auth/*` route with no extra
gate. Better Auth's `twoFactor` plugin does have a password requirement, but the
plugin is configured with `allowPasswordless: true`, and in this version that
flag routes through a `shouldRequirePassword` helper that returns `false`
whenever the user has no password-backed credential account. Outrival's primary
sign-ins are email OTP and Google, neither of which creates one. So for most
users, the session cookie alone is sufficient.

Sessions last 30 days. The result is that a stolen or hijacked session can turn
MFA off, or enrol an attacker-controlled passkey, silently: persistent access
that survives a later password change, with no notification to the account owner.

This is inconsistent rather than catastrophic. The mechanism to fix it already
exists in this repo and is already used twice.

## Current state

### The step-up mechanism that exists (`apps/api/src/routes/auth.ts:13, 241, 324`)

```ts
import { verifyReauthCode } from "../lib/reauth";
```

```ts
  if (!(await verifyReauthCode(user.id, code))) {
    return c.json(
      errorBody("reauth_failed", "That confirmation code is invalid or expired.", {
```

Used at line 241 (`set-password`) and line 324 (`regenerate-backup-codes`).
`apps/api/src/lib/reauth.ts` is 74 lines: it issues a single-use,
attempt-capped 6-digit code stored in the `verification` table under a
`reauth-<userId>` key, and `POST /api/settings/reauth/send` emails it.

### The plugin configuration (`apps/api/src/lib/auth.ts:146-155`)

```ts
    // Authenticator-app 2FA (TOTP + backup codes). allowPasswordless lets our
    // ... but only flips user.twoFactorEnabled once the user confirms a TOTP code,
    twoFactor({ issuer: "Outrival", allowPasswordless: true }),
    ...
    passkey({ rpName: "Outrival", rpID: passkeyRpId(), origin: WEB_ORIGIN }),
```

### The catch-all that swallows these paths (`apps/api/src/index.ts:77-81`)

```ts
// Custom auth flow routes (patch-19). MUST be registered before Better Auth's
// catch-all below, or the wildcard handler swallows them.
app.route("/api/auth", authRouter);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));
```

**This mount order is the mechanism this plan uses**: `authRouter` is registered
first, so a route defined there shadows the wildcard. That is exactly how
`set-password` already works.

### The client calls (no confirmation step today)

- `apps/web/src/components/outrival/security-settings.tsx:271` calls
  `twoFactorRequest("disable")` with an empty body
- `apps/web/src/components/outrival/security-settings.tsx:639` calls
  `authClient.passkey.addPasskey()` with no code

### The 2FA enforcement hook, and its known gap (`apps/api/src/lib/auth.ts:158-196`)

```ts
  // The twoFactor plugin only intercepts /sign-in/email + /sign-in/username, so
```

```ts
      if (!data || !data.user.twoFactorEnabled) return;
```

A custom `after` hook extends the plugin's partial sign-in to the email-OTP and
OAuth-callback paths. It early-returns when 2FA is not enabled, which makes it
safe by default. **It does not cover passkey sign-in**, which is live in the UI.
Whether a passkey should satisfy MFA is a genuine product decision, not
obviously a bug: see step 5.

### Language rule

`.claude/rules/language.md`: all user-facing copy is English.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| API tests | `cd apps/api && bun test --timeout 60000 test/` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Whole suite | `pnpm test` | exit 0 |

Note: `turbo` is **not** on `PATH`. Use the `pnpm` scripts.

## Scope

**In scope** (the only files you should modify):
- `apps/api/src/routes/auth.ts` (add shadowing routes that require step-up)
- `apps/api/src/lib/reauth.ts` (only if a helper needs extracting; prefer not to)
- `apps/web/src/components/outrival/security-settings.tsx` (confirmation-code step in the dialogs)
- `apps/api/test/auth-step-up.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):
- `apps/api/src/index.ts` mount order. It is already correct and is load-bearing
  for the whole auth surface. Changing it risks breaking sign-in entirely.
- The `after` hook in `apps/api/src/lib/auth.ts:158-196`. Step 5 asks you to make
  a **recorded decision** about passkey sign-in, not necessarily a code change.
- `allowPasswordless: true`. Removing it would break 2FA for every user who signs
  in with email OTP or Google, which is most of them.
- Session length (30 days), the OTP flow, Turnstile, and the rate limiters.
- Passkey **deletion**. Enrolment is the additive risk; deletion is
  self-lockout, a different threat.

## Git workflow

- Branch: `feat/mfa-step-up-reauth` off `main`.
- Commit message style, matching `git log`: `feat(auth): require step-up to disable 2FA`.
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Confirm the gap

```bash
grep -n "verifyReauthCode" apps/api/src/routes/auth.ts
grep -rn "two-factor/disable\|twoFactorRequest\|addPasskey" apps/web/src apps/api/src
```

**Verify**: `verifyReauthCode` appears at the two credential routes only, and the
2FA-disable and passkey-add calls go straight to Better Auth with no code.
If a step-up already guards them, STOP.

### Step 2: Confirm the shadowing mechanism works before relying on it

Before writing the real handlers, prove that a route defined in `authRouter`
takes precedence over the Better Auth wildcard for a path the plugin also
serves. Add a temporary handler for one target path that returns a distinctive
response, hit it, then remove it.

**Verify**: your handler responds, not Better Auth's. If the wildcard wins,
STOP: the whole approach in this plan depends on shadowing, and the fallback
(a middleware scoped to those paths) is a different design.

### Step 3: Add step-up in front of the three operations

In `apps/api/src/routes/auth.ts`, add handlers that shadow the plugin paths for:

- 2FA **disable**
- 2FA **enable**
- passkey **enrolment**

Each handler: require a session, read the confirmation `code` from the body,
call `verifyReauthCode(user.id, code)`, and on success delegate to the
corresponding `auth.api.*` method. On failure, return the same
`errorBody("reauth_failed", ...)` shape used at `auth.ts:241` so the web client's
existing error handling applies unchanged.

Read the exact plugin path names from the Better Auth version installed in
`node_modules` rather than guessing them. A shadow route on a path the plugin
does not use is a no-op that looks like a fix, which is the worst outcome here.

**Verify**: `pnpm typecheck` exits 0, and `cd apps/api && bun test --timeout 60000 test/`
still passes.

### Step 4: Add the confirmation step to the UI

In `security-settings.tsx`, the disable-2FA and add-passkey flows must first
request a code (`POST /api/settings/reauth/send`) and then submit it. Model the
interaction on whatever the existing delete-workspace or set-password flow does,
so the pattern is consistent rather than new.

English copy, matching the product's register.

**Verify**: `pnpm typecheck` exits 0. Note in your report that the browser flow
itself was **not** exercised (a full web build is not runnable on this box), so
it needs manual verification on a deployed environment.

### Step 5: Decide the passkey sign-in question, and record it

The `after` hook does not challenge for TOTP on passkey sign-in. Two defensible
positions:

- **(a)** A passkey is itself a strong second factor, so requiring TOTP on top is
  friction with little gain. If you take this, the **settings copy must change**:
  the current text promises a one-time code on *every* sign-in, which would be
  untrue.
- **(b)** A user who enabled TOTP expects it on every sign-in. If you take this,
  add the passkey verification path to the hook's interception list.

Either way, **write the decision down** in a comment next to the hook, with the
date and the reasoning. The current state is an unrecorded drift from a
documented invariant, and an unrecorded decision would repeat that.

**Verify**: the chosen outcome is implemented, and the comment states which was
chosen and why.

### Step 6: Test it

Create `apps/api/test/auth-step-up.test.ts`. Use the existing harness and its
documented ordering (install mocks, then dynamically import).

Cases:

1. Disabling 2FA **without** a valid code returns an error and leaves
   `user.twoFactorEnabled` true.
2. Disabling 2FA **with** a valid code succeeds.
3. Passkey enrolment without a valid code is refused.
4. A code that was already used once is refused (single-use).

`apps/api/test/admin-middleware.test.ts` is a good 50-line model for a focused
auth test that needs no database.

**Verify**: `cd apps/api && bun test --timeout 60000 test/` passes, whole
directory, to catch a mock leak.

### Step 7: Full-suite check

**Verify**: `pnpm typecheck` exits 0 and `pnpm test` exits 0.

## Test plan

- `apps/api/test/auth-step-up.test.ts` with the four cases above; case 1 is the
  regression this plan exists for.
- Structural pattern: `apps/api/test/admin-middleware.test.ts`.
- **Not covered by automated tests**, state this explicitly in your report: the
  browser-side flows (the TOTP dialog, the WebAuthn prompt) need manual
  verification on a deployed environment with a real device. There is no DOM
  testing layer in this repo and adding one is not in scope.
- Verification: `cd apps/api && bun test --timeout 60000 test/` all pass;
  `pnpm test` exit 0.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c "verifyReauthCode" apps/api/src/routes/auth.ts` returns 5 or more
      (was 2: the two existing routes plus the new handlers)
- [ ] Shadow routes exist for 2FA disable, 2FA enable and passkey enrolment,
      registered on `authRouter` (before the wildcard)
- [ ] A test asserts 2FA cannot be disabled without a valid step-up code
- [ ] A test asserts a step-up code is single-use
- [ ] `cd apps/api && bun test --timeout 60000 test/` exits 0
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0
- [ ] A comment records the passkey-sign-in decision from step 5, with its reasoning
- [ ] If option (a) was taken, the settings copy no longer claims a code on every sign-in
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 2 shows the wildcard wins over `authRouter` for these paths. The approach
  does not work; report it rather than editing the mount order in `index.ts`.
- You cannot determine the exact Better Auth path names for 2FA enable/disable
  and passkey enrolment from the installed package. Guessing produces a shadow
  route that never fires and a fix that is not a fix.
- Any existing test in `apps/api/test/` fails after your change, particularly one
  covering sign-in. Auth is the highest-blast-radius surface in the app.
- The change would require removing `allowPasswordless: true`. It would break 2FA
  for every OTP and Google user. Report the need instead.
- You discover a fourth credential-changing path with no step-up that this plan
  does not list. Report it and include it.

## Maintenance notes

- **This is the highest-risk plan in the set**, because the code it touches sits
  in front of every sign-in. A reviewer should verify sign-in still works by all
  three methods (email OTP, Google, password fallback) on a deployed environment
  before merging, not just that the suite is green.
- **Notify on factor changes.** Even with step-up, the account owner learns
  nothing when a factor is added or removed. A "your two-factor settings changed"
  email is cheap and makes a successful attack visible. Deliberately not in this
  plan's scope; worth doing next.
- **The step-up code is emailed**, so an attacker with mailbox access defeats it.
  That is the accepted design already in use for `set-password`, and this plan
  deliberately matches it rather than inventing a stronger scheme for one surface.
- Any future sign-in method added to this app must be added to the `after` hook,
  or it becomes another silent 2FA bypass. The passkey gap happened exactly that
  way: passkeys shipped after the hook was written.
