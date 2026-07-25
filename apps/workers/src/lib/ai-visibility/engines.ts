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

// A 429 that reports an ALLOWANCE (per day, per month, or a model with no free
// grounding at all) is not a per-prompt failure: every remaining prompt in the run
// would 429 too. Raise instead of returning null so the caller can drop the engine
// for the whole run rather than firing N more doomed requests. A per-MINUTE 429 is
// a different animal and never reaches here — see engineFetch.
export class EngineQuotaError extends Error {
  constructor(
    readonly engine: Engine,
    readonly body: string,
  ) {
    super(`ai-visibility: ${engine} quota exhausted`);
    this.name = "EngineQuotaError";
  }
}

// Minimum gap between two calls to the SAME engine. Gemini's free tier caps requests
// per minute as well as per day, and this job used to fire its whole prompt set in a
// burst — 10 prompts per product, back to back — so a healthy key still 429'd from
// the 11th call on. That rate 429 then tripped the quota guard above and killed the
// engine for the entire run, which reads exactly like an exhausted allowance. Pacing
// the calls is what tells the two apart in the first place.
const MIN_REQUEST_GAP_MS = Number(process.env.AI_VISIBILITY_MIN_REQUEST_GAP_MS ?? 6_500);
const lastCallAt = new Map<Engine, number>();

// Cap on how long we honour a provider's retryDelay. Beyond this the wait costs more
// than the answer is worth, and the run should move on.
const MAX_RETRY_WAIT_MS = 30_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function pace(engine: Engine) {
  const last = lastCallAt.get(engine);
  const wait = last === undefined ? 0 : last + MIN_REQUEST_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt.set(engine, Date.now());
}

// Google names the quota that tripped in error.details[].violations[].quotaId, e.g.
// "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" versus its PerDay sibling.
// Perplexity carries no such field, so fall back to a short Retry-After, which only
// a rate limiter sends. Anything else is treated as an allowance: dropping an engine
// for one run costs a data point, retrying a spent allowance costs the whole run.
export function retryAfterMs(body: string, headers: Headers): number | null {
  // An allowance 429 can also carry a retryDelay, and honouring it would burn a call
  // to be refused again. The named quota wins over the hint.
  if (/"quotaId":\s*"[^"]*per[\s_-]*day/i.test(body)) return null;
  const perMinute = /"quotaId":\s*"[^"]*per[\s_-]*minute/i.test(body);
  const hinted =
    body.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/)?.[1] ?? headers.get("retry-after");
  if (!perMinute && hinted == null) return null;
  const seconds = Number(hinted);
  const ms = Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : MIN_REQUEST_GAP_MS;
  if (ms > MAX_RETRY_WAIT_MS) return null;
  return Math.max(ms, MIN_REQUEST_GAP_MS);
}

// Shared request path: pace the call, retry ONCE through a per-minute rate limit,
// and raise EngineQuotaError on an exhausted allowance. Returns the response when
// it's usable, null on any other failure (best-effort skip, the caller's contract).
async function engineFetch(
  engine: Engine,
  url: string,
  init: RequestInit,
  retried = false,
): Promise<Response | null> {
  await pace(engine);
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS) });
  if (res.ok) return res;

  // Read enough to see the quota id (it sits past the 300 chars we log).
  const body = (await res.text()).slice(0, 2_000);
  logger.error(`ai-visibility: ${engine} request failed`, {
    status: res.status,
    body: body.slice(0, 300),
  });
  if (res.status !== 429) return null;

  const wait = retried ? null : retryAfterMs(body, res.headers);
  if (wait === null) throw new EngineQuotaError(engine, body.slice(0, 300));
  logger.warn(`ai-visibility: ${engine} rate limited, retrying once`, { waitMs: wait });
  await sleep(wait);
  return engineFetch(engine, url, init, true);
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
    const res = await engineFetch("perplexity", "https://api.perplexity.ai/chat/completions", {
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
    if (!res) return null;
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
    if (err instanceof EngineQuotaError) throw err;
    logger.error("ai-visibility: perplexity request threw", { err: String(err) });
    return null;
  }
}

// Gemini + Google Search grounding — the FREE default engine (docs/ai-visibility-free.md).
// A GEMINI_API_KEY (free) replaces the paid Perplexity Sonar fee: it's a web-grounded
// answer with citations that stands in for "Google's AI answer".
//
// The model is PINNED, never an alias. The free grounding allowance is granted per
// MODEL, and a `-latest` alias silently moves to a generation that has none — measured
// 2026-07-24 on the prod key, same project, same minute:
//   gemini-2.5-flash      200      gemini-flash-latest    429
//   gemini-2.0-flash      429      gemini-2.5-flash-lite  429
// That is what took AI visibility down: not an exhausted quota (72 grounded requests
// that whole month), an alias that drifted off the free tier. Re-run that matrix before
// changing this default, and prefer a version pin over any `-latest` name.
async function queryGemini(prompt: string): Promise<EngineAnswer | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.warn("ai-visibility: GEMINI_API_KEY not set, skipping gemini");
    return null;
  }
  const model = process.env.AI_VISIBILITY_GEMINI_MODEL ?? "gemini-2.5-flash";
  try {
    const res = await engineFetch(
      "gemini",
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
        }),
      },
    );
    if (!res) return null;
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
    if (err instanceof EngineQuotaError) throw err;
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
