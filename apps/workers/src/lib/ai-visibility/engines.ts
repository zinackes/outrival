import { logger } from "../job-logger";

// AI Visibility answer-engine clients (docs/ai-visibility.md, phase 2). Each engine
// is queried ONCE per prompt; the answer text + citations are then parsed for which
// tracked subjects appear. Best-effort: a missing key or an API error returns null so
// the job skips that prompt rather than failing — no key configured means no cost.

export type Engine = "perplexity" | "gemini"; // chatgpt | google_aio land in phase 5

// Hard per-request timeout: Node's fetch has none, so a stalled grounding call would
// hang until the job's maxDuration hard-kills it — which skips the in-run catch and
// leaves the teaser card polling forever. Abort the request instead so the engine
// resolves to null (best-effort skip) well inside the job budget.
const ENGINE_TIMEOUT_MS = 25_000;

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
      signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
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

// Gemini + Google Search grounding — the FREE default engine (docs/ai-visibility-free.md).
// Gemini 3.x gets ~5,000 grounded prompts/month free on the AI Studio tier, so a
// GEMINI_API_KEY (free) replaces the paid Perplexity Sonar fee. It's a web-grounded
// answer with citations that stands in for "Google's AI answer". Model is overridable:
// pin AI_VISIBILITY_GEMINI_MODEL to the current 3.x Flash to land in the free grounding
// quota (the default alias may resolve to a paid-grounding 2.5 model).
async function queryGemini(prompt: string): Promise<EngineAnswer | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.warn("ai-visibility: GEMINI_API_KEY not set, skipping gemini");
    return null;
  }
  const model = process.env.AI_VISIBILITY_GEMINI_MODEL ?? "gemini-flash-latest";
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
        }),
        signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      logger.error("ai-visibility: gemini request failed", {
        status: res.status,
        body: (await res.text()).slice(0, 300),
      });
      return null;
    }
    const data = (await res.json()) as {
      candidates?: {
        content?: { parts?: { text?: string }[] };
        groundingMetadata?: { groundingChunks?: { web?: { uri?: string } }[] };
      }[];
    };
    const candidate = data.candidates?.[0];
    const answer = candidate?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!answer) {
      logger.warn("ai-visibility: gemini returned an empty answer");
      return null;
    }
    const citations = (candidate?.groundingMetadata?.groundingChunks ?? [])
      .map((c) => c.web?.uri)
      .filter((u): u is string => Boolean(u));
    return { answer, citations, model };
  } catch (err) {
    logger.error("ai-visibility: gemini request threw", { err: String(err) });
    return null;
  }
}

export async function queryEngine(engine: Engine, prompt: string): Promise<EngineAnswer | null> {
  switch (engine) {
    case "perplexity":
      return queryPerplexity(prompt);
    case "gemini":
      return queryGemini(prompt);
    default:
      return null;
  }
}
