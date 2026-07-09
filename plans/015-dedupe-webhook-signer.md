# Plan 015: Move the HMAC webhook signer/sender into `@outrival/shared` so it isn't maintained in two copies

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result. If anything in "STOP conditions" occurs,
> stop and report. When done, update this plan's row in `plans/README.md` unless a
> reviewer maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat 81c4b75..HEAD -- apps/api/src/lib/crm-webhook.ts apps/workers/src/lib/crm-webhook.ts`
> If either changed, compare against "Current state" before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `81c4b75`, 2026-07-07

## Why this matters

The outbound-webhook HMAC signer and sender are hand-copied into two files because
`apps/workers` can't import `apps/api`. They already share the exact same signature scheme
(`sha256=<hmac>`) and header/UA logic. Security-relevant signing code maintained as two
divergent copies is a classic drift hazard: change the signature format or a header on one
side and outbound CRM webhooks silently break or fail verification. Both layers may import
`@outrival/shared` (per the monorepo rules), so this belongs there once.

## Current state

**`apps/api/src/lib/crm-webhook.ts`** (full):
```ts
import crypto from "node:crypto";
export function signBody(secret: string, body: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}
export function isSafeWebhookUrl(raw: string): boolean { /* https-only + private-range block */ }
export async function sendWebhook(url, secret, payload): Promise<boolean> {
  const body = JSON.stringify(payload);
  const headers = { "Content-Type": "application/json", "User-Agent": "Outrival-Webhook/1" };
  if (secret) headers["X-Outrival-Signature"] = signBody(secret, body);
  try { const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(8000) }); return res.ok; }
  catch { return false; }
}
```

**`apps/workers/src/lib/crm-webhook.ts`** (full):
```ts
import crypto from "node:crypto";
// "Mirror of apps/api/src/lib/crm-webhook.ts — apps/workers can't import @outrival/api…"
export function signBody(secret: string, body: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}
export async function pushWebhook(url, secret, payload): Promise<boolean> {
  // identical body to sendWebhook above, named pushWebhook
}
```

Differences to preserve:
- The API copy also has `isSafeWebhookUrl` (an SSRF guard used by the destinations test
  endpoint). The workers copy does not.
- The sender is named `sendWebhook` in api and `pushWebhook` in workers — same body.

Monorepo import rules (`.claude/rules/monorepo.md`): `web → shared`; `api → db/ai/shared/queue`;
`workers → db/ai/scrapers/shared/queue`; `scrapers → shared`. So `@outrival/shared` is
importable from both api and workers. `@outrival/shared` is a TS package built with
`tsc --noEmit` (type-only build) — Node built-ins like `node:crypto` are available at
runtime in both consumers (Bun/Node).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `pnpm typecheck` | exit 0 |
| Shared tests | `pnpm --filter @outrival/shared test` | pass (incl. a new signer test) |
| API tests | `pnpm --filter @outrival/api test` | pass |
| Workers tests | `pnpm --filter @outrival/workers test` | pass |
| Full suite | `pnpm test` | exit 0 |

(Requires plan 005 so `@outrival/shared` has a `test` script; if 005 hasn't landed, run the
shared test file directly with `cd packages/shared && bun test src/webhook`.)

## Scope

**In scope**:
- `packages/shared/src/webhook/sign.ts` (create — the canonical signer + sender + SSRF guard)
- `packages/shared/src/webhook/sign.test.ts` (create)
- `packages/shared/src/index.ts` (or the package's barrel — export the new module)
- `apps/api/src/lib/crm-webhook.ts` (re-export from shared, or delete + update importers)
- `apps/workers/src/lib/crm-webhook.ts` (re-export from shared, or delete + update importers)

**Out of scope**:
- The routes/jobs that call these (`crm-destinations.ts`, `crm-webhook` senders) — only
  change their import path if you delete the local files; do not change their logic.
- Any behavior change to the signature scheme or headers — this is a pure relocation.

## Git workflow

- Branch: `advisor/015-dedupe-webhook-signer`
- One commit, conventional: `refactor(shared): single-source the webhook HMAC signer`.
- Do NOT push unless instructed.

## Steps

### Step 1: Create the canonical module in shared

Create `packages/shared/src/webhook/sign.ts` with `signBody`, `isSafeWebhookUrl`, and a
single sender. Name the sender `sendWebhook` (the api name) and have workers alias it. Copy
the bodies verbatim from the api copy (it's the superset — it has `isSafeWebhookUrl`):
```ts
import crypto from "node:crypto";
export function signBody(secret: string, body: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}
export function isSafeWebhookUrl(raw: string): boolean { /* verbatim from api copy */ }
export async function sendWebhook(url: string, secret: string | null, payload: unknown): Promise<boolean> {
  /* verbatim from api copy */
}
```
Export it from the package barrel (`packages/shared/src/index.ts` — match how other modules
are re-exported there).

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Point both app copies at shared

Two acceptable approaches — prefer (a) for the smallest blast radius:
- (a) **Thin re-export**: make each `crm-webhook.ts` re-export from shared, preserving the
  local names callers already use:
  - `apps/api/src/lib/crm-webhook.ts`: `export { signBody, isSafeWebhookUrl, sendWebhook } from "@outrival/shared";`
  - `apps/workers/src/lib/crm-webhook.ts`: `export { signBody, sendWebhook as pushWebhook } from "@outrival/shared";`
- (b) **Delete + update importers**: remove both files and repoint every importer to
  `@outrival/shared` (more churn; only do this if a re-export causes a name/type problem).

**Verify**: `pnpm typecheck` → exit 0. `grep -rn 'createHmac' apps/api/src/lib/crm-webhook.ts apps/workers/src/lib/crm-webhook.ts` → no matches (the HMAC now lives only in shared).

### Step 3: Test the signer in shared

Create `packages/shared/src/webhook/sign.test.ts`. Cover:
- `signBody(secret, body)` returns `sha256=<hex>` and is deterministic for fixed inputs
  (assert against a known-good HMAC computed inline in the test with `node:crypto`).
- `isSafeWebhookUrl` accepts an https public URL and rejects `http://`, `localhost`,
  `127.0.0.1`, `10.x`, `192.168.x`, `169.254.x`, and `172.16–31.x`.
