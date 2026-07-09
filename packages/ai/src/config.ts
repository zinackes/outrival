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

// NOTE: on the pool path (`provider: "groq"`) the `model` below is NOT what runs —
// callLLM picks `provider.fastModel ?? provider.model` from the env-configured pool,
// and only `tier` steers that choice. `model` is the value used for `provider:
// "claude"` and as the ai_runs fallback label when the pool didn't run. Keep it
// truthful anyway: the old llama ids are discontinued by Groq on 2026-08-16.
export const AI_CONFIG: Record<
  "classification" | "classificationFast" | "insights" | "digest",
  AITaskConfig
> = {
  // "smart" — rich extraction/reasoning (analyze, extract-*, summaries).
  classification:     { provider: "groq", model: "openai/gpt-oss-120b" },
  // "fast" — cheap, plenty for change classification, overlap scoring, source blurbs.
  classificationFast: { provider: "groq", model: "openai/gpt-oss-20b", tier: "fast" },
  insights:           { provider: "groq", model: "openai/gpt-oss-120b" },
  digest:             { provider: "groq", model: "openai/gpt-oss-120b" },
};
