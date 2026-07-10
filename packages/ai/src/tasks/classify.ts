import { z } from "zod";
import { AI_CONFIG } from "../config";
import { groundedAiCall } from "../grounding/grounded-call";
import { attachQuality, type WithQuality } from "../grounding/types";

const CACHE_TTL_SECONDS = Number(process.env.AI_CACHE_TTL_CLASSIFY_DAYS ?? 7) * 86400;

export const ClassificationSchema = z.object({
  category: z.enum(["pricing", "product", "hiring", "reviews", "content", "funding"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  is_significant: z.boolean(),
  reason: z.string(),
  // Plain-language before/after of the main change, for the "Why this insight?"
  // panel (patch-14). nullable+optional so the model may return null when it
  // can't extract a clean pair, and so any cached classification that predates
  // these keys still parses (withAiCache returns the stored object without
  // re-validating).
  humanChangeBefore: z.string().nullable().optional(),
  humanChangeAfter: z.string().nullable().optional(),
});

export type Classification = z.infer<typeof ClassificationSchema>;

export interface ClassifyContext {
  /** Monitor source type, e.g. "homepage" | "pricing" | "blog". */
  sourceType?: string;
  competitorName?: string;
}

// Human-readable page type for the prompt. Lets the model weigh significance by
// where the change happened (a homepage testimonial rotating vs a pricing tier
// moving) instead of judging a context-free blob of diff lines.
const SOURCE_LABELS: Record<string, string> = {
  homepage: "homepage / landing page",
  pricing: "pricing page",
  blog: "blog or changelog index",
  changelog: "changelog",
  jobs: "careers / jobs page",
  g2_reviews: "G2 reviews page",
  capterra_reviews: "Capterra reviews page",
  appstore_reviews: "App Store reviews page",
  github_repo: "GitHub repository",
  linkedin: "LinkedIn page",
  twitter: "X / Twitter profile",
  subdomains: "list of the competitor's live subdomains (Certificate Transparency)",
};

// Static instructions, byte-identical across EVERY classify call → sent as the
// `system` message so Groq/Cerebras auto-cache this long shared prefix for free
// (F2). Content is unchanged from the prior single-prompt form: the only variable
// parts (the page-type context + the diff) now live in the user message tail.
const CLASSIFY_SYSTEM = `You are a competitive-intelligence analyst. Classify a change detected on a competitor.

Use the page type (provided with the change) to judge significance: rotating testimonials, social-proof counters, cosmetic copy/nav tweaks are usually NOT significant; pricing, plan, feature, hiring, or positioning changes are.

<severity-rubric>
"critical" triggers an IMMEDIATE email to the customer, bypassing all moderation.
Use it only when BOTH hold:
  (a) the change is a direct threat or opening for the customer's own positioning
      or revenue — a price undercut or pricing-structure change by a direct
      competitor, the launch of a directly competing flagship capability, a funding
      round >= $100M or an acquisition of a direct competitor, or entry into the
      customer's exact segment; AND
  (b) the useful reaction window is DAYS, not weeks.
If unsure between "critical" and "high", choose "high".
"high" — a material strategic move where reacting next week loses nothing: a
notable product launch, a quantified price change, a complete repositioning of the
hero/value proposition, a strategic hiring wave.
"medium" — real but incremental: a new job posting, a new page section, a
promotion, a plan-limit tweak.
"low" — cosmetic or informational: copy polish, testimonials/logos, navigation,
meta tags, documentation pages.
Severity is judged on the CONTENT of the change, never on the size of the diff —
a one-line diff can be critical; a huge redesign diff can be low.
</severity-rubric>

<category-rules>
Judge WHAT changed, never WHERE it appeared:
- pricing: any price, plan, tier, trial, or gating change, on any page.
- funding: a raise, acquisition, or valuation announcement, even on a blog post.
- product: shipped or announced capabilities, launches, integrations.
- hiring: job postings and team growth — even when they telegraph product direction.
- reviews: review-platform score or review-content movements only.
- content: messaging, positioning, or content-strategy changes (use only when none
  of the above applies).
When two genuinely apply, pick by this priority: pricing > funding > product >
hiring > reviews > content.
</category-rules>

Reply ONLY with a valid JSON object, no markdown and no surrounding text.
Write all text values in English.

Also identify the SINGLE most important change and describe just that one:
  - humanChangeBefore: the value BEFORE, phrased naturally (e.g. "Standard · $99/mo")
  - humanChangeAfter:  the value AFTER, phrased naturally (e.g. "Standard · $79/mo")
Keep each side to a short phrase (at most ~8 words); describe only that one change,
never concatenate several. If you can't extract a clean before/after, return null
for BOTH fields.

<format>
{
  "category": "pricing|product|hiring|reviews|content|funding",
  "severity": "low|medium|high|critical",
  "is_significant": true|false,
  "reason": "one short sentence",
  "humanChangeBefore": "Standard · $99/mo" or null,
  "humanChangeAfter": "Standard · $79/mo" or null
}
</format>`;

export async function classifyChange(
  diffText: string,
  context: ClassifyContext = {},
): Promise<WithQuality<Classification> | null> {
  const sourceLabel = context.sourceType
    ? (SOURCE_LABELS[context.sourceType] ?? context.sourceType)
    : null;
  const where = [context.competitorName, sourceLabel].filter(Boolean).join(" — ");
  const contextBlock = where
    ? `<context>
This change was detected on: ${where}.
</context>
`
    : "";

  // Variable payload only (context + diff) — the static instructions ride in
  // CLASSIFY_SYSTEM so the cacheable prefix stays byte-identical (F2).
  const prompt = `${contextBlock}<change>
${diffText.slice(0, 8000)}
</change>`;

  // Key on the context too: the same diff on different page types / competitors
  // now yields a different prompt, so it must not share a cache entry.
  const cacheKey = [context.sourceType ?? "", context.competitorName ?? "", diffText].join("\n");
  const result = await groundedAiCall({
    taskName: "classify_change",
    config: AI_CONFIG.classificationFast,
    system: CLASSIFY_SYSTEM,
    prompt,
    sourceText: diffText.slice(0, 8000),
    schema: ClassificationSchema,
    cache: { input: cacheKey, namespace: "classify", ttlSeconds: CACHE_TTL_SECONDS },
  });
  return result ? attachQuality(result.output, result.quality) : null;
}
