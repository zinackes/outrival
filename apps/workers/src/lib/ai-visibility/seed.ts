import type { SelfProfile } from "@outrival/db";
import {
  generateVisibilityPrompts,
  fallbackVisibilityPrompts,
  AI_CONFIG,
  type VisibilityPromptInput,
} from "@outrival/ai";
import { logAiRun } from "../analytics";

// Shared seed-prompt logic for AI Visibility (tracked feature + onboarding teaser).
// Both jobs build the same buyer-intent set from a product's self profile + roster,
// so the flatten + AI-with-deterministic-fallback lives in one place.

// The self-competitor fields the seeder reads. `selfProfile.*.value` are the rich,
// auto-refreshed fields; `category` is the flat column fallback (set even when the
// jsonb profile is thin).
export interface SelfLike {
  name: string | null;
  category: string | null;
  selfProfile?: SelfProfile | null;
}

/** Flatten a self-competitor + its competitors' names into the AI prompt input. */
export function buildVisibilityPromptInput(
  self: SelfLike,
  competitorNames: string[],
): VisibilityPromptInput {
  const sp = self.selfProfile;
  const str = (v: string | undefined | null) => (v && v.trim() ? v.trim() : null);
  return {
    selfName: str(self.name),
    category: str(sp?.category?.value) ?? str(self.category),
    audience: str(sp?.audience?.value),
    valueProp: str(sp?.valueProp?.value),
    features: (sp?.features?.value ?? []).map((f) => f.trim()).filter(Boolean),
    competitorNames: competitorNames.map((n) => n.trim()).filter(Boolean),
  };
}

/**
 * Seed prompts for a product: one persisted, buyer-intent set. Tries the AI generator
 * (natural-language prompts that mirror how buyers query LLMs), falls back to the
 * deterministic cross-field set on any non-ok outcome. Logs the true ai_runs status —
 * success vs a genuine parse miss vs a hard 429/network error — instead of masking the
 * error as a parse miss, and without letting that error crash the job (loggedAi would
 * rethrow; here we log manually and keep the fallback).
 */
export async function seedVisibilityPrompts(
  input: VisibilityPromptInput,
  count: number,
): Promise<string[]> {
  // Thin profile: no basis for a generative call — go straight to the deterministic
  // fallback, and don't log a phantom ai_run the model never actually ran.
  if (!input.category && !input.valueProp && !input.selfName) {
    return fallbackVisibilityPrompts(input, count);
  }

  const outcome = await generateVisibilityPrompts(input, count);
  await logAiRun(
    "generate_ai_visibility_prompts",
    AI_CONFIG.classification.provider,
    AI_CONFIG.classification.model,
    outcome.status === "ok" ? "success" : outcome.status,
  );
  if (outcome.status === "ok") return outcome.prompts.slice(0, count);
  return fallbackVisibilityPrompts(input, count);
}
