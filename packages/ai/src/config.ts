export type AIProvider = "groq" | "claude";

export interface AITaskConfig {
  provider: AIProvider;
  model: string;
  /**
   * Task difficulty tier. "fast" routes a pool ("groq") call to the provider's
   * cheap small model when it declares one (AI_PROVIDER_N_FAST_MODEL); otherwise
   * it falls back to the provider's default model. Defaults to "smart".
   */
  tier?: "fast" | "smart";
}

export const AI_CONFIG: Record<
  "classification" | "classificationFast" | "insights" | "digest",
  AITaskConfig
> = {
  // "smart" 70b — rich extraction/reasoning (analyze, extract-*, summaries).
  classification:     { provider: "groq", model: "llama-3.3-70b-versatile" },
  // "fast" 8b — cheap, plenty for change classification and overlap scoring.
  classificationFast: { provider: "groq", model: "llama-3.1-8b-instant", tier: "fast" },
  insights:           { provider: "groq", model: "llama-3.3-70b-versatile" },
  digest:             { provider: "groq", model: "llama-3.3-70b-versatile" },
};
