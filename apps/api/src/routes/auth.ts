import { Hono } from "hono";
import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { emailSchema, validatePasswordWithHibp } from "@outrival/shared";
import { db } from "../lib/db";
import { users, account } from "@outrival/db";
import { auth } from "../lib/auth";
import { verifyTurnstileToken } from "../lib/turnstile";
import { captureServerEvent, identifyUser } from "../lib/posthog";
import { authRateLimit } from "../middleware/auth-rate-limit";
import { authMiddleware } from "../middleware/auth";
import { errorBody } from "../lib/errors";
import { verifyReauthCode } from "../lib/reauth";
import { isDisposableEmail } from "../lib/disposable-email";

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

  // Block throwaway inboxes here for a clean, immediate error (the comprehensive
  // blocklist lives server-side; emailSchema only carries a tiny curated set for
  // client feedback). Same generic shape as the format failure above — it leaks
  // nothing about the account, only that the domain is unusable. lib/auth.ts
  // backstops every other creation path (direct OTP send, /sign-up/email).
  if (isDisposableEmail(email)) {
    return c.json(
      errorBody("invalid_email", "That email address can't be used. Try another one.", {
        userAction: "retry",
      }),
      400,
    );
  }

  // Best-effort analytics only — never branches the HTTP response below.
  const existing = await db.query.users
    .findFirst({ where: eq(users.email, email) })
    .catch(() => undefined);

  // Suspended accounts (operator lock-out) never get a code. The HTTP response
  // below stays identical either way, so suspension never leaks via this endpoint.
  try {
    if (!existing?.suspendedAt) {
      await auth.api.sendVerificationOTP({
        headers: c.req.raw.headers,
        body: { email, type: "sign-in" },
      });
    }
  } catch (err) {
    // Swallow — still return the identical generic response so existence never leaks.
    console.error("sign-in code send failed", { email, err });
  }

  void captureServerEvent(
    existing?.id ?? email,
    existing ? "user_logged_in" : "user_signed_up",
    { method: "email_otp" },
  );

  if (existing) {
    identifyUser(existing.id, { email: existing.email, name: existing.name ?? undefined });
  }

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
    const { headers, response } = await auth.api.signInEmailOTP({
      headers: c.req.raw.headers,
      body: { email, otp: code },
      returnHeaders: true,
    });
    // 2FA-enabled accounts: the auth hook swapped the freshly created session
    // for a short-lived `two_factor` challenge cookie (carried in `headers`).
    // Land on the /auth TOTP step instead of the dashboard, where the user
    // enters their code to finish signing in.
    const twoFactorPending =
      !!response &&
      typeof response === "object" &&
      "twoFactorRedirect" in response;
    const dest = twoFactorPending
      ? `${webUrl}/auth?twofactor=1`
      : `${webUrl}/dashboard`;
    const redirect = c.redirect(dest, 302);
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
 *
 * Step-up re-auth: setting a password from an open session would otherwise let a
 * hijacked session plant a permanent credential without proving identity (OWASP:
 * re-authenticate before any credential change). We require the same emailed code
 * as the danger-zone deletes, so the attacker would also need the inbox.
 */
authRouter.post("/set-password", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = (await c.req.json().catch(() => ({}))) as {
    newPassword?: unknown;
    currentPassword?: unknown;
    code?: unknown;
  };
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";
  const code = typeof body.code === "string" ? body.code : "";

  const check = await validatePasswordWithHibp(newPassword);
  if (!check.valid) {
    return c.json(errorBody("weak_password", check.reason, { userAction: "retry" }), 400);
  }

  const credential = await db.query.account.findFirst({
    where: and(eq(account.userId, user.id), eq(account.providerId, "credential")),
    columns: { id: true, password: true },
  });

  // Checked before burning the single-use code so a missing current password
  // doesn't cost the user their confirmation code.
  if (credential?.password && !currentPassword) {
    return c.json(
      errorBody("current_password_required", "Enter your current password.", {
        userAction: "retry",
      }),
      400,
    );
  }

  if (!(await verifyReauthCode(user.id, code))) {
    return c.json(
      errorBody("reauth_failed", "That confirmation code is invalid or expired.", {
        userAction: "retry",
      }),
      400,
    );
  }

  try {
    if (credential?.password) {
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

/**
 * Disconnect a linked OAuth provider (e.g. Google) from Settings > Security.
 * Better Auth's own /account/unlink-account requires a session fresher than
 * freshAge (24h) — unusable with our 30-day sessions — so we delete the linked
 * account row directly. No lockout risk: email-OTP sign-in needs no account row,
 * so it always remains as a way in. Never touches the "credential" account
 * (that's the password, managed by /set-password).
 */
authRouter.post("/disconnect-oauth", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = (await c.req.json().catch(() => ({}))) as { providerId?: unknown };
  const providerId = typeof body.providerId === "string" ? body.providerId : "";
  if (!providerId || providerId === "credential") {
    return c.json(
      errorBody("invalid_provider", "That account can't be disconnected here."),
      400,
    );
  }

  const rows = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, user.id), eq(account.providerId, providerId)));
  if (rows.length === 0) {
    return c.json(
      errorBody("account_not_found", "That account isn't connected."),
      404,
    );
  }

  await db
    .delete(account)
    .where(and(eq(account.userId, user.id), eq(account.providerId, providerId)));
  return c.json({ ok: true });
});

/**
 * Regenerate the 2FA recovery (backup) codes from Settings > Security. Generating
 * a fresh set invalidates the previous one (Better Auth), so this is a credential
 * change — gated by the same emailed step-up code as /set-password and the danger
 * zone, not just an open session. Only reachable with 2FA already on; the codes
 * are returned once and shown to the user, never stored client-side.
 */
authRouter.post("/regenerate-backup-codes", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = (await c.req.json().catch(() => ({}))) as { code?: unknown };
  const code = typeof body.code === "string" ? body.code : "";

  if (!(await verifyReauthCode(user.id, code))) {
    return c.json(
      errorBody("reauth_failed", "That confirmation code is invalid or expired.", {
        userAction: "retry",
      }),
      400,
    );
  }

  try {
    const res = await auth.api.generateBackupCodes({
      headers: c.req.raw.headers,
      body: {},
    });
    const backupCodes = (res as { backupCodes?: string[] }).backupCodes ?? [];
    return c.json({ backupCodes });
  } catch {
    return c.json(
      errorBody("backup_codes_failed", "Couldn't regenerate the recovery codes. Try again.", {
        userAction: "retry",
      }),
      400,
    );
  }
});
