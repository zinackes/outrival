# Plan 009: A half-configured AI provider fails loudly instead of pinning a dead model

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 74888f6..HEAD -- packages/ai/src/provider`
> If anything under `packages/ai/src/provider` changed since this plan was
> written, compare the "Current state" excerpt against the live code before
> proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `74888f6`, 2026-07-25
- **External deadline**: Groq discontinues `llama-3.3-70b-versatile` and
  `llama-3.1-8b-instant` on **2026-08-16**. Today is 2026-07-25.

## Why this matters

`loadProviders()` accepts a provider as soon as `AI_PROVIDER_i_ID`,
`_API_KEY` and `_BASE_URL` are present. `_MODEL` is optional, and when it is
missing the provider is silently pinned to the string `"llama-3.3-70b"`.

Groq stops serving that model family on 2026-08-16, three weeks out.

The same file already knows this. Thirteen lines below the defaulting line, the
`GROQ_API_KEY` back-compat path carries a comment citing Groq's deprecation
notice and correctly uses `openai/gpt-oss-120b`. So the modern path is patched
and the fallback default is not: the file contradicts itself.

The failure mode is the expensive part. This exact class of misconfiguration has
already cost a day of production downtime, recorded in a comment in this same
file: on 2026-07-22 the pool loaded two healthy-looking providers and every
priority-1 call returned 404 because the configured model name was one the
provider does not serve. The symptom is not a readable "bad model" error, it is
the **global circuit breaker tripping**, which stops all AI in the product:
classification, signals, digests, battle cards.

Note the boot-time model check (`checkProviderModels`) will not save you here.
It is deliberately non-fatal, and Groq's model listing will keep returning the
llama ids as valid right up until the shutdown date.

## Current state

### The defect (`packages/ai/src/provider/provider-pool.ts:55-74`)

```ts
export function loadProviders(): Provider[] {
  const providers: Provider[] = [];
  for (let i = 1; i <= 10; i++) {
    const id = process.env[`AI_PROVIDER_${i}_ID`]?.trim();
    const apiKey = process.env[`AI_PROVIDER_${i}_API_KEY`]?.trim();
    const baseUrl = process.env[`AI_PROVIDER_${i}_BASE_URL`]?.trim();
    if (!id || !apiKey || !baseUrl) continue;
    const re = process.env[`AI_PROVIDER_${i}_REASONING_EFFORT`]?.trim();
    providers.push({
      id,
      baseUrl,
      apiKey,
      model: process.env[`AI_PROVIDER_${i}_MODEL`]?.trim() || "llama-3.3-70b",
      fastModel: process.env[`AI_PROVIDER_${i}_FAST_MODEL`]?.trim() || undefined,
      tier: process.env[`AI_PROVIDER_${i}_TIER`] === "paid" ? "paid" : "free",
      dailyTokenQuota: Number(process.env[`AI_PROVIDER_${i}_DAILY_TOKEN_QUOTA`] ?? 500000),
      priority: Number(process.env[`AI_PROVIDER_${i}_PRIORITY`] ?? 99),
      reasoningEffort: re === "low" || re === "medium" || re === "high" ? re : undefined,
    });
  }
```

Line 67 is the bug. Note also line 61: a provider is accepted without `_MODEL`.

### The correct pattern, in the same file (`provider-pool.ts:76-93`)

```ts
  if (providers.length === 0) {
    const groqKey = process.env.GROQ_API_KEY?.trim();
    if (groqKey) {
      providers.push({
        id: "groq",
        baseUrl: "https://api.groq.com/openai/v1",
        apiKey: groqKey,
        // Groq discontinues llama-3.1-8b-instant and llama-3.3-70b-versatile on
        // 2026-08-16 for free/developer tiers (ours). These are Groq's own
        // recommended replacements. https://console.groq.com/docs/deprecations
        model: "openai/gpt-oss-120b",
        fastModel: "openai/gpt-oss-20b",
        ...
```

### The recorded incident (`provider-pool.ts:106-109`)

A comment in this file records that on 2026-07-22 the pool loaded two
healthy-looking providers and every priority-1 call 404'd because
`AI_PROVIDER_1_MODEL` named a model Cerebras does not serve, and that it "cost a
day of dead AI". Read it before changing anything; it is the strongest argument
for the loud-failure approach in step 3.

### What the configured models actually are

`packages/ai/src/config.ts:24-28` maps every task to `openai/gpt-oss-120b` or
`openai/gpt-oss-20b`. Per `packages/ai/CLAUDE.md`, `AI_CONFIG.model` is **ignored**
on the pool path; only `tier` selects between the smart and fast model. So the
per-provider `model` / `fastModel` fields are the live values.

### Other llama references, and what to do about each

| Site | Verdict |
|---|---|
| `.env.example` `AI_PROVIDER_3_MODEL=meta-llama/Llama-3.3-70B-Instruct` | Hyperbolic, **not** Groq. Unaffected by the 2026-08-16 date. Leave it; see Maintenance |
| `packages/ai/src/eval/model-eval.ts:50` baseline `llama-3.3-70b-versatile` | Groq. Will 404 after the date. In scope, step 5 |
| `apps/api/src/routes/admin/cost.ts:21,27` default rate labelled llama | Cost mislabelling, not an outage. Out of scope |
| Comments in `apps/workers/src/lib/queues.ts`, `provider-context.ts`, `docs/architecture.md` | Comments only. Out of scope |

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| AI package tests | `cd packages/ai && bun test` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Whole suite | `pnpm test` | exit 0 |

Note: `turbo` is **not** on `PATH`. Use the `pnpm` scripts.

Do **not** run `pnpm --filter @outrival/ai eval:model` or `eval:severity` as part
of this plan: they make real, paid provider calls.

## Scope

**In scope** (the only files you should modify):
- `packages/ai/src/provider/provider-pool.ts` (the defaulting behaviour)
- `packages/ai/src/provider/provider-pool.test.ts` (create or extend)
- `packages/ai/src/eval/model-eval.ts` (step 5, baseline model id)

**Out of scope** (do NOT touch, even though they look related):
- The `GROQ_API_KEY` back-compat block. It is already correct.
- `packages/ai/src/config.ts`. `AI_CONFIG.model` is ignored on the pool path;
  editing it changes nothing and creates a misleading diff.
- `apps/api/src/routes/admin/cost.ts`. Real (the catch-all rate is labelled and
  priced as llama-3.3-70b, roughly 4x the gpt-oss rate) but it is a reporting
  bug, not an outage, and it belongs in its own change.
- `.env.example`'s `AI_PROVIDER_3_*` Hyperbolic block. Different provider,
  unaffected by Groq's date.
- The circuit-breaker and failover logic.

## Git workflow

- Branch: `fix/ai-provider-model-required` off `main`.
- Commit message style, matching `git log`: `fix(ai): stop defaulting to a dead model`.
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Confirm the defect

```bash
grep -n "llama" packages/ai/src/provider/provider-pool.ts
sed -n '100,115p' packages/ai/src/provider/provider-pool.ts
```

**Verify**: line 67 shows the `|| "llama-3.3-70b"` default, line 83-85 shows the
deprecation comment on the back-compat path, and you have read the incident
comment. If line 67 no longer defaults to a llama id, STOP.

### Step 2: Decide the behaviour, then implement it

Two options. **Take option B** unless you find a reason not to, and say which you
took in your report.

- **Option A (minimal)**: change the default to `"openai/gpt-oss-120b"`, matching
  the back-compat path. One-line change. Keeps a half-configured provider
  working, on a model the pool actually uses.
- **Option B (loud, preferred)**: make `_MODEL` required. Add `model` to the
  guard at line 61 so a provider missing it is skipped, and emit one
  `console.warn` naming the skipped index and the missing variable.

Option B is preferred because of the recorded incident: the damage came from a
provider that *looked* configured and silently pointed at an unusable model. A
skipped provider with a named warning is diagnosable in seconds; a wrong default
is not. The pool already degrades gracefully when a provider is absent (it falls
through to the next priority, and finally to the `GROQ_API_KEY` back-compat
path), so skipping is safe.

If you take option B, still change the now-unreachable default string to
`"openai/gpt-oss-120b"` rather than deleting it, so the type stays a plain
`string` and no llama id survives anywhere in the file.

Add a comment in English explaining why, referencing the deprecation, in the same
register as the existing comment at lines 83-85.

**Verify**: `grep -c llama packages/ai/src/provider/provider-pool.ts` returns 1
(the deprecation comment at line 83 only), and `pnpm typecheck` exits 0.

### Step 3: Test it

Create or extend `packages/ai/src/provider/provider-pool.test.ts`. The package
runs bare `bun test`, so a colocated `*.test.ts` is picked up.

Cases:

1. **The regression guard**: with `AI_PROVIDER_1_{ID,API_KEY,BASE_URL}` set and
   `_MODEL` unset, the loaded provider's `model` does **not** match `/llama/i`.
   Under option B, assert instead that no provider is loaded and a warning fires.
2. A fully configured provider is loaded with exactly the `_MODEL` given.
3. Under option B: a provider missing `_MODEL` is skipped, and a later
   contiguous provider that *is* complete still loads (or, if the loop's
   contiguity rule means it stops, assert the actual behaviour and describe it).

Manage `process.env` carefully: set the variables in `beforeEach` and delete them
in `afterEach`, or the values leak into other test files in the same process.
`packages/ai/src/faithfulness/gate.test.ts` already does exactly this
(`delete process.env.FAITHFULNESS_GATE_ENABLED`) — copy its structure.

**Verify**: `cd packages/ai && bun test` passes, including the new cases, and no
other test in the package starts failing.

### Step 4: Sweep for any other live llama default

```bash
grep -rn "llama" packages/ai/src apps/workers/src apps/api/src packages/shared/src
```

**Verify**: every remaining hit is a comment, a test fixture, the Hyperbolic
config, `model-eval.ts` (step 5), or `admin/cost.ts` (out of scope). No live
default resolves to a Groq llama id. List what you found in your report.

### Step 5: Repoint the eval baseline

`packages/ai/src/eval/model-eval.ts:50` uses `llama-3.3-70b-versatile` on Groq as
its comparison baseline. After 2026-08-16 that script 404s, and it is the script
that justifies model choices.

Either repoint the baseline to a Groq model that survives, or drop the baseline
row and compare `gpt-oss-120b` against `gpt-oss-20b`. Add a one-line comment
saying why the old baseline went away.

**Verify**: `pnpm typecheck` exits 0. Do **not** run the eval; it makes real
provider calls.

### Step 6: Full-suite check

**Verify**: `pnpm typecheck` exits 0 and `pnpm test` exits 0.

## Test plan

- New or extended `packages/ai/src/provider/provider-pool.test.ts` covering the
  three cases in step 3, with the specific regression being "no llama id can be
  produced by a partially-configured provider".
- Structural pattern: `packages/ai/src/faithfulness/gate.test.ts`, which reads
  and cleans up `process.env` correctly.
- Do not add a test that calls a real provider.
- Verification: `cd packages/ai && bun test` all pass; `pnpm test` exit 0.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c "llama-3.3-70b\"" packages/ai/src/provider/provider-pool.ts` returns 0
- [ ] `grep -rn "llama" packages/ai/src --include=*.ts | grep -v test | grep -v "^.*://"`
      shows no live default value (comments only)
- [ ] A test asserts a provider without `_MODEL` cannot yield a llama model id
- [ ] `cd packages/ai && bun test` exits 0
- [ ] `packages/ai/src/eval/model-eval.ts` no longer references a Groq llama id
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any currently-deployed environment relies on the llama default. You cannot see
  production env values from here, so if you find evidence that a provider is
  configured without `_MODEL` (for instance in `.env.example`'s documented
  blocks), report it before making the loader skip that provider: option B would
  turn a working provider into a skipped one.
- Making `_MODEL` required causes the pool to load **zero** providers in the test
  environment. That would mean the tests exercise a path that relies on the
  default. Report it; do not relax the guard silently.
- You find a live llama default outside `packages/ai` that this plan does not
  list. Report it and include it.
- You are tempted to run an eval script to validate. Do not; they make paid calls.

## Maintenance notes

- **The Hyperbolic priority-3 floor is still llama** (`AI_PROVIDER_3_MODEL` in
  `.env.example`). That is not a Groq-deadline issue, but it does mean the
  last-resort provider runs a model family the prompts are no longer tuned for.
  `model-eval.ts` itself notes the prompts were tuned for Llama and that gpt-oss
  is a reasoning model. Worth an explicit decision: keep it and say so in a
  comment, or move it to a gpt-oss-compatible model.
- **Deadline**: after 2026-08-16, any Groq llama id 404s. If this plan lands
  after that date, check production AI health first, because the failure will
  already have happened and will present as a tripped global circuit breaker
  rather than a model error.
- The durable guard is the test asserting no llama id can be produced. Keep it
  even after the deadline passes; the same defaulting mistake would recur with
  the next deprecated model.
- A reviewer should confirm the change makes a misconfiguration **louder**, not
  quieter. The failure this prevents was expensive precisely because it was silent.
