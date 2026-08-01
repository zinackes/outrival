import { z } from "zod";
import { AI_CONFIG } from "../config";
import { complete } from "../provider";
import { safeParseJson } from "../lib/parse";
import { groundedAiCall } from "../grounding/grounded-call";
import { attachQuality, type WithQuality } from "../grounding/types";

export const BattleCardSchema = z.object({
  their_strengths: z.array(z.string()).max(5),
  our_strengths: z.array(z.string()).max(5),
  their_weaknesses: z.array(z.string()).max(5),
  common_objections: z
    .array(
      z.object({
        objection: z.string(),
        response: z.string(),
      }),
    )
    .max(5),
  when_we_win: z.array(z.string()).max(4),
  when_we_lose: z.array(z.string()).max(4),
});

export type BattleCardContent = z.infer<typeof BattleCardSchema>;

// One pricing tier as captured on a product (from pricing_history / the self
// profile). Fed to the card so pricing comparisons are grounded in real numbers.
export interface BattleCardPricingTier {
  planName: string;
  price: number;
  currency: string;
  billingPeriod: string;
}

export interface BattleCardInput {
  // The user's own product — now carries its REAL captured facts (features, tech
  // stack, pricing, homepage excerpt), not just a one-line value prop, so the card
  // can compare like-for-like instead of inventing "our" advantages.
  myProduct: {
    name?: string;
    category: string;
    valueProp: string;
    audience?: string | null;
    features?: string[];
    techStack?: string[];
    pricingTiers?: BattleCardPricingTier[];
    homepageExcerpt?: string | null;
  };
  competitorName: string;
  competitorSummary: string | null;
  // Real, current material about the competitor — the single biggest lever against
  // stale parametric claims. All optional / best-effort: a section is simply omitted
  // from the evidence (and the model must abstain on it) when we haven't captured it.
  competitorHomepageExcerpt?: string | null;
  // patch-33 — the competitor's detected free-trial offer (acquisition lever to
  // compare against). null when unknown / no pricing captured yet.
  competitorTrial?: {
    hasTrial: boolean;
    days: number | null;
    requiresCreditCard: boolean | null;
  } | null;
  competitorPricingTiers?: BattleCardPricingTier[];
  competitorTechStack?: Array<{ name: string; category: string; importance: string }>;
  competitorReviews?: {
    score: number | null;
    reviewCount: number | null;
    subScores?: {
      easeOfUse: number | null;
      support: number | null;
      features: number | null;
      value: number | null;
    } | null;
    complaintThemes?: Array<{ theme: string; prevalence: string }> | null;
  } | null;
  /**
   * Who the competitor publishes as its customers (Content Intelligence v2 P3):
   * the markets its case studies are set in, and the names it lists in public.
   * Read from their own pages, so a claim built on it is traceable to something
   * they wrote. null when we hold no customer proof for them.
   */
  competitorCustomers?: {
    verticals: Array<{ label: string; count: number }>;
    /** Names as they wrote them, most recently first seen first. */
    names: string[];
    storiesTotal: number;
    customersTotal: number;
  } | null;
  reviewComplaints: string[];
  reviewPraises: string[];
  recentSignals: Array<{ category: string; severity: string; insight: string }>;
  // patch-28 — names of the org's OTHER products (multi-SKU). When present, the card
  // is told to stay focused on `myProduct` only, to avoid cross-contamination.
  otherProductNames?: string[];
}

// Absent evidence is OMITTED (null), never rendered as a placeholder: the old
// "Not captured." / "n/a" / "unknown" filler reached the model, which converted
// OUR data gaps into competitor weaknesses ("customer reviews and ratings are
// not captured") — and the revise pass kept them because the claim was
// technically traceable to the evidence text (2026-07-10 audit, Iceline card).
function bullets(items: string[] | undefined): string | null {
  return items && items.length ? items.map((i) => `- ${i}`).join("\n") : null;
}

function pricingBlock(tiers: BattleCardPricingTier[] | undefined): string | null {
  if (!tiers || !tiers.length) return null;
  return tiers
    .map((t) => `- ${t.planName}: ${t.price} ${t.currency} / ${t.billingPeriod}`)
    .join("\n");
}

interface EvidenceBlocks {
  signalsBlock: string | null;
  praisesBlock: string | null;
  complaintsBlock: string | null;
  trialBlock: string | null;
  competitorTechBlock: string | null;
  reviewScoreBlock: string | null;
  customersBlock: string | null;
  myHomepage: string | null;
  competitorHomepage: string | null;
  focusNote: string;
}

