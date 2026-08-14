# Faithfulness gate — measurement, decision, rollout

Plan 017's deliverable. Written 2026-08-14, executed on branch `veracite-p4`
(Véracité Intelligence v2, phase 5).

**Decision: enable, scoped to battle cards and weekly digests. Leave
`critical` / `high` signal insights ungated until the false-block rate has been
observed in production on the two low-frequency surfaces first.**

---

## 1. What was measured

`pnpm --filter @outrival/ai eval:faithfulness` — the labelled set in
`packages/ai/src/eval/faithfulness-eval.ts`, 7 inventions that must be rejected
and 7 legitimate paraphrases that must be kept. It calls the real judge
(`judgeClaim`, SMART tier) against the pool the box is configured for.

**Run of 2026-08-14, verbatim:**

```
Inventions (must be REJECTED):
[ai] provider pool loaded (2): cerebras[free,p1] https://api.cerebras.ai/v1 model=gpt-oss-120b | groq[free,p2] https://api.groq.com/openai/v1 model=openai/gpt-oss-120b
  ok    invented certification
  ok    invented number
  ok    claim built on absent data
  ok    unsupported one-sided comparison
  ok    wrong tier attribution
  ok    negative claim on a dimension the source never mentions
  ok    invented roadmap date

Paraphrases (must be ACCEPTED):
  ok    restated price
  ok    summarised trial
  ok    two passages combined
  ok    generalised complaint
  ok    rating restated
  ok    negation entailed by a recorded positive
  ok    explicitly recorded negative restated

--- faithfulness judge ---
inventions rejected : 7/7 (100%)  gate 100%
paraphrases kept    : 7/7 (100%)  gate >= 80%

PASSED
```

- **Date**: 2026-08-14
- **Model**: `gpt-oss-120b` (SMART tier — `AI_CONFIG.classification`)
- **Provider**: pool of two, `cerebras` p1 then `groq` p2, both free tier. Groq
  served the run (the log line above records the pool as loaded, not which
  member answered each call; the rate-limit errors below all came from Groq).
- **Sample size**: 7 inventions, 7 paraphrases. Single-sample judge, one call
  per case.
- **Where it ran**: the WSL2 dev box, against dev provider keys. **Not the
  production pool.** A judge measured on one pool says nothing about another,
  which is the same reason `judge-claim.ts` carries its fast-tier warning.

This is better than the ~80% paraphrase retention recorded in
`docs/architecture.md:1227-1229`. The plan's STOP condition ("materially worse
than ~80%") is not met.

### 1.1 What had to be worked around, and why it matters

The eval as committed **could not complete on this box**. Two transport
failures, both from Groq's free tier:

- `429 ... on tokens per minute (TPM): Limit 8000` — killed the first attempt at
  case 12 of 14.
- `400 json_validate_failed` with an empty `failed_generation` — killed the
  second attempt at case 1, and hit once more mid-run on the third.

The measurement above was produced by running the **same case list, same judge,
same pass criteria** from a scratch copy that (a) paces calls 9 s apart and
(b) retries a case up to 4 times on a transport error. Neither changes what is
being measured. No repository file was modified to obtain it.

That detour is itself a finding, and it belongs in the decision:

- **On the failure path the chain is unchanged in production.** Both errors are
  raised by `complete()` inside `judgeClaim`, and `verify.ts:102-113` catches
  them into `status: "unverified"`, which counts as supported. The eval script
  has no such catch — that is a property of the script, not of the gate.
- **But a pool that answers 3 calls in 25 with a transport error also produces
  reports where several claims were never actually judged.** Those reports pass.
  The gate is therefore only as strong as the pool's availability, and its
  weakness is silent — it publishes.

If the production pool behaves like this box, a meaningful share of gated
outputs will publish on a partially-judged report. That is the intended
fail-open posture, and the reason the enablement below is scoped rather than
global.

## 2. What a block does, per output type

### Weekly digest — `apps/workers/src/core/generate-weekly-digest.ts:357-506`

