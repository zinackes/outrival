# Plan 012: The outbound-webhook guard stops having dead IPv6 branches and follows no redirects

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 74888f6..HEAD -- packages/shared/src/webhook apps/workers/src/lib/webhook.ts packages/shared/src/monitor-url.ts`
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

Users can register a webhook destination (CRM integrations, and the alert
webhook channel). The server then issues POST requests to that URL, so the URL
check is a server-side request forgery boundary.

Three defects in that boundary, all verified:

1. **Every IPv6 branch is dead code.** `new URL(...).hostname` keeps the square
   brackets for an IPv6 literal. Confirmed empirically:
   `new URL("https://[::1]/x").hostname` returns the string `"[::1]"`, and
   `new URL("https://[fd00::1]/x").hostname` returns `"[fd00::1]"`. So
   `host === "::1"` never matches, and `host.startsWith("fd")` never matches.
2. **Redirects are followed without re-checking.** `sendWebhook` calls `fetch`
   with no `redirect` option, so the platform default follows redirects and the
   host check never runs again on the new host.
3. **A second, entirely unguarded sender exists.** `apps/workers/src/lib/webhook.ts`
   posts to `org.webhookUrl` from the alert path with no host validation at all.

Meanwhile this repo already contains two correct implementations of exactly this:
`validatePublicUrl` in `@outrival/shared` (broader deny coverage) and `safeFetch`
in `@outrival/scrapers` (manual redirects, re-validated per hop). The webhook
sender predates or ignores both.

Nothing here is a one-step compromise. It is a defence-in-depth boundary that
currently has holes it was explicitly written to close.

## Current state

### The guard (`packages/shared/src/webhook/sign.ts:15-29`)

```ts
export function isSafeWebhookUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host === "::1") return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (host.startsWith("fc") || host.startsWith("fd")) return false;
  return true;
}
```

Also missing versus `validatePublicUrl`: `.internal`, single-label intranet
names, and the `100.64.0.0/10` CGNAT range.

### The sender (`packages/shared/src/webhook/sign.ts:31-52`)

```ts
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(8000),
    });