// Compute every evidence block ONCE, so the generation prompt, the grounding
// sourceText, and the revise pass all reason over byte-identical evidence.
// Exported for tests (the no-placeholder guarantee below is load-bearing).
export function computeBlocks(input: BattleCardInput): EvidenceBlocks {
  const signalsBlock = input.recentSignals.length
    ? input.recentSignals
        .slice(0, 8)
        .map((s) => `- [${s.severity}] ${s.category} — ${s.insight}`)
        .join("\n")
    : null;

  const praisesBlock = bullets(input.reviewPraises?.slice(0, 8));
  const complaintsBlock = bullets(input.reviewComplaints?.slice(0, 8));

  // Free-trial line: a concrete acquisition comparison the rep can lean on.
  // "none offered" is a real captured fact (detection ran and found no trial);
  // an unknown state is omitted like every other absent dimension.
  const trialBlock = (() => {
    const t = input.competitorTrial;
    if (!t) return null;
    if (!t.hasTrial) return "Free trial: none offered.";
    const bits = [
      t.days != null ? `${t.days}-day` : "duration unstated",
      t.requiresCreditCard === false
        ? "no credit card required"
        : t.requiresCreditCard === true
          ? "credit card required up front"
          : null,
    ].filter(Boolean);
    return `Free trial: yes (${bits.join(", ")}).`;
  })();

  const competitorTechBlock = input.competitorTechStack?.length
    ? input.competitorTechStack
        .slice(0, 20)
        .map((t) => `- ${t.name} (${t.category}, ${t.importance})`)
        .join("\n")
    : null;

  const reviewScoreBlock = (() => {
    const r = input.competitorReviews;
    if (!r) return null;
    const parts: string[] = [];
    if (r.score != null)
      parts.push(
        `Overall rating: ${r.score}${r.reviewCount != null ? ` (${r.reviewCount} reviews)` : ""}`,
      );
    const subs = r.subScores;
    if (subs) {
      const s = [
        subs.easeOfUse != null ? `ease of use ${subs.easeOfUse}/5` : null,
        subs.support != null ? `support ${subs.support}/5` : null,
        subs.features != null ? `features ${subs.features}/5` : null,
        subs.value != null ? `value ${subs.value}/5` : null,
      ].filter(Boolean);
      if (s.length) parts.push(`Sub-scores: ${s.join(", ")}`);
    }
    if (r.complaintThemes?.length)
      parts.push(
        `Recurring complaint themes: ${r.complaintThemes
          .map((c) => `${c.theme} (${c.prevalence})`)
          .join(", ")}`,
      );
    return parts.length ? parts.join("\n") : null;
  })();

  // Their published customer proof. Counts travel with the lists: a vertical
  // distribution over three stories is a fact about three stories, and a block that
  // hid its n would let the model write "they dominate fintech" off one case study.
  const customersBlock = (() => {
    const c = input.competitorCustomers;
    if (!c || (c.customersTotal === 0 && c.storiesTotal === 0)) return null;
    const parts: string[] = [];
    if (c.verticals.length > 0) {
      parts.push(
        `Markets their ${c.storiesTotal} published case ${
          c.storiesTotal === 1 ? "study is" : "studies are"
        } set in: ${c.verticals.map((v) => `${v.label} (${v.count})`).join(", ")}`,
      );
    }
    if (c.names.length > 0) {
      parts.push(
        `Customers they name in public (${c.customersTotal} in total): ${c.names
          .slice(0, 12)
          .join(", ")}`,
      );
    }
    return parts.length ? parts.join("\n") : null;
  })();

  const myHomepage = input.myProduct.homepageExcerpt?.trim()
    ? input.myProduct.homepageExcerpt.trim().slice(0, 3500)
    : null;
  const competitorHomepage = input.competitorHomepageExcerpt?.trim()
    ? input.competitorHomepageExcerpt.trim().slice(0, 3500)
    : null;

  // Multi-SKU focus guard: keep the card about THIS product, not the org's others.
  const focusNote =
    input.otherProductNames && input.otherProductNames.length > 0
      ? `\nNote: the same organization also sells other products (${input.otherProductNames.join(
          ", ",
        )}). This battle card is about ${
          input.myProduct.name ?? "our product"
        } ONLY — do not describe or reference the other products.`
      : "";

  return {
    signalsBlock,
    praisesBlock,
    complaintsBlock,
    trialBlock,
    competitorTechBlock,
    reviewScoreBlock,
    customersBlock,
    myHomepage,
    competitorHomepage,
    focusNote,
  };
}

