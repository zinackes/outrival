import { betterAuth } from "better-auth";
import { emailOTP, twoFactor } from "better-auth/plugins";
import { createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import { users } from "@outrival/db";
import * as schema from "@outrival/db";
import { sendSignInCodeEmail, sendEmailChangeCodeEmail } from "./sign-in-email";

const SIGN_IN_OTP_TTL_SECONDS = 600; // 10 minutes

// Web origins allowed for OAuth/magic-link redirects (callbackURL validation).
const trustedOrigins = [
  "http://localhost:3000",
  ...(process.env.WEB_URL ? [process.env.WEB_URL] : []),
];

// Cross-subdomain session cookie. In production the web (outrival.io) and the
// API (api.outrival.io) are distinct origins on the SAME registrable site. The
// dashboard's server components fetch /api/auth/get-session and forward the
// INCOMING request's cookies — so the session cookie must be readable on the
// parent domain, or getSession() runs cookie-less and every request bounces to
// /auth. Host-only cookies only "work" in dev because localhost ignores the
// port. Set AUTH_COOKIE_DOMAIN to the registrable domain (e.g. "outrival.io");
// leave it unset in dev → host-only localhost cookie, behaviour unchanged.
const cookieDomain = process.env.AUTH_COOKIE_DOMAIN;

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL!,
  // Issuer shown in authenticator apps when a user scans the TOTP QR code.
  appName: "Outrival",
  trustedOrigins,

  ...(cookieDomain
    ? { advanced: { crossSubDomainCookies: { enabled: true, domain: cookieDomain } } }
    : {}),

  // Email + password kept as a fallback. Existing accounts (created before patch-19,
  // some with <12-char passwords) keep working: minPasswordLength is only enforced
  // when a password is SET, not on sign-in.
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 12,
  },

  // Google OAuth (secondary). Callback is derived from baseURL:
  // {BETTER_AUTH_URL}/api/auth/callback/google
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },

  plugins: [
    // Email OTP backs the unified /auth entry point. `disableSignUp` defaults to
    // false → signIn.emailOtp creates the account when the email is new, signs in
    // when it exists: login and signup are the SAME flow and the user never learns
    // which one happened (transparent, anti-enumeration). One email carries both
    // the 6-digit code and a one-click link (GET /api/auth/otp-link, same token).
    emailOTP({
      otpLength: 6,
      expiresIn: SIGN_IN_OTP_TTL_SECONDS,
      allowedAttempts: 3,
      // Lets a signed-in user move their account to a new email — an OTP is sent
      // to the NEW address and the email only changes once they confirm it.
      changeEmail: { enabled: true },
      sendVerificationOTP: async ({ email, otp, type }) => {
        if (type === "change-email") {
          // Goes to the new address the user is moving to.
          await sendEmailChangeCodeEmail({
            to: email,
            code: otp,
            expiresInMinutes: Math.round(SIGN_IN_OTP_TTL_SECONDS / 60),
          });
          return;
        }
        if (type !== "sign-in") return; // email-verification / forget-password unused
        const linkUrl = `${process.env.BETTER_AUTH_URL ?? ""}/api/auth/otp-link?email=${encodeURIComponent(
          email,
        )}&code=${otp}`;
        await sendSignInCodeEmail({
          to: email,
          code: otp,
          linkUrl,
          expiresInMinutes: Math.round(SIGN_IN_OTP_TTL_SECONDS / 60),
        });
      },
    }),

    // Authenticator-app 2FA (TOTP + backup codes). allowPasswordless lets our
    // magic-link / Google users (no credential account) enable and disable it
    // without a password. Verify-first: enabling returns a secret + backup codes
    // but only flips user.twoFactorEnabled once the user confirms a TOTP code,
    // so a user can never lock themselves out by abandoning setup.
    twoFactor({ issuer: "Outrival", allowPasswordless: true }),
  ],

  // The twoFactor plugin only intercepts /sign-in/email + /sign-in/username, so
  // out of the box TOTP would never be enforced on Outrival's PRIMARY logins
  // (email OTP, Google). This hook extends the plugin's own partial-sign-in to
  // those paths: when a 2FA-enabled user authenticates, we tear down the session
  // Better Auth just created and hand back the short-lived `two_factor` challenge
  // cookie instead, which the existing /two-factor/verify-totp endpoint consumes.
  // Safe-by-default: it early-returns for everyone without 2FA enabled, so it has
  // zero effect until a user opts in.
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      const isEmailOtp = ctx.path === "/sign-in/email-otp";
      const isSocialCallback = ctx.path.startsWith("/callback/");
      if (!isEmailOtp && !isSocialCallback) return;

      const data = ctx.context.newSession;
      if (!data || !data.user.twoFactorEnabled) return;

      // Replace the full session with a 2FA challenge — mirrors the plugin's hook
      // for password sign-in (better-auth/plugins/two-factor, v1.6.11).
      deleteSessionCookie(ctx, true);
      await ctx.context.internalAdapter.deleteSession(data.session.token);

      const maxAge = 600; // seconds — matches the plugin's twoFactorCookieMaxAge default
      const twoFactorCookie = ctx.context.createAuthCookie("two_factor", { maxAge });
      const identifier = `2fa-${crypto.randomUUID().replace(/-/g, "")}`;
      await ctx.context.internalAdapter.createVerificationValue({
        value: data.user.id,
        identifier,
        expiresAt: new Date(Date.now() + maxAge * 1000),
      });
      await ctx.setSignedCookie(
        twoFactorCookie.name,
        identifier,
        ctx.context.secret,
        twoFactorCookie.attributes,
      );

      if (isEmailOtp) {
        // Inline /auth fetch reads this and swaps to the TOTP step.
        return ctx.json({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
      }
      // OAuth callback is a redirect — bounce to the /auth TOTP interstitial
      // instead of the dashboard. The challenge cookie rides along on the 302.
      const webUrl = process.env.WEB_URL ?? "http://localhost:3000";
      throw ctx.redirect(`${webUrl}/auth?twofactor=1`);
    }),
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh the token daily
  },

  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await db
            .insert(users)
            .values({
              id: user.id,
              email: user.email,
              name: user.name ?? null,
            })
            .onConflictDoNothing();
        },
      },
    },
  },
});
