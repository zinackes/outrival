import { Hono } from "hono";
import { z } from "zod";
import { getRedis } from "@outrival/shared";
import { clientIp } from "../lib/client-ip";
import { sendDemoRequestEmail } from "../lib/contact-email";
import { verifyTurnstileToken } from "../lib/turnstile";
import { errorBody } from "../lib/errors";

// Public demo / sales contact form (landing /demo — "Request a demo" and the
// Business plan "Talk to sales" CTA). No auth: it's a lead form. Spam defences:
// managed Turnstile + a dedicated IP rate limit (its own Redis keyspace, no-op
// without Upstash) + a honeypot field.

export const contactRouter = new Hono();

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  company: z.string().trim().max(160).optional(),
  teamSize: z.string().trim().max(40).optional(),
  plan: z.string().trim().max(40).optional(),
  message: z.string().trim().max(4000).optional(),
  // Honeypot — hidden in the UI, so a non-empty value means a bot filled it.
  website: z.string().max(200).optional(),
  // Managed Turnstile token (bypassed server-side in dev when the secret is unset).
  turnstileToken: z.string().max(2048).optional(),
});

const WINDOW_SEC = 60 * 60; // 1h
const MAX_PER_IP = 5;

contactRouter.post("/", async (c) => {
  // Fail closed: no trustworthy caller identity, no bucket to charge. The old
  // "unknown" fallback gave every header-less caller the same counter, which is
  // both a bypass (forge a header, get a fresh bucket) and a shared-fate bug
  // (one spammer locks out a whole corporate proxy).
  const ip = clientIp(c);

  const redis = getRedis();
  if (redis) {
    const key = `ratelimit:contact:ip:${ip}`;
    // INCR + EXPIRE NX in one transaction: a counter that loses the race for
    // its TTL never resets and bans the caller for good.
    const [count] = ip
      ? await redis.multi().incr(key).expire(key, WINDOW_SEC, "NX").exec<[number, number]>()
      : [MAX_PER_IP + 1];
    if (count > MAX_PER_IP) {
      return c.json(
        errorBody("rate_limited", "Too many requests. Please try again later.", {
          userAction: "wait",
          retryAfterSeconds: WINDOW_SEC,
        }),
        429,
      );
    }
  }

  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      errorBody("invalid_request", "Please check the form and try again.", {
        userAction: "retry",
      }),
      400,
    );
  }

  const captchaOk = await verifyTurnstileToken(parsed.data.turnstileToken, ip);
  if (!captchaOk) {
    return c.json(
      errorBody("invalid_captcha", "Captcha verification failed. Please try again.", {
        userAction: "retry",
      }),
      400,
    );
  }

  // Honeypot tripped → act like success so bots don't learn they were caught.
  if (parsed.data.website) return c.json({ ok: true });

  const { website: _honeypot, turnstileToken: _token, ...req } = parsed.data;
  await sendDemoRequestEmail(req);
  return c.json({ ok: true });
});