// The evidence, rendered as two symmetric product blocks. Shared by the prompt and
// (verbatim) by the grounding sourceText + the revise pass, so a claim can only
// survive if it traces to text every stage saw. Absent dimensions are omitted
// entirely — the model must never see (or cite) a data gap.
export function evidenceBlock(input: BattleCardInput, b: EvidenceBlocks): string {
  const myFeatures = bullets(input.myProduct.features);
  const myTech = bullets(input.myProduct.techStack);
  const myPricing = pricingBlock(input.myProduct.pricingTiers);
  const competitorPricing = pricingBlock(input.competitorPricingTiers);

  const myLines = [
    input.myProduct.name ? `Name: ${input.myProduct.name}` : null,
    `Category: ${input.myProduct.category}`,
    input.myProduct.audience ? `Audience: ${input.myProduct.audience}` : null,
    `Value proposition: ${input.myProduct.valueProp}`,
    myFeatures ? `Features (from our own site):\n${myFeatures}` : null,
    myTech ? `Tech stack:\n${myTech}` : null,
    myPricing ? `Pricing:\n${myPricing}` : null,
    b.myHomepage ? `Homepage excerpt:\n${b.myHomepage}` : null,
    b.focusNote.trim() || null,
  ].filter(Boolean);

  const competitorLines = [
    `Name: ${input.competitorName}`,
    input.competitorSummary ? `Summary: ${input.competitorSummary}` : null,
    b.trialBlock,
    competitorPricing ? `Pricing:\n${competitorPricing}` : null,
    b.competitorTechBlock ? `Tech stack (detected on their site):\n${b.competitorTechBlock}` : null,
    b.reviewScoreBlock ? `Reviews:\n${b.reviewScoreBlock}` : null,
    b.customersBlock ? `Published customer proof:\n${b.customersBlock}` : null,
    b.competitorHomepage ? `Homepage excerpt:\n${b.competitorHomepage}` : null,
  ].filter(Boolean);

  const reviewsSection =
    b.praisesBlock || b.complaintsBlock
      ? `\n\n<reviews>${b.praisesBlock ? `\nWhat their customers love:\n${b.praisesBlock}` : ""}${
          b.complaintsBlock
            ? `\nWhat their customers complain about:\n${b.complaintsBlock}`
            : ""
        }\n</reviews>`
      : "";

  const signalsSection = b.signalsBlock
    ? `\n\n<recent_signals>\n${b.signalsBlock}\n</recent_signals>`
    : "";

  return `<my_product>
${myLines.join("\n")}
</my_product>

<competitor>
${competitorLines.join("\n")}
</competitor>${reviewsSection}${signalsSection}`;
}

