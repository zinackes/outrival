import Groq from "groq-sdk";
import Anthropic from "@anthropic-ai/sdk";
import type { AITaskConfig } from "./config";
import { aiEnv } from "./env";

let groqClient: Groq | null = null;
let claudeClient: Anthropic | null = null;

function getGroq(): Groq {
  if (!groqClient) groqClient = new Groq({ apiKey: aiEnv().GROQ_API_KEY });
  return groqClient;
}

function getClaude(): Anthropic {
  if (!claudeClient) {
    const key = aiEnv().ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is required when provider=claude");
    claudeClient = new Anthropic({ apiKey: key });
  }
  return claudeClient;
}

export interface CompletionOptions {
  prompt: string;
  maxTokens?: number;
  json?: boolean;
}

export async function complete(
  config: AITaskConfig,
  options: CompletionOptions,
): Promise<string> {
  if (config.provider === "groq") {
    const res = await getGroq().chat.completions.create({
      model: config.model,
      messages: [{ role: "user", content: options.prompt }],
      max_tokens: options.maxTokens ?? 1024,
      ...(options.json && { response_format: { type: "json_object" as const } }),
    });
    return res.choices[0]?.message?.content ?? "";
  }

  if (config.provider === "claude") {
    const res = await getClaude().messages.create({
      model: config.model,
      max_tokens: options.maxTokens ?? 1024,
      messages: [{ role: "user", content: options.prompt }],
    });
    const block = res.content[0];
    return block && block.type === "text" ? block.text : "";
  }

  throw new Error(`Unknown AI provider: ${config.provider as string}`);
}