```

No `redirect: "manual"`.

### The correct pattern already in the repo (`packages/scrapers/src/lib/guarded-fetch.ts`)

```ts
export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<Response> {
  let target = url;
  for (let hop = 0; ; hop++) {
    const safe = validatePublicUrl(target);
    if (!safe.ok) throw new Error(`safeFetch: unsafe_url (${safe.error})`);
    const res = await fetch(target, {
      method: opts.method,
      headers: opts.headers,
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= MAX_REDIRECTS) throw new Error(`safeFetch: too_many_redirects for ${url}`);
      target = new URL(location, target).toString();
      continue;
    }
    return res;
  }
}
```

Its docstring is honest about the residual gap: no DNS resolution, so DNS
rebinding stays an egress-level concern, documented and out of scope. Keep that
framing.

### The broader validator (`packages/shared/src/monitor-url.ts:103`)

```ts
export function validatePublicUrl(raw: string): MonitorUrlValidation
```

Returns a result object with `ok` and an `error`. It already rejects `.internal`,
single-label hosts and CGNAT.

### The unguarded second sender (`apps/workers/src/lib/webhook.ts`)

Small file, used by `apps/workers/src/core/send-alert.ts` for `org.webhookUrl`.
No host validation, and it embeds the destination's response body into the error
it throws, which puts third-party response content into worker logs.

### Call sites of the guard

```
apps/api/src/routes/crm-destinations.ts:56    (create)
apps/api/src/routes/crm-destinations.ts:101   (patch)
apps/api/src/routes/crm-destinations.ts:152   (test push)
apps/api/src/routes/settings.ts:36-43         (slackWebhookUrl / webhookUrl)
```

### Existing test

`packages/shared/src/webhook/sign.test.ts` already locks the intended semantics.
Extend it; do not rewrite it.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Shared tests | `cd packages/shared && bun test src` | all pass |
| API tests | `cd apps/api && bun test --timeout 60000 test/` | all pass |
| Workers tests | `cd apps/workers && bun test test/` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Whole suite | `pnpm test` | exit 0 |

Note: `turbo` is **not** on `PATH`. Use the `pnpm` scripts.

## Scope

**In scope** (the only files you should modify):
- `packages/shared/src/webhook/sign.ts` (guard + sender)
- `packages/shared/src/webhook/sign.test.ts` (extend)
- `apps/workers/src/lib/webhook.ts` (route through the shared sender, or delete
  it and repoint its caller)
- `apps/workers/src/core/send-alert.ts` (only the import line, if you delete the
  duplicate sender)

**Out of scope** (do NOT touch, even though they look related):
- `packages/shared/src/monitor-url.ts`. Reuse `validatePublicUrl`; do not modify it.
- `packages/scrapers/src/lib/guarded-fetch.ts`. It is the reference pattern.
  `packages/shared` cannot import from `@outrival/scrapers` (the layering rules
  only allow scrapers to depend on shared, not the reverse), so you must write
  the equivalent loop in `sign.ts` rather than importing `safeFetch`.
- The four call sites of `isSafeWebhookUrl`. If you keep the function's name and
  boolean signature they need no change.
- The HMAC signing logic in the same file.
- DNS resolution / DNS-rebinding defence. Explicitly out of scope, matching the
  documented position in `guarded-fetch.ts`.

## Git workflow

- Branch: `fix/webhook-ssrf-guard` off `main`.
- Commit message style, matching `git log`: `fix(shared): close the webhook SSRF holes`.
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Reproduce the IPv6 defect

```bash
node -e 'const u=new URL("https://[::1]/x");console.log(JSON.stringify(u.hostname));
const v=new URL("https://[fd00::1]/x");console.log(JSON.stringify(v.hostname), v.hostname.toLowerCase().startsWith("fd"));'
```

**Verify**: prints `"[::1]"` and `"[fd00::1]" false`. That is the bug: the
bracketed form defeats both the equality check and the prefix check.

### Step 2: Write the failing tests first

Extend `packages/shared/src/webhook/sign.test.ts` with cases that fail today:

- `https://[::1]/hook` is rejected
- `https://[fd00::1]/hook` is rejected (unique-local)
- `https://[::ffff:127.0.0.1]/hook` is rejected (IPv4-mapped IPv6)
- `https://foo.internal/hook` is rejected
- `https://100.64.0.1/hook` is rejected (CGNAT)
- `https://intranet/hook` is rejected (single-label host)
- a normal public `https://hooks.example.com/x` is still **accepted** (guard
  against over-blocking)

**Verify**: `cd packages/shared && bun test src` now **fails** on the new cases.
That failure is the proof the fix is needed. Record which ones failed.

### Step 3: Delegate the guard to `validatePublicUrl`

Rewrite `isSafeWebhookUrl` to keep its name and boolean signature (so the four
call sites are untouched) but delegate:

- reject anything that is not `https:` (keep this: it is stricter than
  `validatePublicUrl` and correct for outbound webhooks)
- otherwise return `validatePublicUrl(raw).ok`

Keep a short English comment explaining why https is enforced here specifically
and why the host checks are delegated rather than duplicated: the local copy had
three dead IPv6 branches precisely because it was a second implementation.

**Verify**: `cd packages/shared && bun test src` passes, including every new case
and every pre-existing one.

### Step 4: Stop following redirects blindly

Change `sendWebhook` to use `redirect: "manual"` and loop, re-running the guard
on each hop, capped at a small maximum. Mirror the structure of `safeFetch`
(quoted above) rather than inventing a different one.

Preserve the existing behaviour that matters: the 8-second timeout, the
`X-Outrival-Signature` header, and returning `false` rather than throwing on
failure (the current implementation catches and returns `false`, and callers
depend on that).

