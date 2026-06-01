export type AIProvider = "groq" | "claude";

export interface AITaskConfig {
  provider: AIProvider;
  model: string;
}

export const AI_CONFIG: Record<
  "classification" | "classificationFast" | "insights" | "digest",
  AITaskConfig
> = {
  // "smart" 70b — rich extraction/reasoning (analyze, extract-*, summaries).
  classification:     { provider: "groq", model: "llama-3.3-70b-versatile" },
  // "fast" 8b — cheap, plenty for change classification and overlap scoring.
  classificationFast: { provider: "groq", model: "llama-3.1-8b-instant" },
  insights:           { provider: "groq", model: "llama-3.3-70b-versatile" },
  digest:             { provider: "groq", model: "llama-3.3-70b-versatile" },
};
