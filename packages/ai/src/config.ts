export type AIProvider = "groq" | "claude";

export interface AITaskConfig {
  provider: AIProvider;
  model: string;
}

export const AI_CONFIG: Record<
  "classification" | "insights" | "digest",
  AITaskConfig
> = {
  classification: { provider: "groq", model: "llama-3.3-70b-versatile" },
  insights:       { provider: "groq", model: "llama-3.3-70b-versatile" },
  digest:         { provider: "groq", model: "llama-3.3-70b-versatile" },
};
