import type { StructuredChange } from "../diff/homepage-diff";

/**
 * Composite relevance score for a structured homepage change — patch-17. Lets the
 * pipeline silence low-impact churn (a footer tweak) while always surfacing a
 * positioning move (the H1, a pricing section). score = sectionWeight × magnitude
 * × recency, all in [0, 1]. PURE and deterministic. Exposed as the
 * `@outrival/scrapers/relevance` subpath.
 *
 * NOTE: magnitude uses token dissimilarity (1 − Jaccard), not the spec's
 * length-delta — a full H1 rewrite of similar length must score HIGH, not low.
 */

export interface RelevanceScore {
  score: number;
  components: { sectionWeight: number; magnitude: number; recency: number };
}

// Importance of WHERE the change is. Keyed by StructuredChange.field (with the
// enrichment kinds keyed by their field === kind). Unknown field ⇒ 0.5.
const SECTION_WEIGHTS: Record<string, number> = {
  "hero.headline": 1.0,
  "hero.subheadline": 0.9,
  "hero.primaryCta": 0.85,
  "hero.secondaryCta": 0.7,
  "sections[pricing]": 0.95,
  "sections[features]": 0.75,
  "sections[integrations]": 0.6,
  "sections[cta]": 0.6,
  "sections[logos]": 0.5,
  "sections[other]": 0.5,
  "sections[testimonials]": 0.4,
  "sections[faq]": 0.3,
  "sections.order": 0.3,
  navigation: 0.7,
  footer: 0.2,
  "meta.title": 0.8,
  "meta.description": 0.6,
  "og.title": 0.4,
  "og.description": 0.4,
  visual_redesign: 0.7,
  numeric_claim_changed: 0.65,
  "socialProof.customerLogos": 0.6,
  "socialProof.customerLogos.count": 0.45,
  "socialProof.testimonials": 0.4,
  "socialProof.testimonialCount": 0.3,
};

function tokens(s: string | null): Set<string> {
  return new Set(
    (s ?? "")
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 1),
  );
}

// 1 − Jaccard token overlap: 0 = same wording, 1 = entirely different words.
function dissimilarity(a: string | null, b: string | null): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 && tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  const jaccard = union === 0 ? 0 : inter / union;
  return 1 - jaccard;
}

function computeMagnitude(change: StructuredChange): number {
  switch (change.kind) {
    case "visual_redesign":
    case "section_added":
    case "section_removed":
      return 1;
    case "customer_logo_added":
    case "customer_logo_removed":
      return 0.8;
    case "testimonial_added":
    case "testimonial_removed":
      return 0.6;
    case "numeric_claim_changed": {
      const v = typeof change.metadata?.variation === "number" ? change.metadata.variation : 0;
      return Math.min(1, Math.abs(v) * 2); // 50% variation ⇒ max
    }
    default: {
      const base = dissimilarity(change.before, change.after);
      if (change.kind === "section_body_changed" && change.bodyDiff) {
        const moved = change.bodyDiff.added.length + change.bodyDiff.removed.length;
        return Math.min(1, Math.max(base, moved / 10));
      }
      return base;
    }
  }
}

/**
 * Score a single change. `previousChangesInLast7Days` damps a competitor that
 * changes constantly — each individual change is then worth less.
 */
export function scoreRelevance(
  change: StructuredChange,
  context: { previousChangesInLast7Days: number },
): RelevanceScore {
  const sectionWeight = SECTION_WEIGHTS[change.field] ?? 0.5;
  const magnitude = computeMagnitude(change);
  const recency = 1 / (1 + Math.max(0, context.previousChangesInLast7Days) * 0.2);
  const score = Math.min(1, sectionWeight * magnitude * recency);
  return { score, components: { sectionWeight, magnitude, recency } };
}
