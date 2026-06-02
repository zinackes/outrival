import { createMiddleware } from "hono/factory";
import { getRedis } from "@outrival/shared";
import { errorBody } from "../lib/errors";

// Hard anti-abuse cap on AI-intensive actions per user (patch-22): battle card
// generation, discovery, manual re-scrape, onboarding URL analysis. This is the
// blunt safety net BELOW the intelligent (staleness) rate limiting — it only ever
// trips a malicious or runaway client, never normal use. Read routes are never
// gated. Backed by Upstash; degrades to a no-op when Upstash isn't configured (dev).
// Apply AFTER authMiddleware so c.get("user") is set.

const LIMIT = Number(process.env.AI_INTENSIVE_RATE_LIMIT ?? 10);
const WINDOW_SEC = Number(process.env.AI_INTENSIVE_WINDOW_SEC ?? 3600);

export const aiIntensiveRateLimit = createMiddleware<{
  Variables: { user: { id: string } };
}>(async (c, next) => {
  const redis = getRedis();
  if (!redis) return next(); // no Upstash → skip silently (dev)

  const userId = c.get("user")?.id;
  if (!userId) return next(); // unauthenticated → authMiddleware handles it

  const key = `ratelimit:ai_intensive:${userId}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, WINDOW_SEC);

  if (count > LIMIT) {
    const ttl = await redis.ttl(key);
    const mins = Math.max(1, Math.ceil((ttl > 0 ? ttl : WINDOW_SEC) / 60));
    return c.json(
      errorBody(
        "ai_rate_limit_exceeded",
        `You've hit the cap of ${LIMIT} AI actions per hour. This limit protects shared AI capacity; it resets automatically — try again in about ${mins} minute${mins > 1 ? "s" : ""}.`,
        { userAction: "wait", retryAfterSeconds: ttl > 0 ? ttl : WINDOW_SEC },
      ),
      429,
    );
  }

  return next();
});
