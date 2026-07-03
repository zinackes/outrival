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
  reviewComplaints: string[];
  reviewPraises: string[];
  recentSignals: Array<{ category: string; severity: string; insight: string }>;
  // patch-28 — names of the org's OTHER products (multi-SKU). When present, the card
  // is told to stay focused on `myProduct` only, to avoid cross-contamination.
  otherProductNames?: string[];
}

function bullets(items: string[] | undefined, empty = "Not captured."): string {
  return items && items.length ? items.map((i) => `- ${i}`).join("\n") : empty;
}

function pricingBlock(tiers: BattleCardPricingTier[] | undefined): string {
  if (!tiers || !tiers.length) return "Pricing: not captured.";
  return tiers
    .map((t) => `- ${t.planName}: ${t.price} ${t.currency} / ${t.billingPeriod}`)
    .join("\n");
}

interface EvidenceBlocks {
  signalsBlock: string;
  praisesBlock: string;
  complaintsBlock: string;
  trialBlock: string;
  competitorTechBlock: string;
  reviewScoreBlock: string;
  myHomepage: string | null;
  competitorHomepage: string | null;
  focusNote: string;
}

// Compute every evidence block ONCE, so the generation prompt, the grounding
// sourceText, and the revise pass all reason over byte-identical evidence.
function computeBlocks(input: BattleCardInput): EvidenceBlocks {
  const signalsBlock = input.recentSignals.length
    ? input.recentSignals
        .slice(0, 8)
        .map((s) => `- [${s.severity}] ${s.category} — ${s.insight}`)
        .join("\n")
    : "No recent signals.";

  const praisesBlock = bullets(input.reviewPraises?.slice(0, 8), "n/a");
  const complaintsBlock = bullets(input.reviewComplaints?.slice(0, 8), "n/a");

  // Free-trial line: a concrete acquisition comparison the rep can lean on.
  const trialBlock = (() => {
    const t = input.competitorTrial;
    if (!t) return "Free trial: unknown.";
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
    : "Detected tech stack: not captured.";

  const reviewScoreBlock = (() => {
    const r = input.competitorReviews;
    if (!r) return "Review ratings: not captured.";
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
    return parts.length ? parts.join("\n") : "Review ratings: not captured.";
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
    myHomepage,
    competitorHomepage,
    focusNote,
  };
}

// The evidence, rendered as two symmetric product blocks. Shared by the prompt and
// (verbatim) by the grounding sourceText + the revise pass, so a claim can only
// survive if it traces to text every stage saw.
function evidenceBlock(input: BattleCardInput, b: EvidenceBlocks): string {
  return `<my_product>
${input.myProduct.name ? `Name: ${input.myProduct.name}\n` : ""}Category: ${input.myProduct.category}
${input.myProduct.audience ? `Audience: ${input.myProduct.audience}\n` : ""}Value proposition: ${input.myProduct.valueProp}
Features (from our own site):
${bullets(input.myProduct.features)}
Tech stack:
${bullets(input.myProduct.techStack)}
Pricing:
${pricingBlock(input.myProduct.pricingTiers)}
${b.myHomepage ? `Homepage excerpt:\n${b.myHomepage}\n` : ""}${b.focusNote}
</my_product>

<competitor>
Name: ${input.competitorName}
Summary: ${input.competitorSummary ?? "unknown"}
${b.trialBlock}
Pricing:
${pricingBlock(input.competitorPricingTiers)}
Tech stack (detected on their site):
${b.competitorTechBlock}
Reviews:
${b.reviewScoreBlock}
${b.competitorHomepage ? `Homepage excerpt:\n${b.competitorHomepage}\n` : ""}</competitor>

<reviews>
What their customers love:
${b.praisesBlock}

What their customers complain about:
${b.complaintsBlock}
</reviews>

<recent_signals>
${b.signalsBlock}
</recent_signals>`;
}

// A flat source text (same facts, no tags) that the grounding validator and the
// revise pass match citations/claims against.
function evidenceSourceText(input: BattleCardInput, b: EvidenceBlocks): string {
  return [
    `My product — category: ${input.myProduct.category}; value: ${input.myProduct.valueProp}`,
    input.myProduct.audience ? `My product audience: ${input.myProduct.audience}` : "",
    `My product features:\n${bullets(input.myProduct.features)}`,
    `My product tech stack:\n${bullets(input.myProduct.techStack)}`,
    `My product pricing:\n${pricingBlock(input.myProduct.pricingTiers)}`,
    b.myHomepage ? `My product homepage:\n${b.myHomepage}` : "",
    `Competitor summary: ${input.competitorSummary ?? ""}`,
    b.trialBlock,
    `Competitor pricing:\n${pricingBlock(input.competitorPricingTiers)}`,
    `Competitor tech stack:\n${b.competitorTechBlock}`,
    `Competitor reviews:\n${b.reviewScoreBlock}`,
    b.competitorHomepage ? `Competitor homepage:\n${b.competitorHomepage}` : "",
    `What their customers love:\n${b.praisesBlock}`,
    `What their customers complain about:\n${b.complaintsBlock}`,
    `Recent signals:\n${b.signalsBlock}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function generateBattleCard(
  input: BattleCardInput,
): Promise<WithQuality<BattleCardContent> | null> {
  const blocks = computeBlocks(input);

  const prompt = `${evidenceBlock(input, blocks)}

<rules>
- Base EVERY statement ONLY on the evidence blocks above. Do NOT rely on any prior or outside knowledge you may have about these two products: treat your own memory as unreliable and possibly out of date — it has produced false competitive claims before.
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
    maxTokens: 2048,
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
): Promise<WithQuality<BattleCardContent> | null> {
  const blocks = computeBlocks(input);
  const sourceText = evidenceSourceText(input, blocks);

  const prompt = `You are a strict fact-checker cleaning a competitive sales battle card before it is shown to a user. You are given the EVIDENCE (the only facts that may back a claim) and a DRAFT card. Return the SAME JSON structure, keeping ONLY claims that survive verification.

<evidence>
${sourceText}
</evidence>

<draft>
${JSON.stringify(draft)}
</draft>

<verification_rules>
- DELETE any claim not directly supported by the evidence — do not soften it into a vaguer claim, remove it entirely.
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

  const raw = await complete(AI_CONFIG.insights, { prompt, json: true, maxTokens: 2048 });
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
