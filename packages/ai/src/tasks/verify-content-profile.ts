import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

/**
 * Second stage of structural-change detection (patch-23): given a competitor's
 * known profile and the *current* content of its site, judge whether the site
 * still belongs to that competitor. Confirms a pivot/acquisition/category-shift
 * that the cheap structural signal only suspected, so a mere redesign (same
 * product, new look) doesn't trigger a false alarm.
 *
 * NOT cached — the verdict depends on the freshly scraped content. The calling
 * job logs the ai_run (task = "verify_content_profile"); this task stays pure.
 */

export const VerifyContentSchema = z.object({
  matchesProfile: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]),
  detectedAcquisition: z.boolean(),
  detectedCategoryShift: z.boolean(),
  currentSummary: z.string(),
  reasoning: z.string(),
});

export type VerifyContentResult = z.infer<typeof VerifyContentSchema>;

export interface VerifyContentInput {
  competitor: {
    name: string;
    category?: string | null;
    description?: string | null;
    aiSummary?: string | null;
  };
  /** Current extracted visible text of the site (caller slices it). */
  currentContent: string;
}

export async function verifyContentMatchesProfile(
  input: VerifyContentInput,
): Promise<VerifyContentResult | null> {
  const { competitor } = input;
  const prompt = `You verify whether the current content of a website still matches the profile of the competitor we are tracking.

Tracked competitor profile:
  Name: ${competitor.name}
  Category: ${competitor.category ?? "unknown"}
  Description: ${competitor.description ?? "n/a"}
  Known summary: ${competitor.aiSummary ?? "n/a"}

Current content of the site:
${input.currentContent.slice(0, 3000)}

Decide whether the current content still represents the same product/company. A redesign or new messaging for the SAME product still matches. A completely different product, an acquisition/redirect to another company, or a different category does NOT match.

Reply with strict JSON only, no markdown, no preamble. Write all text values in English:
{
  "matchesProfile": boolean,
  "confidence": "high" | "medium" | "low",
  "detectedAcquisition": boolean,
  "detectedCategoryShift": boolean,
  "currentSummary": string,
  "reasoning": string
}`;

  const raw = await complete(AI_CONFIG.insights, { prompt, json: true });
  const parsed = safeParseJson(raw, VerifyContentSchema);
  return parsed.ok ? parsed.value : null;
}
