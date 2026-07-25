# Plan 008: The card-update dialog stops telling customers to set an env var

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 74888f6..HEAD -- apps/web/Dockerfile`
> If it changed since this plan was written, compare the "Current state" excerpt
> against the live file before proceeding; on a mismatch, treat it as a STOP
> condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `74888f6`, 2026-07-25

## Why this matters

`NEXT_PUBLIC_*` variables are inlined into the client bundle at build time. In a
Docker build they only reach `next build` if the Dockerfile declares a matching
`ARG`. Values passed with `--build-arg` for an undeclared name are ignored, with
at most a warning.

`apps/web/Dockerfile` declares six `NEXT_PUBLIC_*` args. The application source
reads fourteen. Three of the gap are handled separately and correctly (the
`NEXT_PUBLIC_BUILD_*` trio is derived from `GIT_SHA` / `SOURCE_COMMIT` /
`BUILD_TIME`). That leaves five that are inlined as `undefined` in every
production build.

The one that bites a paying customer:

```
apps/web/src/components/outrival/payment-method-dialog.tsx:99
    Payments aren’t configured. Set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.
```

A Business customer opening "update payment method" is shown a developer-facing
instruction to set an environment variable, and cannot update their card. The
component guards on the key (`:23`, `:29`), so this is not a crash; it is a
dead feature with a leaked internal message.

Second: `NEXT_PUBLIC_SENTRY_DSN` is read by `apps/web/src/instrumentation-client.ts:4`.
Undefined means **client-side error monitoring is off in production**, so browser
errors in the dashboard are invisible while server-side Sentry looks healthy.

`.claude/rules/production.md:29` already states the rule this violates:
"`NEXT_PUBLIC_*` = build-time → passés en build args Docker (pas runtime)".

## Current state

### `apps/web/Dockerfile` declares six, plus the build trio (lines 19-28 and 43-46)

```dockerfile
ENV NODE_ENV=production
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_ONBOARDING_PARALLEL_DISCOVERY
ARG NEXT_PUBLIC_ONBOARDING_DISCOVERY_DEBOUNCE_MS
ARG SENTRY_AUTH_TOKEN
ARG SENTRY_ORG
ARG SENTRY_PROJECT_WEB
...
ARG SOURCE_COMMIT=
ARG GIT_SHA=
ARG BUILD_TIME=
ENV NEXT_PUBLIC_BUILD_SHA=$GIT_SHA NEXT_PUBLIC_BUILD_COMMIT=$SOURCE_COMMIT NEXT_PUBLIC_BUILD_TIME=$BUILD_TIME
```

### The source reads fourteen

```bash
grep -rho "NEXT_PUBLIC_[A-Z_]*" apps/web/src | sort -u
```

```
NEXT_PUBLIC_AI_HALLUCINATION_ALERT_RATE
NEXT_PUBLIC_API_URL                       (declared)
NEXT_PUBLIC_BUILD_COMMIT                  (via SOURCE_COMMIT)
NEXT_PUBLIC_BUILD_SHA                     (via GIT_SHA)
NEXT_PUBLIC_BUILD_TIME                    (via BUILD_TIME)
NEXT_PUBLIC_CONFIDENCE_DOT_THRESHOLD
NEXT_PUBLIC_ONBOARDING_DISCOVERY_DEBOUNCE_MS  (declared)
NEXT_PUBLIC_ONBOARDING_PARALLEL_DISCOVERY     (declared)
NEXT_PUBLIC_PASSKEYS_ENABLED
NEXT_PUBLIC_POSTHOG_HOST                  (declared)
NEXT_PUBLIC_POSTHOG_KEY                   (declared)
NEXT_PUBLIC_SENTRY_DSN
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
NEXT_PUBLIC_TURNSTILE_SITE_KEY            (declared)
```

### The five undeclared, and what each does

| Variable | Read at | Consequence of `undefined` |
|---|---|---|
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `components/outrival/payment-method-dialog.tsx:23` | Card update dead; internal message shown to customer (`:99`) |
| `NEXT_PUBLIC_SENTRY_DSN` | `instrumentation-client.ts:4` | Client-side error monitoring silently off |
| `NEXT_PUBLIC_PASSKEYS_ENABLED` | `components/outrival/security-settings.tsx`, `app/(auth)/auth/auth-form.tsx` | Passkey UI hidden. **This is by design** — see below |
| `NEXT_PUBLIC_AI_HALLUCINATION_ALERT_RATE` | admin surface | Falls back to a default threshold |
| `NEXT_PUBLIC_CONFIDENCE_DOT_THRESHOLD` | admin surface | Falls back to a default threshold |

**`NEXT_PUBLIC_PASSKEYS_ENABLED` is deliberately dark.** Passkeys ship behind an
off-by-default flag pending validation on staging with a real device. Declaring
the `ARG` is correct (so it *can* be switched on), but do not set a default that
turns it on, and do not treat its absence as a defect.

### The Stripe guard (`apps/web/src/components/outrival/payment-method-dialog.tsx:23-30, 92-99`)

```ts
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