**Verify**: `cd packages/shared && bun test src` passes; `pnpm typecheck` exits 0.

### Step 5: Remove the unguarded second sender

`apps/workers/src/lib/webhook.ts` posts to a user-supplied URL with no guard.
Prefer deleting it and repointing `apps/workers/src/core/send-alert.ts` at the
shared `sendWebhook`.

Before doing so, compare the two: if the worker version has behaviour the shared
one lacks (a different timeout, a different retry posture, a different return
contract), note it and preserve it rather than silently changing alert delivery.

Also fix the error-message leak: do not embed the destination's response body in
the thrown error. Include the status code, not the body.

**Verify**: `cd apps/workers && bun test test/` passes, and
`grep -rn "workers/src/lib/webhook" apps/workers/src` returns no stale imports.

### Step 6: Full-suite check

**Verify**: `pnpm typecheck` exits 0 and `pnpm test` exits 0.

## Test plan

- Extend `packages/shared/src/webhook/sign.test.ts` with the seven cases in
  step 2. The IPv6 ones are the regression: they pass wrongly today.
- Add a redirect test if the existing file already stubs `fetch`; assert that a
  3xx to a private host is not followed. If stubbing `fetch` there would require
  `mock.module`, skip it: Bun's `mock.module` is process-global and this package
  has 18 test files that would inherit the stub. Note the gap in your report.
- Structural pattern: the existing `sign.test.ts` in the same directory.
- Verification: `cd packages/shared && bun test src` all pass;
  `cd apps/workers && bun test test/` all pass; `pnpm test` exit 0.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c '"::1"' packages/shared/src/webhook/sign.ts` returns 0
- [ ] `grep -c 'startsWith("fc")' packages/shared/src/webhook/sign.ts` returns 0
- [ ] `grep -c 'validatePublicUrl' packages/shared/src/webhook/sign.ts` returns at least 1
- [ ] `grep -c 'redirect: "manual"' packages/shared/src/webhook/sign.ts` returns 1
- [ ] The seven new test cases exist and pass
- [ ] `apps/workers/src/lib/webhook.ts` is deleted, or routes through the guarded
      shared sender
- [ ] No webhook sender embeds a destination response body in an error
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 2's new tests **pass** before you change anything. The guard was already
  fixed; this plan's premise is void.
- Delegating to `validatePublicUrl` starts rejecting a URL shape the existing
  tests accept. That is a real behaviour change for existing customer webhook
  destinations. Report exactly which shape, before proceeding: a stricter guard
  that silently disables a paying customer's live integration is not an
  improvement you get to make unilaterally.
- You find that `packages/shared` cannot import `validatePublicUrl` because of a
  circular import between `monitor-url.ts` and the webhook module. Report the
  cycle rather than copying the checks a third time.
- `apps/workers/src/lib/webhook.ts` turns out to have deliberately different
  semantics (for example, it must not throw so an alert failure never fails the
  job). Preserve that and say so; do not change alert-delivery behaviour as a
  side effect of a security fix.

## Maintenance notes

- **One guard, one sender, from here on.** The reason three IPv6 branches were
  dead is that the check was written a second time instead of reused. If a third
  outbound-request path appears, it should call the shared sender, not
  reimplement the checks.
- **DNS rebinding remains open**, by design and consistently with
  `guarded-fetch.ts`'s documented position: the host is validated, not resolved,
  so a hostname that resolves to a private address still passes. Closing it
  belongs at the egress network layer, not here. Do not let a future reviewer
  believe this plan closed it.
- **A stricter guard can break live integrations.** After deploy, watch for CRM
  destinations that stop delivering. The four call sites validate on write, so
  destinations saved under the old, looser guard were never re-checked.
- A reviewer should confirm the `https:`-only check survived. It is stricter than
  `validatePublicUrl` and is the right call for outbound webhooks carrying a
  signature header.
