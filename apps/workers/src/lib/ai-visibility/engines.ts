import { logger } from "@trigger.dev/sdk/v3";

// AI Visibility answer-engine clients (docs/ai-visibility.md, phase 2). Each engine
// is queried ONCE per prompt; the answer text + citations are then parsed for which
// tracked subjects appear. Best-effort: a missing key or an API error returns null so
// the job skips that prompt rather than failing — no key configured means no cost.

export type Engine = "perplexity"; // chatgpt | google_aio land in phase 5

export interface EngineAnswer {
  answer: string;
  citations: string[];
  model: string;
}

// Perplexity Sonar — a web-grounded answer engine with citations (the cheapest,
// most "answer-native" first engine). Model is overridable via env; defaults to the
// base `sonar` (lowest per-request search fee).
async function queryPerplexity(prompt: string): Promise<EngineAnswer | null> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    logger.warn("ai-visibility: PERPLEXITY_API_KEY not set, skipping perplexity");
    return null;
  }
  const model = process.env.AI_VISIBILITY_PERPLEXITY_MODEL ?? "sonar";
  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      logger.error("ai-visibility: perplexity request failed", {
        status: res.status,
        body: (await res.text()).slice(0, 300),
      });
      return null;
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      citations?: string[];
    };
    const answer = data.choices?.[0]?.message?.content?.trim();
    if (!answer) {
      logger.warn("ai-visibility: perplexity returned an empty answer");
      return null;
    }
    return { answer, citations: data.citations ?? [], model };
  } catch (err) {
    logger.error("ai-visibility: perplexity request threw", { err: String(err) });
    return null;
  }
}

export async function queryEngine(engine: Engine, prompt: string): Promise<EngineAnswer | null> {
  switch (engine) {
    case "perplexity":
      return queryPerplexity(prompt);
    default:
      return null;
  }
}