let stripePromise: Promise<Stripe | null> | null = null;
function getStripePromise(): Promise<Stripe | null> | null {
  if (!PUBLISHABLE_KEY) return null;
```

```tsx
        {!PUBLISHABLE_KEY ? (
          <p className="text-sm text-destructive">
            Payments aren’t configured. Set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.
          </p>
```

### Language rule

`.claude/rules/language.md`: all user-facing copy is English. The replacement
message in step 4 must be English and must not name an environment variable.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Whole suite | `pnpm test` | exit 0 |
| Grep declared args | `grep -c "^ARG NEXT_PUBLIC" apps/web/Dockerfile` | 11 after this plan |

**Do NOT run `pnpm build` or `next build` locally.** A full web build exhausts
the RAM on this WSL2 dev box. Typecheck is the local gate. The build is verified
in the deployment environment, not here.

## Scope

**In scope** (the only files you should modify):
- `apps/web/Dockerfile` (add the five `ARG` lines)
- `apps/web/src/components/outrival/payment-method-dialog.tsx` (message only, step 4)
- `.env.example` (document any of the five that is missing, step 5)

**Out of scope** (do NOT touch, even though they look related):
- The Coolify build-argument configuration. It lives outside this repository.
  This plan makes the Dockerfile *able* to receive the values; someone with
  access must set them. Say so explicitly in your report — the code change alone
  does not fix production.
- `.github/workflows/deploy.yml`. It builds `Dockerfile.worker` (the workers),
  not the web image.
- Adding an `apps/web/src/env.ts` validator. Worth doing (it would turn a missing
  public var into a failed build instead of a broken bundle) but it can fail a
  deploy that currently limps, so it needs its own decision.
- Turning on `NEXT_PUBLIC_PASSKEYS_ENABLED`.
- `turbo.json` `globalEnv`. Related (build-arg values are not in the cache key)
  but a separate change.

## Git workflow

- Branch: `fix/web-next-public-build-args` off `main`.
- Commit message style, matching `git log`: `fix(web): pass the missing public env vars`.
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Confirm the gap

```bash
grep -n "^ARG NEXT_PUBLIC" apps/web/Dockerfile
grep -rho "NEXT_PUBLIC_[A-Z_]*" apps/web/src | sort -u
```

**Verify**: six `ARG NEXT_PUBLIC` lines, fourteen distinct variables in source.
If the Dockerfile already declares eleven, STOP.

### Step 2: Declare the five missing args

Add them next to the existing `ARG NEXT_PUBLIC_*` block, in the same builder
stage, **before** the `next build` invocation. Order them to match the existing
grouping and add a short English comment for the two that have a production
consequence:

```dockerfile
# Client-side Stripe. Without it the card-update dialog renders a
# "not configured" state instead of the Payment Element.
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
# Client-side Sentry. Without it browser errors are never reported.
ARG NEXT_PUBLIC_SENTRY_DSN
# Off by default: passkey UI stays hidden until validated on a real device.
ARG NEXT_PUBLIC_PASSKEYS_ENABLED
ARG NEXT_PUBLIC_AI_HALLUCINATION_ALERT_RATE
ARG NEXT_PUBLIC_CONFIDENCE_DOT_THRESHOLD
```

Do not give any of them a default value. An empty `ARG` keeps today's behaviour
when the deploy environment does not supply one; a default would silently bake a
wrong value into the image.

**Verify**: `grep -c "^ARG NEXT_PUBLIC" apps/web/Dockerfile` returns 11.

### Step 3: Check whether an explicit `ENV` line is needed

Some Next.js setups need the value promoted from `ARG` to `ENV` for
`next build` to see it. Look at how the existing six are handled in this
Dockerfile: if they rely on `ARG` alone and are known to work in production
(`NEXT_PUBLIC_API_URL` demonstrably does, since the deployed app talks to the
API), then `ARG` alone is sufficient here and you should match that pattern.

If the existing six are promoted with an `ENV` line, add the five to it the
same way.

**Verify**: your five are handled identically to the working six. State in your
report which pattern the file uses.

### Step 4: Replace the leaked internal message

In `payment-method-dialog.tsx:97-100`, replace the customer-facing string so it
no longer names an environment variable. It should tell the customer what to do,
not tell an engineer what to configure. Something in the register of the rest of
the product, for example:

```tsx
            Card updates are temporarily unavailable. Contact support and we’ll
            update your payment method for you.
```

Keep the `text-sm text-destructive` styling and the surrounding conditional
untouched. Keep it English.

**Verify**: `grep -c "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY" apps/web/src/components/outrival/payment-method-dialog.tsx`
returns 1 (the `process.env` read at line 23 only, not the message).

### Step 5: Document the vars

Check each of the five against `.env.example`:

```bash
for v in NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY NEXT_PUBLIC_SENTRY_DSN \
         NEXT_PUBLIC_PASSKEYS_ENABLED NEXT_PUBLIC_AI_HALLUCINATION_ALERT_RATE \
         NEXT_PUBLIC_CONFIDENCE_DOT_THRESHOLD; do
  printf '%s: ' "$v"; grep -c "^$v" .env.example
done
```

Add any that return 0, with a one-line English comment saying it is build-time
and must be passed as a Docker build arg.

**Verify**: all five return at least 1.

### Step 6: Typecheck

**Verify**: `pnpm typecheck` exits 0 and `pnpm test` exits 0.

## Test plan

There is no unit test for a Dockerfile `ARG`, and the real verification (a built
image containing the value) cannot run on this machine.

What you can and must verify:

- the grep-based done criteria below
- `pnpm typecheck` and `pnpm test` stay green after the message change

The behavioural verification belongs to whoever deploys: after the next web
deploy with the build args set, open the card-update dialog as a subscribed
account and confirm the Payment Element renders, and confirm a deliberate client
error appears in Sentry. Write that as an explicit hand-off note in your report.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c "^ARG NEXT_PUBLIC" apps/web/Dockerfile` returns 11
- [ ] Each of the five names appears exactly once as an `ARG` in the Dockerfile
- [ ] The five are declared in the same build stage as, and no later than, the
      existing six relative to `next build`
- [ ] No `ARG NEXT_PUBLIC_*` line has a default value
- [ ] `grep -c "Set NEXT_PUBLIC" apps/web/src` returns 0
- [ ] All five appear in `.env.example`
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] Your report states plainly that Coolify build arguments must be set for
      this to take effect in production
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The Dockerfile turns out to use a multi-stage layout where the `NEXT_PUBLIC_*`
  args are consumed in a stage other than the one running `next build`. Report
  the stage structure; placing an `ARG` in the wrong stage looks correct and does
  nothing.
- You cannot determine whether the existing six work via `ARG` alone or need an
  `ENV` promotion. Report what you see rather than guessing, since guessing wrong
  reproduces the exact bug this plan fixes.
- You are tempted to give `NEXT_PUBLIC_PASSKEYS_ENABLED` a default of `true`.
  Do not. It is dark on purpose pending device validation.
- You are tempted to run `pnpm build` to verify. Do not; it will exhaust the RAM
  on this box. If you believe a build is the only way to verify, say so and stop.

## Maintenance notes

- **The code change alone does not fix production.** The Dockerfile can now
  receive these values; the deployment environment must actually pass them. The
  hand-off is: set the five build arguments in Coolify for the `web` service,
  then redeploy. Without that, the bundle still inlines `undefined`.
- **A fourteenth `NEXT_PUBLIC_*` will hit this again.** The durable fix is an
  `apps/web/src/env.ts` that fails the build when a required public var is
  missing, mirroring `apps/api/src/env.ts` and `apps/workers/src/env.ts`. It is
  out of scope here because it can fail a deploy that currently limps, which is a
  deliberate decision someone should make on purpose.
- **`turbo.json` has no `globalEnv`**, so two web builds with different
  `NEXT_PUBLIC_*` values currently share a cache key. Once these args are actually
  supplied, that becomes a real hazard: a cached build could be reused across
  differing values. Worth revisiting alongside the `globalDependencies` change.
- A reviewer should check the Sentry one specifically. `SENTRY_AUTH_TOKEN`,
  `SENTRY_ORG` and `SENTRY_PROJECT_WEB` are already declared (they are used for
  source-map upload at build time), which makes it easy to assume client Sentry
  was wired. It is not: the DSN is what the browser SDK needs.
