import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { getRedis } from "@outrival/shared";
import { clientIp } from "../lib/client-ip";
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

/**
 * One hit on `key`, atomically. `INCR` then a conditional `EXPIRE` is two round
 * trips: a crash or a lost connection between them leaves the counter with no
 * TTL, so the bucket never resets and the caller is banned forever. Piping them
 * with `EXPIRE ... NX` sets the TTL on the first hit only, in the same
 * transaction as the increment.
 */
async function hit(redis: NonNullable<ReturnType<typeof getRedis>>, key: string): Promise<number> {
  const [count] = await redis
    .multi()
    .incr(key)
    .expire(key, WINDOW_SEC, "NX")
    .exec<[number, number]>();
  return count;
}

export const authRateLimit = createMiddleware(async (c, next) => {
  const redis = getRedis();
  if (!redis) return next(); // no Upstash → skip silently (dev)

  const body = (await c.req.json().catch(() => ({}))) as { email?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : null;

  // Fail CLOSED: with no trustworthy caller identity there is no bucket to
  // charge, and the old "unknown" fallback made every anonymous request share
  // one counter. Same generic 429 as a real trip, so a prober learns nothing.
  const ip = clientIp(c);
  if (!ip) return c.json(limitedResponse(), 429);

  const ipCount = await hit(redis, `ratelimit:auth:ip:${ip}`);
  if (ipCount > IP_MAX) return c.json(limitedResponse(), 429);

  if (email) {
    const emailCount = await hit(redis, `ratelimit:auth:email:${email}`);
    if (emailCount > EMAIL_MAX) return c.json(limitedResponse(), 429);
  }

  await next();
});

/**
 * IP-only variant for auth routes whose body is not JSON, so there is no email
 * to charge and reading the body would consume it before the handler. Same
 * keyspace and same generic response as `authRateLimit`.
 */
export function ipRateLimit(bucket: string) {
  return createMiddleware(async (c: Context, next) => {
    const redis = getRedis();
    if (!redis) return next();

    const ip = clientIp(c);
    if (!ip) return c.json(limitedResponse(), 429);

    const count = await hit(redis, `ratelimit:${bucket}:ip:${ip}`);
    if (count > IP_MAX) return c.json(limitedResponse(), 429);

    await next();
  });
}