Model after an existing `packages/shared/src/**/*.test.ts`.

**Verify**: `pnpm --filter @outrival/shared test` (or `cd packages/shared && bun test src/webhook`) → all pass.

## Test plan

- New `packages/shared/src/webhook/sign.test.ts` (Step 3) locks the signature format and the
  SSRF-guard host rules — the exact things that would silently diverge across two copies.
- Existing api/workers suites must stay green (behavior unchanged, only the source moved).
- Verification: `pnpm test` → exit 0.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `crypto.createHmac` appears in exactly one place under `packages/shared/src/webhook/`
      and no longer in either app's `crm-webhook.ts` (grep)
- [ ] `packages/shared/src/webhook/sign.test.ts` exists and passes
- [ ] `pnpm --filter @outrival/api test` and `pnpm --filter @outrival/workers test` pass
- [ ] Callers still compile with unchanged names (`signBody`/`sendWebhook`/`pushWebhook`)
- [ ] Only in-scope files changed (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- `@outrival/shared` cannot import `node:crypto` in its build/runtime for some reason
  (unexpected — both consumers run on Bun/Node) — report rather than vendoring a JS SHA.
- The workers copy's `pushWebhook` has a subtle difference from `sendWebhook` you didn't
  expect (e.g. a different header or timeout) — report the diff; do not silently unify a
  real behavioral difference.
- A re-export breaks a type import (some caller imports a type, not just the functions) —
  fall back to approach (b) and report.

## Maintenance notes

- Any future change to the signature scheme or webhook headers now happens once, in shared;
  update the CRM-destinations docs (`docs/distribution-team.md`) to point at the shared
  module if it references the old two-copy note.
- Reviewer should confirm the signature output is byte-identical before/after (the test
  pins it) so existing destination verifiers keep validating.
