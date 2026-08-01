import { logger } from "../job-logger";
import {
  engineModels,
  markModelExhausted,
  pickModel,
  reserveEngineCall,
} from "./budget";

// AI Visibility answer-engine clients (docs/ai-visibility.md, phase 2). Each engine
// is queried ONCE per prompt; the answer text + citations are then parsed for which
// tracked subjects appear. Best-effort: a missing key or an API error returns null so
// the job skips that prompt rather than failing — no key configured means no cost.
//
// Pacing and the daily ceiling live in ./budget.ts, in a Postgres row rather than in
// this module's memory. See docs/ai-visibility-engine-capacity.md for why: the
// in-process pacer could not hold across the six runs pg-boss picks up at once.

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

// A 429 that reports a spent ALLOWANCE (per day, per month) is not a per-prompt
// failure: every remaining prompt of the run would 429 too. Raise instead of
// returning null so the caller can drop the engine for the whole run rather than
// firing N more doomed requests.
//
// Nothing ELSE raises this any more. A per-minute limit, or a 429 we cannot read,
// used to land here too, and that is what turned one rate-limit blip into a dead
// run: `exhausted.add(engine)` skipped every remaining prompt of every remaining
// product. Those now cost one prompt and the drip re-offers it tomorrow.
export class EngineQuotaError extends Error {
  constructor(
    readonly engine: Engine,
    readonly body: string,
    readonly model?: string,
  ) {
    super(`ai-visibility: ${engine} quota exhausted`);
    this.name = "EngineQuotaError";
  }
}

// How long we will sit on a provider's retry hint. Google's free tier answers a
// per-minute limit with delays in the tens of seconds, and the old 30s ceiling turned
// every one of those into a fake "allowance exhausted". A minute of waiting costs one
// prompt's latency inside a job budgeted in minutes.
const MAX_RETRY_WAIT_MS = 65_000;
const MIN_REQUEST_GAP_MS = Number(process.env.AI_VISIBILITY_MIN_REQUEST_GAP_MS ?? 13_000);
// How many times we ride out a rate limit on one prompt before giving the slot up.
const MAX_RATE_LIMIT_RETRIES = 2;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Does this 429 say the ALLOWANCE is gone, as opposed to "you are going too fast"?
 * Google names the quota that tripped in error.details[].violations[].quotaId, e.g.
 * "GenerateRequestsPerDayPerProjectPerModel-FreeTier". Only a per-day or per-month
 * quota ends the engine for the run; everything else is a speed problem.
 */
export function namesSpentAllowance(body: string): boolean {
  return /"quotaId":\s*"[^"]*per[\s_-]*(day|month)/i.test(body);
}

/**
 * How long to wait before retrying a 429, or null when retrying is not worth it.
 * A spent allowance never gets a wait, however inviting its retryDelay looks: the
 * named quota wins over the hint, or we burn a call to be refused again.
 */
export function retryAfterMs(body: string, headers: Headers): number | null {
  if (namesSpentAllowance(body)) return null;
  const hinted =
    body.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/)?.[1] ?? headers.get("retry-after");
  // No hint at all: still a speed problem as far as we can tell, so wait one gap
  // rather than condemning the engine on a message we could not parse.
  const seconds = hinted == null ? null : Number(hinted);
  const ms =
    seconds != null && Number.isFinite(seconds)
      ? Math.ceil(seconds * 1000)
      : MIN_REQUEST_GAP_MS;
  if (ms > MAX_RETRY_WAIT_MS) return null;
  return Math.max(ms, MIN_REQUEST_GAP_MS);
}

/**
 * Shared request path: book a paced slot from the ledger, wait for it, fire, and ride
 * out a rate limit a couple of times. Returns the response when it is usable, null on
 * anything that costs only this prompt, and raises EngineQuotaError only when the
 * provider says the day's allowance is gone.
 */
async function engineFetch(
  engine: Engine,
  model: string,
  url: string,
  init: RequestInit,
  attempt = 0,
): Promise<Response | null> {
  // First attempt reserves a slot; retries are already paid for by the wait the
  // provider asked us to serve, so they do not book a second one.
  if (attempt === 0) {
    const slot = await reserveEngineCall(engine, model);
    if (!slot) {
      logger.log("ai-visibility: daily budget spent for model, skipping prompt", {
        engine,
        model,
      });
      return null;
    }
    const wait = slot.getTime() - Date.now();
    if (wait > 0) await sleep(wait);
  }

  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS) });
  if (res.ok) return res;

  // Read enough to see the quota id (it sits past the 300 chars we log).
  const body = (await res.text()).slice(0, 2_000);
  logger.error(`ai-visibility: ${engine} request failed`, {
    status: res.status,
    model,
    body: body.slice(0, 300),
  });
  if (res.status !== 429) return null;

  if (namesSpentAllowance(body)) {
    // Their ledger beats ours: stop offering this model work for the rest of the day.
    await markModelExhausted(engine, model);
    throw new EngineQuotaError(engine, body.slice(0, 300), model);
  }

  const wait = attempt < MAX_RATE_LIMIT_RETRIES ? retryAfterMs(body, res.headers) : null;
  if (wait === null) return null; // costs this prompt only
  logger.warn(`ai-visibility: ${engine} rate limited, waiting it out`, {
    model,
    waitMs: wait,
    attempt: attempt + 1,
  });
  await sleep(wait);
  return engineFetch(engine, model, url, init, attempt + 1);
}

// Perplexity Sonar — a web-grounded answer engine with citations (the cheapest,
// most "answer-native" first engine). Model is overridable via env; defaults to the
// base `sonar` (lowest per-request search fee).
async function queryPerplexity(prompt: string, modelKey: string): Promise<EngineAnswer | null> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    logger.warn("ai-visibility: PERPLEXITY_API_KEY not set, skipping perplexity");
    return null;
  }
  const model = pickModel(engineModels("perplexity"), modelKey);
  try {
    const res = await engineFetch("perplexity", model, "https://api.perplexity.ai/chat/completions", {
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
//
// AI_VISIBILITY_GEMINI_MODELS may list several pinned models: the request cap is per
// model, so each one is a separate free allowance on the same key. `pickModel` keeps a
// given prompt on a given model, because two models disagree about which brands they
// name and a prompt that changed writer would read as a share-of-voice move.
async function queryGemini(prompt: string, modelKey: string): Promise<EngineAnswer | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.warn("ai-visibility: GEMINI_API_KEY not set, skipping gemini");
    return null;
  }
  const model = pickModel(engineModels("gemini"), modelKey);
  try {
    const res = await engineFetch(
      "gemini",
      model,
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

/**
 * `modelKey` decides which of the engine's models answers, and must be STABLE for a
 * given tracked prompt (its row id) so its trend keeps one writer. Callers with no
 * durable id pass the prompt text, which is stable for as long as the text is.
 */
export async function queryEngine(
  engine: Engine,
  prompt: string,
  modelKey: string = prompt,
): Promise<EngineAnswer | null> {
  switch (engine) {
    case "perplexity":
      return queryPerplexity(prompt, modelKey);
    case "gemini":
      return queryGemini(prompt, modelKey);
    default:
      return null;
  }
}
