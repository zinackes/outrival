import { Hono } from "hono";
import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { emailSchema, validatePasswordWithHibp } from "@outrival/shared";
import { db } from "../lib/db";
import { users, account } from "@outrival/db";
import { auth } from "../lib/auth";
import { verifyTurnstileToken } from "../lib/turnstile";
import { captureServerEvent } from "../lib/posthog";
import { authRateLimit } from "../middleware/auth-rate-limit";
import { authMiddleware } from "../middleware/auth";
import { errorBody } from "../lib/errors";

export const authRouter = new Hono<{ Variables: { user: { id: string } } }>();

function clientIp(c: Context): string {
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/**
 * Unified entry point for the /auth page. Sends a 6-digit sign-in code (and a
 * one-click link backed by the same code) whether or not the account exists —
 * Better Auth's emailOTP creates the account on verify when the email is new —
 * and ALWAYS returns the same response, so an attacker cannot tell from the HTTP
 * response whether an email is registered (anti-enumeration ABSOLUE).
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
    await auth.api.sendVerificationOTP({
      headers: c.req.raw.headers,
      body: { email, type: "sign-in" },
    });
  } catch (err) {
    // Swallow — still return the identical generic response so existence never leaks.
    console.error("sign-in code send failed", { email, err });
  }

  void captureServerEvent(
    existing?.id ?? email,
    existing ? "user_logged_in" : "user_signed_up",
    { method: "email_otp" },
  );

  return c.json({
    ok: true,
    message: "If that email is valid, a sign-in code is on its way.",
  });
});

/**
 * One-click sign-in link target. The sign-in email embeds this URL carrying the
 * same OTP as the code, so clicking it verifies the code server-side, sets the
 * session cookie, and lands the user on the dashboard — no code typing on the
 * device that opened the email. Invalid/expired/used codes fall back to /auth.
 *
 * The OTP is single-use and attempt-capped (Better Auth `allowedAttempts`), so
 * exposing it in the link doesn't lower the floor an attacker already faces on
 * the verify endpoint. Existence never leaks: any failure → the same redirect.
 */
authRouter.get("/otp-link", async (c) => {
  const email = c.req.query("email") ?? "";
  const code = c.req.query("code") ?? "";
  const webUrl = process.env.WEB_URL ?? "http://localhost:3000";
  if (!email || !code) {
    return c.redirect(`${webUrl}/auth?error=link_invalid`, 302);
  }

  try {
    const { headers } = await auth.api.signInEmailOTP({
      headers: c.req.raw.headers,
      body: { email, otp: code },
      returnHeaders: true,
    });
    const redirect = c.redirect(`${webUrl}/dashboard`, 302);
    for (const cookie of headers.getSetCookie()) {
      redirect.headers.append("set-cookie", cookie);
    }
    return redirect;
  } catch {
    return c.redirect(`${webUrl}/auth?error=link_invalid`, 302);
  }
});

/**
 * Set or change the account password from Settings > Security. Magic-link /
 * Google accounts have no credential account, so the password fallback on the
 * /auth page was unreachable for them until now. Length rules + HIBP breach
 * check (fail-open) before Better Auth persists anything; with an existing
 * password the current one is required and other sessions are revoked.
 */
authRouter.post("/set-password", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = (await c.req.json().catch(() => ({}))) as {
    newPassword?: unknown;
    currentPassword?: unknown;
  };
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";

  const check = await validatePasswordWithHibp(newPassword);
  if (!check.valid) {
    return c.json(errorBody("weak_password", check.reason, { userAction: "retry" }), 400);
  }

  const credential = await db.query.account.findFirst({
    where: and(eq(account.userId, user.id), eq(account.providerId, "credential")),
    columns: { id: true, password: true },
  });

  try {
    if (credential?.password) {
      if (!currentPassword) {
        return c.json(
          errorBody("current_password_required", "Enter your current password.", {
            userAction: "retry",
          }),
          400,
        );
      }
      await auth.api.changePassword({
        headers: c.req.raw.headers,
        body: { newPassword, currentPassword, revokeOtherSessions: true },
      });
    } else {
      await auth.api.setPassword({
        headers: c.req.raw.headers,
        body: { newPassword },
      });
    }
  } catch {
    // Better Auth throws on a wrong current password (and on edge cases like a
    // concurrent set). Generic message — don't oracle which check failed.
    return c.json(
      errorBody("password_update_failed", "Couldn't update the password. Check your current password and try again.", {
        userAction: "retry",
      }),
      400,
    );
  }

  return c.json({ ok: true, changed: Boolean(credential?.password) });
});
