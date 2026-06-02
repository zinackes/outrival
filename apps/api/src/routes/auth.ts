import { Hono } from "hono";
import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { emailSchema } from "@outrival/shared";
import { db } from "../lib/db";
import { users } from "@outrival/db";
import { auth } from "../lib/auth";
import { verifyTurnstileToken } from "../lib/turnstile";
import { captureServerEvent } from "../lib/posthog";
import { authRateLimit } from "../middleware/auth-rate-limit";
import { errorBody } from "../lib/errors";

export const authRouter = new Hono();

function clientIp(c: Context): string {
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/**
 * Unified entry point for the /auth page. Sends a magic link whether or not the
 * account exists (Better Auth creates the account on verify), and ALWAYS returns
 * the same response — an attacker cannot tell from the HTTP response whether an
 * email is registered (anti-enumeration ABSOLUE).
 *
 * The only non-generic responses are about the request itself (bad captcha,
 * malformed/disposable email) — never about account existence.
 */
authRouter.post("/check-and-send-magic-link", authRateLimit, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    email?: unknown;
    turnstileToken?: unknown;
  };

  const turnstileToken =
    typeof body.turnstileToken === "string" ? body.turnstileToken : undefined;
  const turnstileOk = await verifyTurnstileToken(turnstileToken, clientIp(c));
  if (!turnstileOk) {
    return c.json(
      errorBody(
        "captcha_failed",
        "We couldn't verify you're human. Refresh the page and try again.",
        { userAction: "retry" },
      ),
      400,
    );
  }

  const parsed = emailSchema.safeParse(body.email);
  if (!parsed.success) {
    // Generic on purpose — don't reveal the specific reason (format vs disposable).
    return c.json(
      errorBody("invalid_email", "That email address can't be used. Try another one.", {
        userAction: "retry",
      }),
      400,
    );
  }
  const email = parsed.data;

  // Best-effort analytics only — never branches the HTTP response below.
  const existing = await db.query.users
    .findFirst({ where: eq(users.email, email) })
    .catch(() => undefined);

  try {
    await auth.api.signInMagicLink({
      headers: c.req.raw.headers,
      body: {
        email,
        callbackURL: `${process.env.WEB_URL ?? "http://localhost:3000"}/dashboard`,
      },
    });
  } catch (err) {
    // Swallow — still return the identical generic response so existence never leaks.
    console.error("magic link send failed", { email, err });
  }

  void captureServerEvent(
    existing?.id ?? email,
    existing ? "user_logged_in" : "user_signed_up",
    { method: "magic_link" },
  );

  return c.json({
    ok: true,
    message: "If that email is valid, a sign-in link is on its way.",
  });
});