The gate runs on the **model's** digest object only, before the sectoral trends
and watched questions are appended (those are copied verbatim from
already-formulated text, not grounded on this week's signals).

On `blocked`:

- the digest row **is** stored (`content`, `faithfulness`) — it is also this
  org's idempotency marker for the week, so skipping the write would re-run the
  generation on the next tick;
- `sent_at` stays null → **no email leaves**;
- a `blockedReviewEntry` lands in `ai_quality_checks` with
  `flaggedForHumanReview: true` and the refused claims;
- `logger.warn("Digest email withheld by the faithfulness gate", …)`;
- the org is counted in `skipped` and the loop continues to the next org.

A reviewer clearing the flag can still send it from the digests UI. Nothing is
lost, the send is deferred.

### Battle card — `apps/workers/src/core/generate-battle-card.ts:700-782`

On `blocked`, the card is **not written** and the previous card survives
untouched. There is one repair attempt in between:

1. the refused claim texts are handed to `reviseBattleCard` (a pass that already
   existed);
2. the repaired card is **re-verified**;
3. it publishes only on `verdict === "pass"` — deliberately strict here, a
   `skipped` recheck does **not** publish. This is the single place in the
   system where an unavailable verification withholds instead of publishing,
   because the content was already refused once;
4. if the repair is unavailable or its recheck is not a clean pass, the job
   throws `NonRetriable` → the run completes without retry, the card is not
   overwritten, and the block sits in the review queue.

The blocked report reaches `ai_quality_checks` **either way** — whether the
judge was right about those claims is a question the repair does not answer.

### Signal insight, `critical` / `high` — `apps/workers/src/core/generate-signal.ts:472-676`

**Out of scope for this enablement** (see §4), documented because the wiring
exists and a future decision will use it.

On `blocked`: the signal row **is** inserted and stays readable in-app
(idempotency by `changeId` is load-bearing, and a reviewer must be able to read
what was stopped). What is withheld is the outward publication:
`dispatchedChannel = in_app_only`, `filteredReason = faithfulness_blocked`, no
alert email, no Slack, no first-signal celebration email. The digest generator
and `/digests` both exclude `faithfulness_blocked` signals from the next digest
(`generate-weekly-digest.ts:215`, `apps/api/src/routes/digests.ts:141`), so a
blocked insight is not re-published through the back door.

### Everything else

Not gated at all: `medium` / `low` insights (cost), Ask (already grounded
two-pass), and every non-AI output.

## 3. Every path that fails OPEN

This list is the risk mitigation. All of it is existing, tested behaviour.

| Path | `file:line` | Result |
|---|---|---|
| Gate not enabled for this task | `apps/workers/src/lib/faithfulness-gate.ts:60` | returns `null` → publish, zero AI cost |
| Claim extraction threw | `packages/ai/src/faithfulness/verify.ts:71-78` | `skipped` → publish |
| Claim extraction parse miss | `packages/ai/src/faithfulness/verify.ts:80` | `skipped` → publish |
| Judge threw (rate limit, breaker, 4xx) | `packages/ai/src/faithfulness/verify.ts:102-113` | claim `unverified`, counted supported |
| Judge returned unparseable JSON | `packages/ai/src/faithfulness/judge-claim.ts:87-90` | `null` → claim `unverified` |
| More than 12 undecided claims | `packages/ai/src/faithfulness/verify.ts:93-95` | the rest `unverified`, counted supported |
| `skipped` verdict at the gate | `packages/ai/src/faithfulness/gate.ts:79` | **never blocks**, by tested invariant |
| No claims extracted at all | `packages/ai/src/faithfulness/verify.ts:122-123` | ratio 1 → publish |

The one **fail-closed** exception is the battle-card repair recheck
(`generate-battle-card.ts:752`), described above.

`packages/ai/src/faithfulness/gate.test.ts`, `verify.test.ts`,
`score-claims.test.ts` and `judge-claim.test.ts` pin these: a parse miss, an
unavailable judge, a thrown judge and a disabled gate all publish. They are the
evidence that enabling cannot cause a total outage.

## 4. Blast radius

**Production volumes were not obtainable during this spike** (the shared-DB read
was refused by the local tool policy). The estimate is therefore a rate, per the
plan's instruction not to invent volumes. They were obtained afterwards and they
change the picture: read §8 before acting on this section.

- **Measured false-block rate on the labelled set: 0/7.**
- With n = 7 and zero observed failures, the rule of three puts the 95%
  upper bound at roughly **3/7 ≈ 35%**. The measurement rules out a *bad* judge;
  it does not establish a *good* one to within a few percent.
- Restated for an operator: at the measured rate, no output is withheld in
  error. At the upper bound the measurement cannot exclude, up to one gated
  output in three would be.

That gap is the whole argument for scoping. A withheld **digest** is one email a
week per org, recoverable from the digests UI, and visible in the review queue.
A withheld **battle card** leaves the previous card serving. A withheld
**critical alert** is the one case where the cost of a false block is paid
immediately and cannot be recovered by anyone noticing later — so it stays out
until the first two have produced real numbers.

Each gated output costs one FAST extraction call plus at most 12 SMART judge
calls, wrapped in a single `ai_runs` row (`task = faithfulness_check`).

## 5. `FAITHFULNESS_MIN_RATIO` — measured, deliberately unchanged

Left at its default of `0.9`.

Not because 0.9 is the calibrated value, but because **the threshold is inert by
construction today** and no measurement can move it. `verify.ts:122` computes
`ratio = (total - unfaithful) / total`, and `decideGate` blocks on
`unfaithfulClaims.length > 0` first. So:

- zero unfaithful claims ⇒ ratio is exactly 1 ⇒ the threshold is never reached;
- one or more ⇒ the unfaithful branch already blocked.

The comment on `decideGate` says as much. The ratio remains the stored, auditable number;
the threshold only becomes live if the counting rules change (for example if
`unverified` stopped counting as supported). Changing it now would be a change
with no observable effect, which is worse than leaving it alone.

## 6. Rollout

**Scope**: `battle_card` and `digest`. Both are low-frequency, both leave the
previous state serving, both are visible in `/admin/ai-review-queue`.

**How**: `FAITHFULNESS_GATE_TASKS=battle_card,digest` on the **worker** service
(the gate only ever runs in `apps/workers`). See `docs/architecture/env.md`.

**Precedence** (implemented and tested in `gate.test.ts`): a non-blank task list
wins over `FAITHFULNESS_GATE_ENABLED`, in both directions. It enables a task the
old boolean leaves off, and it keeps every unlisted task off even where the old
boolean is `"true"` — which is what keeps `signal_insight` ungated on a worker
that already had the boolean on. `.env.example` ships the boolean as `false` in
every environment, so the reverse rule would have made the list unusable without
a second unrelated edit. An unrecognised name gates nothing: a typo fails
towards publishing, never towards blocking critical alerts.

**Order**: staging first if it exists at the time; otherwise production directly,
which is defensible here only because the rollback is one variable and the
blocked outputs are recoverable.

**What to watch**: `/admin/ai-review-queue`, entries whose `faithfulness.verdict`
is `blocked`. Each one is either a hallucination the gate caught (the feature
working) or a false block (the failure this doc exists to bound). The queue's
own triage — "confirmed hallucination" vs "false positive" — is the measurement.

**For how long**: two full weekly-digest cycles (14 days), so at least two
digest generations per org and a representative sample of battle cards.

**Numeric rollback threshold**: roll back if **more than 20% of blocked outputs
are triaged as false positives**, or if **more than 3 battle cards in a week end
in a hard block** (repair failed and the card was not written). Either number
means the judge is refusing work the evidence supports, and the withheld output
is worth more than the hallucination avoided.

**Rollback**: unset `FAITHFULNESS_GATE_TASKS` (and leave
`FAITHFULNESS_GATE_ENABLED` at `false`), then restart the worker. Both checks
are strict string comparisons in `packages/ai/src/faithfulness/gate.ts` — no
data migration, no code change, no backfill. Rows already written keep their
`faithfulness` report; nothing reads it to decide anything once the flag is
gone. This asymmetry is the single most reassuring fact about the decision.

## 7. Residual risk

- **Single-sample judge.** `verify.ts:16-20` notes SelfCheckGPT-style
  multi-sampling as the option if variance proves to be the problem. It
  multiplies judge calls by N, so it stays out until the observed false-block
  rate justifies it.
- **The eval set is 14 hand-labelled cases.** It is a regression net for the
  judge prompt, not a population estimate. The production review queue is the
  only thing that will produce one.
- **Pool availability is a silent input.** As measured in §1.1, transport
  failures make claims `unverified`, which publish. A degraded pool weakens the
  gate without any signal that it did. If §6's watch shows near-zero blocks, the
  first hypothesis should be pool health, not a clean corpus.
- **The repository default is untouched.** `FAITHFULNESS_GATE_ENABLED=false`
  stays in `.env.example`. A deployed environment could differ, and this spike
  can only see repository defaults — check the worker's real environment before
  concluding the gate has never run. **That check was run: see §8. The worker
  says `true`.**

## 8. What production was actually doing (checked 2026-08-14)

The worker's real environment carries **`FAITHFULNESS_GATE_ENABLED=true`**
(`docker inspect outrival-worker-light`). The gate is not being enabled by this
work. It has been live since **2026-07-22**, on all three surfaces, for 24 days.

`ai_quality_checks` on production, rows where `faithfulness` is not null:

| verdict | n |
|---|---|
| pass | 224 |
| **blocked** | **54** |
| skipped | 7 |

Blocked, by surface (and the pass count for the same surface):

| surface | blocked | passed | block rate |
|---|---|---|---|
| `generate_signal` (critical/high insights) | **37** | 96 | 28% |
| `generate_digest` | 11 | 110 | 9% |
| `generate_battle_card` | 6 | 18 | 25% |

**Triage: 53 of the 54 were never reviewed.** The single one that was is recorded
as `false_positive`. So the production false-block rate this document asked for
still does not exist, but the queue it was supposed to come from has been filling
for three weeks with nobody emptying it.

Three consequences, and they invert parts of this document:

1. **The scoped enablement is a narrowing, not an activation.** Setting
   `FAITHFULNESS_GATE_TASKS=battle_card,digest` turns `signal_insight` **off**,
   because the list wins over the boolean in both directions (§6). It restores
   outward publication for critical and high alerts, which is the opposite of the
   risk §4 was written to avoid.
2. **37 critical/high alerts were withheld from email and Slack** over those 24
   days. They stayed readable in-app with `filteredReason = faithfulness_blocked`,
   which is the designed behaviour, but nobody chose it deliberately and nobody
   triaged it.
3. **The deployed code can already read the list.** Correcting what this
   document said an hour earlier: the worker deploy is not manual.
   `.github/workflows/deploy.yml` builds and pushes `outrival-worker:latest` on
   every push to `main` whose diff can reach the image, then pulls and restarts
   both workers over SSH in `/opt/outrival`. Run `31835870463` did exactly that
   at 20:00Z on `a0af0503`, which contains the `#501` squash commit, so the
   running image carries `FAITHFULNESS_GATE_TASKS`. Setting the variable is the
   only step left.

`skipped` at 7 of 285 (2.5%) is the one reassuring number: the pool answered
almost every time, so the §1.1 worry about a silently degraded gate did not
materialise at this volume.

## 9. What the blocks are made of (checked 2026-08-14, same evening)

The counts above move: rows are written per target and a regenerated target
overwrites its verdict. A second readout two hours later reads 286 rows, **57
blocked** (40 signals, 11 digests, 6 battle cards), 222 pass, 7 skipped, and
3 triaged instead of 1 — all three `false_positive`. Use it as a snapshot, not
as a ledger.

Every blocked row stores the claims the judge refused, so the block reasons can
be read without triaging by hand. 57 blocked rows carry **120 refused claims**,
and they are not the same kind of claim on each surface.

**Signals — 40 blocked, 88 refused claims.** Attributing each refused claim to
the field it came from, by word overlap against the three published fields:

| field of origin | refused claims |
|---|---|
| `so_what` | 47 |
| `recommended_action` | 24 |
| `insight` | 8 |
| unattributed | 9 |

**32 of the 40 blocked signals contain no refused claim traceable to the
insight.** The cause is `apps/workers/src/core/generate-signal.ts:488`: the
verified output is `{insight, so_what, recommended_action}` and the source is
the competitor's diff. `so_what` states an implication for *our* product;
`recommended_action` is advice to us. Neither can appear in a competitor's diff,
so the judge refuses them as unsupported. Verbatim, two of them:

> This shift could erode the perceived uniqueness of our AI-assisted product
> development tool.

> Develop a targeted marketing campaign that emphasizes our AI's focus on
> software product lifecycle acceleration, not hardware piloting.

The judge is answering the question it was given correctly. The question is
wrong: it asks a diff to support a recommendation.

**Digests — 11 blocked, 24 refused claims.** The same advisory claims, plus a
second structural family: statements about the digest itself, and statements of
absence. "The urgency assigned to the insight is watch." "No direct threat was
identified for Diffly." "No direct feature changes or pricing moves were
observed." A week of diffs cannot support an absence, so the judge refuses it.

**Battle cards — 6 blocked, 8 refused claims.** All of them factual and about
the competitor: "Linear offers Business and Basic plans priced at $16 and $10
per month respectively for small teams." "Hugging Face offers a free tier with
no monthly cost." Whether each verdict is right still needs triage, but this is
the surface where the gate refuses the kind of claim it was built to refuse.

The consequence for §6: **the per-surface block rates in §8 are not comparable
to each other.** 28% on signals measures how much advice a signal contains, not
how often it invents. It is a stronger reason to keep `signal_insight` out of
`FAITHFULNESS_GATE_TASKS` than the caution §6 was written with, and it is also
the reason the 20% false-positive rollback threshold cannot be applied to
signals as they are: the measurement is invalid before it is unfavourable.

The fix is not to loosen the judge. It is to submit only the layer that can be
grounded, and that is a change on the call sites, never on `gate.ts`.

**For signals it is done here.** `groundableSignalLayer`
(`apps/workers/src/lib/faithfulness-gate.ts`) submits the insight alone, and
three tests pin the rule: the wide output blocks on the advice, the narrow one
publishes on the same diff, and an invented fact in the insight still blocks.
The narrowing also stops paying two smart-tier judge calls per signal to rule on
sentences no diff can settle.

**Digests still have the fault.** Their check submits the whole digest object,
urgency fields and "nothing happened" lines included, and `digest` is in the
task list about to be set. That call site is the next one to narrow — it needs a
decision about which digest fields are factual, which is why it is not bundled
here.
