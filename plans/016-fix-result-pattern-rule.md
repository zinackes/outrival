# Plan 016: Make the documented error-handling rule match the code (retire or scope the `Result<T,E>` mandate)

> **Executor instructions**: Follow this plan step by step. If anything in "STOP
> conditions" occurs, stop and report. When done, update this plan's row in
> `plans/README.md` unless a reviewer maintains the index. This plan edits a **rules
> doc** — no source code, no behavior change.
>
> **Drift check (run first)**: `git diff --stat 81c4b75..HEAD -- .claude/rules/typescript.md apps/api/CLAUDE.md`
> If either changed, re-read before editing.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs / tech-debt
- **Planned at**: commit `81c4b75`, 2026-07-07

## Why this matters

`.claude/rules/typescript.md` mandates *"Pattern `Result<T, E>` pour les fonctions qui
peuvent échouer … Pas de throw dans les fonctions métier"* — but the codebase does the
opposite. Only **3 files** import `ok()`/`err()`, while the service/lib layers use ~20
`throw new` sites, and the HTTP boundary uses a *third* convention (`{ data, error }` /
`c.json({ error })`, per `apps/api/CLAUDE.md`). A mandated pattern with 3 users, contradicted
by ~93% of the code, actively misleads any new code or agent that reads the rule. A stale
rule is worse than no rule. This plan makes the rule describe what the team actually does.

## Current state

- **The rule** — `.claude/rules/typescript.md` (Gestion d'erreurs section, ~line 27):
  ```
  ## Gestion d'erreurs
  - Pattern Result<T, E> pour les fonctions qui peuvent échouer
  - Pas de throw dans les fonctions métier — retourner { ok: false, error }
  - throw uniquement dans les cas vraiment exceptionnels (config manquante au startup)
  - Logger les erreurs avec le contexte : logger.error({ err, context })
  ```
- **The type exists** — `packages/shared/src/types/result.ts`:
  ```ts
  export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };
  export function ok<T>(value: T): Result<T, never> { return { ok: true, value }; }
  export function err<E>(error: E): Result<never, E> { return { ok: false, error }; }
  ```
- **Actual adoption**: `ok`/`err` imported by ~3 files only (e.g.
  `apps/api/src/lib/extract-document.ts`, `apps/api/src/lib/github.ts`, plus a test). The
  service/lib layers have ~20 `throw new` sites. The HTTP edge uses `{ data, error }` /
  `c.json({ error })` (`apps/api/CLAUDE.md`: *"Réponses : toujours { data, error } — jamais
  de throw naked"*), implemented at ~256 `c.json({ error })` sites.
- So there are **three** conventions: `Result<T,E>` (mandated, ~unused), `throw` (actual
  internal practice), `{ data, error }` (HTTP boundary).

## The decision this plan encodes

The team has, in practice, converged on: **`throw` internally, `{ data, error }` at the Hono
boundary.** `Result<T,E>` is used only in a couple of leaf helpers where a typed failure is
locally convenient. Rewrite the rule to describe that reality, keeping `Result<T,E>` as an
*allowed local option*, not a mandate. (If the operator would rather commit to `Result<T,E>`
everywhere, that's a large refactor — out of scope here; see STOP.)

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Confirm adoption counts | `grep -rln "\bok(\|\berr(" apps packages --include=*.ts \| grep -v node_modules \| grep -v test` | ~3 files |
| No source touched | `git status` | only `.claude/rules/typescript.md` changed |

## Scope

**In scope**:
- `.claude/rules/typescript.md` (rewrite the Gestion d'erreurs section)

**Out of scope**:
- Any `.ts`/`.tsx` file — no code migration in either direction.
- `packages/shared/src/types/result.ts` — keep it (still used by a few helpers).
- `apps/api/CLAUDE.md` — its `{ data, error }` boundary rule is accurate; leave it (optionally
  add a one-line cross-reference, but do not change its meaning).

## Git workflow

- Branch: `advisor/016-fix-result-rule`
- One commit, conventional: `docs: align error-handling rule with actual conventions`.
- Do NOT push unless instructed.

## Steps

### Step 1: Rewrite the Gestion d'erreurs section

Replace the mandate with an accurate description of the two-layer convention. Target content
(French, matching the file's language):
```
## Gestion d'erreurs
- Couche métier / lib : `throw` en cas d'échec (Trigger.dev gère les retries des jobs ;
  les handlers Hono catchent au niveau route). Ne pas swallow silencieusement une erreur.
- Frontière HTTP (routes Hono) : réponse `{ data, error }` — jamais de throw naked qui
  remonte au client (cf. apps/api/CLAUDE.md). Codes d'erreur structurés pour le gating.
- `Result<T, E>` (packages/shared/src/types/result.ts) : OPTION locale autorisée pour un
  helper feuille où un échec typé est plus lisible qu'un throw (ex: extract-document.ts,
  github.ts). Pas une obligation transverse.
- Logger avec le contexte : `logger.error({ err, context })`.
```
Adjust wording to fit the file's style; the load-bearing change is: `Result<T,E>` becomes an
allowed local option, not a mandate, and `throw` + `{ data, error }` are documented as the
real conventions.

**Verify**: `git status` shows only `.claude/rules/typescript.md` changed.

### Step 2: Sanity-check the adoption claim

Run the grep in "Commands you will need" and confirm `Result` (`ok`/`err`) is indeed used by
only a handful of files, so the rewritten rule matches reality. If adoption is actually much
wider than ~3 files (drift since this plan was written), STOP and reconsider the framing.

**Verify**: the grep returns roughly the expected small set.

## Test plan

- Docs only — no automated test. Verification is the grep (adoption is small) plus a
  read-through that the rewritten rule is internally consistent and doesn't contradict
  `apps/api/CLAUDE.md`.

## Done criteria

ALL must hold:

- [ ] `.claude/rules/typescript.md` no longer mandates `Result<T,E>` / "pas de throw"; it
      describes throw-internally + `{ data, error }`-at-boundary, with `Result` as an option
- [ ] The rewritten rule does not contradict `apps/api/CLAUDE.md`'s `{ data, error }` rule
- [ ] `git status` shows only the one rules file changed (no source)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- The adoption grep shows `Result<T,E>` is actually widely used (the code changed since this
  plan) — the premise is wrong; report and let the operator choose the direction.
- The operator's intent (from any note in the repo) is to standardize ON `Result<T,E>` — that
  is a code migration, not a doc fix; report and do not rewrite the rule to the opposite.

## Maintenance notes

- If the team later decides to adopt `Result<T,E>` broadly, that's a dedicated refactor plan
  (touching the ~20 `throw` sites) — this doc fix does not preclude it, it just stops the
  rule from lying in the meantime.
- Reviewer should confirm no source file was changed and that the two error conventions
  (`throw` internal, `{ data, error }` boundary) are now documented consistently across
  `typescript.md` and `apps/api/CLAUDE.md`.