// A flat source text (same facts, no tags) that the grounding validator and the
// revise pass match citations/claims against.
export function evidenceSourceText(input: BattleCardInput, b: EvidenceBlocks): string {
  const myFeatures = bullets(input.myProduct.features);
  const myTech = bullets(input.myProduct.techStack);
  const myPricing = pricingBlock(input.myProduct.pricingTiers);
  const competitorPricing = pricingBlock(input.competitorPricingTiers);
  return [
    `My product — category: ${input.myProduct.category}; value: ${input.myProduct.valueProp}`,
    input.myProduct.audience ? `My product audience: ${input.myProduct.audience}` : "",
    myFeatures ? `My product features:\n${myFeatures}` : "",
    myTech ? `My product tech stack:\n${myTech}` : "",
    myPricing ? `My product pricing:\n${myPricing}` : "",
    b.myHomepage ? `My product homepage:\n${b.myHomepage}` : "",
    // Always present: claims reference the competitor by name, so the grounding
    // validator's source must carry it even when every dimension is empty.
    `Competitor name: ${input.competitorName}`,
    input.competitorSummary ? `Competitor summary: ${input.competitorSummary}` : "",
    b.trialBlock ?? "",
    competitorPricing ? `Competitor pricing:\n${competitorPricing}` : "",
    b.competitorTechBlock ? `Competitor tech stack:\n${b.competitorTechBlock}` : "",
    b.reviewScoreBlock ? `Competitor reviews:\n${b.reviewScoreBlock}` : "",
    b.customersBlock ? `Competitor published customer proof:\n${b.customersBlock}` : "",
    b.competitorHomepage ? `Competitor homepage:\n${b.competitorHomepage}` : "",
    b.praisesBlock ? `What their customers love:\n${b.praisesBlock}` : "",
    b.complaintsBlock ? `What their customers complain about:\n${b.complaintsBlock}` : "",
    b.signalsBlock ? `Recent signals:\n${b.signalsBlock}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The evidence a card must be traceable to — byte-identical to what the generation
 * prompt, the grounding validator and the revise pass reason over. Exported so the
 * publication gate verifies claims against exactly that, and cannot drift from it.
 */
export function battleCardEvidence(input: BattleCardInput): string {
  return evidenceSourceText(input, computeBlocks(input));
}

export async function generateBattleCard(
  input: BattleCardInput,
): Promise<WithQuality<BattleCardContent> | null> {
  const blocks = computeBlocks(input);

  const prompt = `${evidenceBlock(input, blocks)}

<rules>
- Base EVERY statement ONLY on the evidence blocks above. Do NOT rely on any prior or outside knowledge you may have about these two products: treat your own memory as unreliable and possibly out of date — it has produced false competitive claims before.
- The evidence lists ONLY what we have captured. A dimension that is absent from it is UNKNOWN — not a weakness, not a strength, not a differentiator. Never write that something is "not captured", "unknown", "not publicly available" or "has no data": when the evidence is silent on a dimension, say nothing about it at all.
- GROUND EACH SECTION ON ITS OWN SIDE. their_strengths and their_weaknesses are grounded on the competitor's evidence; our_strengths on OUR product's evidence (features, tech, pricing, homepage, value proposition). A section does NOT need evidence from the other side to be filled — a real, sourced fact about ONE product is a valid entry on its own.
- NO FABRICATED CONTRAST. Never claim or imply that the other side LACKS, is worse at, or does not have something unless the evidence for that other side actually establishes it. Phrasing like "unlike them", "unique to us", "they can't", "we're the only", "differentiates" REQUIRES evidence on BOTH sides — otherwise state the capability as a plain positive fact about the one product ("We offer X") with no comparison.
- Prefer few, well-grounded points over full sections. Returning an EMPTY array for a section is the correct, expected answer when the evidence does not support it — never pad a section to reach the maximum, and never fabricate to fill space.
- Be concrete and specific: cite the actual plan, price, feature, tech, rating or complaint from the evidence rather than generic adjectives ("powerful", "easy to use").
</rules>

<task>
Generate a sales battle card to help win against this competitor, in English.
- their_strengths: their real advantages, each traceable to the evidence (max 5)
- our_strengths: our real, evidence-backed selling points drawn from OUR product's evidence (features, tech, pricing, homepage, value proposition). Do NOT require evidence that the competitor lacks them, and do NOT claim they lack them — state them as concrete positive facts about us (max 5)
- their_weaknesses: their real weak points, each traceable to the evidence (max 5)
- common_objections: objections a prospect might raise to pick them + your sourced sales response (max 5)
- when_we_win: profiles / contexts where we win (max 4)
- when_we_lose: profiles / contexts where we lose (max 4)

Reply ONLY with a valid JSON object, no markdown and no surrounding text.
</task>

<format>
{
  "their_strengths": ["..."],
  "our_strengths": ["..."],
  "their_weaknesses": ["..."],
  "common_objections": [{ "objection": "...", "response": "..." }],
  "when_we_win": ["..."],
  "when_we_lose": ["..."]
}
</format>`;

  const result = await groundedAiCall({
    taskName: "generate_battle_card",
    config: AI_CONFIG.insights,
    prompt,
    sourceText: evidenceSourceText(input, blocks),
    schema: BattleCardSchema,
    // Sized against the smallest ceiling in the pool, not the largest: Groq's free
    // tier counts `prompt_tokens + max_tokens` against 8000 TPM, so with a battle
    // card prompt measured at ~3.5k, anything past ~4k here is refused with a 413
    // before the model runs. 3072 leaves that headroom while comfortably clearing
    // the observed card (1757-2668 completion tokens, and that was WITH the citation
    // envelope this task no longer sends, plus gpt-oss reasoning). Raising it further
    // is not the lever — shrinking the output is, which is what dropping the envelope
    // did. See GROUNDING_POLICY in ../grounding/grounded-call.ts.
    maxTokens: 3072,
  });
  return result ? attachQuality(result.output, result.quality) : null;
}

/**
 * Phase 2A — verification pass with teeth. Re-reads the drafted card against the
 * SAME evidence and returns a cleaned card that KEEPS only claims traceable to it
 * (Chain-of-Verification). Unlike the self-check (which merely flags), this removes
 * unsupported / one-sided comparative claims before the card is ever shown.
 *
 * Pure: no DB. Returns the cleaned content with the draft's quality envelope
 * re-attached, or null on a parse miss (the caller keeps the draft in that case).
 */
export async function reviseBattleCard(
  input: BattleCardInput,
  draft: WithQuality<BattleCardContent>,
  /**
   * Claims the publication gate refused, verbatim. When present this pass is a
   * REPAIR: the card already failed verification, and the caller re-verifies the
   * result before publishing it. Naming the refused sentences here rather than
   * matching them against the card afterwards is what makes the repair safe — a
   * fuzzy match that picks the wrong entry would publish the refused claim.
   */
  flaggedClaims?: string[],
  /**
   * Watch the cleaned card being written, with everything received so far. This is
   * the LAST pass to touch the content, so what it emits is what gets published —
   * which is why it is the one worth showing live. Streaming the draft instead would
   * type out claims this pass is about to delete.
   */
  onPartial?: (textSoFar: string) => void,
): Promise<WithQuality<BattleCardContent> | null> {
  const prompt = buildRevisePrompt(input, draft, flaggedClaims);

  // Same ceiling as the generate pass: this one re-emits all six sections and its
  // prompt carries the evidence AND the draft, so it is the larger request of the
  // two. A truncated revise silently discards the whole verification pass.
  const raw = await complete(AI_CONFIG.insights, {
    prompt,
    json: true,
    maxTokens: 3072,
    ...(onPartial ? { onPartial } : {}),
  });
  const parsed = safeParseJson(raw, BattleCardSchema);
  if (!parsed.ok) {
    console.error("revise_battle_card parse failed:", parsed.error, "raw:", raw.slice(0, 500));
    return null;
  }
  // Carry the generation-time quality envelope forward — the revised content is a
  // strict subset, so its confidence/citations still describe it. Best-effort clear
  // of the human-review flag: we just acted on the flagged issues by pruning.
  const quality = { ...draft._quality, flaggedForHumanReview: false };
  return attachQuality(parsed.value, quality);
}

/** Exported for tests: the refused-claims block is what makes a repair a repair. */
export function buildRevisePrompt(
  input: BattleCardInput,
  draft: BattleCardContent,
  flaggedClaims?: string[],
): string {
  const blocks = computeBlocks(input);
  const sourceText = evidenceSourceText(input, blocks);

  const refusedSection = flaggedClaims?.length
    ? `\n\n<refused_claims>
A fact-checker read this draft against the evidence and could not trace these claims to it:
${flaggedClaims.map((c) => `- ${c}`).join("\n")}
DELETE every entry that states any of them. Do not reword one to keep it, do not soften it, and do not replace it with a new claim — an entry carrying a refused claim must be absent from your answer. Everything else in the draft that survives the rules below stays.
</refused_claims>`
    : "";

  return `You are a strict fact-checker cleaning a competitive sales battle card before it is shown to a user. You are given the EVIDENCE (the only facts that may back a claim) and a DRAFT card. Return the SAME JSON structure, keeping ONLY claims that survive verification.

<evidence>
${sourceText}
</evidence>

<draft>
${JSON.stringify(draft)}
</draft>${refusedSection}

<verification_rules>
- DELETE any claim not directly supported by the evidence — do not soften it into a vaguer claim, remove it entirely.
- DELETE any claim built on the ABSENCE of data — e.g. "reviews are not captured", "no public feature list", "pricing unknown", "no recent signals". Missing evidence is unknown, never a fact about either product.
- But a negative fact the evidence explicitly RECORDS is not an absence claim: "Free trial: none offered." supports "they offer no free trial", and "credit card required up front" supports "you cannot try it without payment details". KEEP those.
- DELETE any claim that the competitor LACKS, is worse at, or does not have something (and any "unlike them", "unique to us", "we win because", "differentiates" phrasing) unless the evidence describes that same dimension for BOTH products. But a one-sided positive fact about a SINGLE product — a real feature, price, tech or rating drawn from its own evidence — is VALID and must be KEPT even when the other side's evidence is silent. Only fabricated or unproven CONTRASTS are removed, not grounded one-sided facts.
- Do NOT add any new claim, fact, or comparison that is not already in the draft.
- You MAY trim a surviving claim down to the part the evidence supports.
- Keep every key. Empty arrays are correct and expected when nothing survives for a section.
- Write all text values in English.
</verification_rules>

Reply ONLY with a valid JSON object matching this shape, no markdown, no surrounding text:
{
  "their_strengths": ["..."],
  "our_strengths": ["..."],
  "their_weaknesses": ["..."],
  "common_objections": [{ "objection": "...", "response": "..." }],
  "when_we_win": ["..."],
  "when_we_lose": ["..."]
}`;
}
