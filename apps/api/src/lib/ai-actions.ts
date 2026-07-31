import { getRedis, aiActionsPerHour, type Plan } from "@outrival/shared";
import { errorBody } from "./errors";

// Hourly anti-abuse budget for DISCRETIONARY AI actions, counted per USER in Upstash:
// battle cards, Ask questions, discovery, profile analysis, repeat re-scrapes. It is
// the blunt safety net BELOW the intelligent (staleness) rate limiting, so it must sit
// far above real use — see PLAN_LIMITS.aiActionsPerHour for how the numbers are set.
// No Upstash → every call is allowed and the budget reads as untouched (dev).

const WINDOW_SEC = Number(process.env.AI_INTENSIVE_WINDOW_SEC ?? 3600);

const keyFor = (userId: string) => `ratelimit:ai_intensive:${userId}`;

export interface AiActionOutcome {
  allowed: boolean;
  used: number;
  limit: number;
  retryAfterSeconds: number;
}

/** Spend one action from `userId`'s hourly budget. */
export async function consumeAiAction(userId: string, plan: Plan): Promise<AiActionOutcome> {
  const limit = aiActionsPerHour(plan);
  const redis = getRedis();
  if (!redis) return { allowed: true, used: 0, limit, retryAfterSeconds: 0 };

  const key = keyFor(userId);
  const used = await redis.incr(key);
  if (used === 1) await redis.expire(key, WINDOW_SEC);
  if (used <= limit) return { allowed: true, used, limit, retryAfterSeconds: 0 };

  const ttl = await redis.ttl(key);
  return { allowed: false, used, limit, retryAfterSeconds: ttl > 0 ? ttl : WINDOW_SEC };
}

/**
 * Current spend without charging for it — what the usage page shows. Reads the same
 * key the gate increments, so the number on screen is the number that will refuse the
 * next click, never a parallel estimate of it.
 */
export async function peekAiActions(userId: string, plan: Plan): Promise<{ used: number; limit: number }> {
  const limit = aiActionsPerHour(plan);
  const redis = getRedis();
  if (!redis) return { used: 0, limit };
  const used = await redis.get<number>(keyFor(userId)).catch(() => null);
  return { used: Number(used ?? 0), limit };
}

/** Structured 429 for a spent budget — the web maps `ai_rate_limit_exceeded` to a toast. */
export function aiRateLimitBody(outcome: AiActionOutcome) {
  const mins = Math.max(1, Math.ceil(outcome.retryAfterSeconds / 60));
  return errorBody(
    "ai_rate_limit_exceeded",
    `You've used this hour's ${outcome.limit} AI actions. The cap protects shared AI capacity and resets on its own: try again in about ${mins} minute${mins > 1 ? "s" : ""}. Scheduled scans keep running.`,
    { userAction: "wait", retryAfterSeconds: outcome.retryAfterSeconds },
  );
}
