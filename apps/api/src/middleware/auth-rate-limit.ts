import { createMiddleware } from "hono/factory";
import { getRedis } from "@outrival/shared";
import { errorBody } from "../lib/errors";

// Auth-specific rate limiting, per email AND per IP, backed by Upstash. Degrades
// to a no-op when Upstash isn't configured (dev). The 429 response is IDENTICAL
// whether the email or the IP limit tripped — never leak which one, never leak
// whether the email exists (anti-enumeration).

const EMAIL_MAX = Number(process.env.AUTH_RATE_LIMIT_EMAIL ?? 3);
const IP_MAX = Number(process.env.AUTH_RATE_LIMIT_IP ?? 10);
const WINDOW_SEC = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MIN ?? 15) * 60;

const limitedResponse = () =>
  errorBody("rate_limited", "Too many attempts. Please wait 15 minutes before trying again.", {
    userAction: "wait",
    retryAfterSeconds: WINDOW_SEC,
  });

async function hit(redis: NonNullable<ReturnType<typeof getRedis>>, key: string): Promise<number> {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, WINDOW_SEC);
  return count;
}

export const authRateLimit = createMiddleware(async (c, next) => {
  const redis = getRedis();
  if (!redis) return next(); // no Upstash → skip silently (dev)

  const body = (await c.req.json().catch(() => ({}))) as { email?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : null;
  const ip =
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";

  const ipCount = await hit(redis, `ratelimit:auth:ip:${ip}`);
  if (ipCount > IP_MAX) return c.json(limitedResponse(), 429);

  if (email) {
    const emailCount = await hit(redis, `ratelimit:auth:email:${email}`);
    if (emailCount > EMAIL_MAX) return c.json(limitedResponse(), 429);
  }

  await next();
});
