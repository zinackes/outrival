# Battle-card accuracy — grounding the competitive claims

Status: **Phase 1 implemented** (typecheck green). Phases 2–3 scoped, pending a
tier decision.

## The problem

Battle cards assert **false competitive claims**. Reported example: a Supabase-vs-Neon
card said *"Neon's differentiator is database branching"* — ignoring that Supabase
also ships branching. The claim is wrong in **both** directions:

- "Branching is Neon's differentiator" is stale — Supabase shipped Branching 2.0 in
  July 2025, so branching differentiates no one.
- The naive correction ("they both have it, it's a wash") is *also* wrong — the
  features differ: **Neon** = copy-on-write branching that clones data in <1s +
  scale-to-zero serverless; **Supabase** = schema/migration branching that
  *deliberately excludes production data* + a full BaaS stack (auth/storage/realtime/
  edge). Only current docs/pricing produce the correct nuance.
  Sources: [Bytebase](https://www.bytebase.com/blog/neon-vs-supabase/),
  [Supabase branching docs](https://supabase.com/docs/guides/deployment/branching),
  [Branching 2.0](https://supabase.com/blog/branching-2-0).

### Root cause (code)

We ask the model for a **comparison** but feed it almost no facts to compare, so it
fills the gaps from stale parametric memory. Before Phase 1 the card received only:
`myProduct` = category + a one-line value prop; `competitor` = a 2–3 sentence AI
summary + free-trial; reviews; 8 signals. **No real features, pricing, tech stack, or
homepage text for either side.** Comparative slots (`their_strengths` / `our_strengths`
/ `their_weaknesses`) had zero source material → invention.

Five compounding mechanisms let the false claim through:

1. The grounding `sourceText` (`battle-card.ts`) held nothing comparative — a
   "our edge vs them" claim had no possible source to cite.
2. Grounding **informs, never blocks** (`grounded-call.ts`) — an uncited assertion is
   kept as-is.
3. Grounding validation is **skipped when `citations = []`** (→ `PASSED_GROUNDING`) —
   a card that cites nothing "passes" trivially.
4. The competitor summary is itself **ungrounded** (`GROUNDING_POLICY.summarize_competitor
   = { grounding: false }`) and can already seed a false "fact" the card inherits.
5. The systematic self-check (patch-24) **only flags / lowers confidence — it never
   removes or corrects** the false claim.

Plus: the prompt said *"their_strengths: their real advantages (max 5)"* — an implicit
instruction to fill all 5 slots, i.e. to guess for volume.

## What the industry does (2026)

No credible CI platform (Klue, Crayon, Kompyte, IndustryLens) lets an LLM write
competitive claims from its own head. They converge on
**extract → cite → score → gate → freshness**: extract verified signals first, cite
each claim to a source, score confidence, gate behind a publish/human step, stamp a
"last verified" date. "AI-powered" is table stakes; *provenance* is the differentiator.
([Klue Fact-Impact-Act](https://klue.com/blog/fact-impact-act-the-battlecard-framework-you-need-to-be-using),
[Crayon best practices](https://www.crayon.co/blog/battlecard-best-practices),
[IndustryLens battlecards](https://industry-lens.com/features/battlecards))

### Why it matters beyond UX

Comparative claims about a **named competitor** are high-liability. The Lanham Act
(15 U.S.C. §1125(a)) lets a *competitor* sue for false/misleading advertising — strict
liability, and even literally-true-but-misleading claims (e.g. implying Supabase lacks
branching) are actionable. Price/superiority comparisons are the highest-risk category.
The defensible form is **specific + sourced + current** — the same thing that's hard to
hallucinate. ([Bona Law](https://www.bonalaw.com/insights/legal-resources/do-i-have-a-lanham-act-claim-against-my-competitor-for-false-advertising))

## The fix — turn the generator from an author into a synthesizer

### Phase 1 — grounded synthesis (DONE, tier-independent)

Rebuild the evidence bundle so the card synthesizes over **real, captured facts for
both sides**, and constrain the model to abstain rather than invent.

Files:

- `apps/workers/src/lib/analytics.ts` — new best-effort reads `getLatestPricingTiers`
  (latest price per plan+period) and `getLatestReviewScore` (rating + sub-scores +
  clustered complaint themes).
- `packages/ai/src/tasks/battle-card.ts` — `BattleCardInput` now carries, for **both**
  products: features, tech stack, pricing tiers, homepage excerpt (+ competitor review
  scores/themes). The prompt gained a hard `<rules>` block:
  - **Evidence-only** — base every statement on the blocks above; treat your own memory
    as unreliable/stale.
  - **Comparative claims require both sides** — never call something an advantage /
    weakness / differentiator unless the evidence covers that dimension for *both*
    products. (This directly kills the Neon/Supabase failure.)
  - **Abstain** — an empty section is the correct answer when evidence is thin; never
    pad to the max.
  - **Be specific** — cite the actual plan/price/feature/tech/complaint.
  The `sourceText` now carries both sides' facts, so a cited comparative claim can
  actually trace back to it.
- `apps/workers/src/jobs/generate-battle-card.job.ts` — gathers the new evidence
  (competitor pricing/tech/reviews + both homepages via a `loadHomepageExcerpt` helper
  reusing the snapshot→R2→`htmlToText` pattern; self features/tech/pricing from the
  self profile).
- Empty sections now render an honest *"Not enough verified data yet."* instead of a
  bare dash (`battle-card-html.ts` PDF + `battle-card-tab.tsx` web).

Phase 1 alone would have prevented the reported error: with no evidence that Supabase
lacks branching, the comparative guardrail forbids asserting Neon's branching as a
differentiator → the model abstains or states it as a plain fact.

### Phase 2 — verification that removes claims + confidence/freshness (DONE)

**2A — verification pass with teeth.** The self-check (`run-self-check.ts`) only
judged. New `reviseBattleCard` (`packages/ai/src/tasks/battle-card.ts`) re-reads the
draft against the SAME evidence bundle and returns a cleaned card that keeps only
traceable claims (Chain-of-Verification): it **deletes** unsupported claims and
one-sided comparatives instead of flagging them. Wired into the job after generation
(`generate-battle-card.job.ts`), best-effort (a parse miss / rate-limit keeps the
grounded draft), logged to `ai_runs` as `battle_card_revise`. The block builders +
`sourceText` were factored into shared helpers so generation, grounding, and revise
reason over byte-identical evidence.

**2B — confidence + freshness (provenance strip).** The `GET /:id/battle-card` route
returns an `evidence` object (`battle-cards.ts` → `battleCardEvidence`): the card-level
confidence (latest `ai_quality_checks` row for the card) + per source
(pricing/reviews/tech stack/homepage) whether it was captured and its `last verified`
date (`max(recorded_at)`/`scraped_at`, `AT TIME ZONE 'UTC'`). All read-time,
best-effort, **no migration**. The web tab renders a provenance strip under the header
(`BattleCardProvenance` in `battle-card-tab.tsx`): a confidence chip + a dot per
source with its freshness or "not tracked".

The 6 card sections are strategic (strengths/objections/win-lose), not 1:1 with a data
source, so provenance is shown **card-level** (what fed it, how fresh) rather than
faking a per-section score — the honest, Klue/IndustryLens-style surface.

### Phase 3 — live web verification (OPT-IN)

Verify comparative claims against the *current* competitor pages/docs at generation
time (Perplexity Sonar is already in the stack via AI Visibility, `PERPLEXITY_API_KEY`).
This is what lets the card make a *correct positive* nuanced claim (the real
branching difference), not just abstain. Adds external cost + latency per card.

## Ranked lever summary

| Lever | Impact | Effort | Phase |
|---|---|---|---|
| Feed real structured facts for both sides | Highest | Low-med | 1 ✅ |
| Comparative-claim guardrail (both sides) | High (kills the bug class) | Low | 1 ✅ |
| Abstain on missing evidence | High | Low | 1 ✅ |
| Verification pass that *drops* unsupported claims | High | Med | 2A ✅ |
| Confidence + freshness stamps (provenance strip) | Med (trust) | Med | 2B ✅ |
| Live web verification (Perplexity/fetch) | High (correct positives) | Med-high | 3 |
