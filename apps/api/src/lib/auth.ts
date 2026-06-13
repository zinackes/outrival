import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import { users } from "@outrival/db";
import * as schema from "@outrival/db";
import { sendSignInCodeEmail } from "./sign-in-email";

const SIGN_IN_OTP_TTL_SECONDS = 600; // 10 minutes

// Web origins allowed for OAuth/magic-link redirects (callbackURL validation).
const trustedOrigins = [
  "http://localhost:3000",
  ...(process.env.WEB_URL ? [process.env.WEB_URL] : []),
];

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL!,
  trustedOrigins,

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
      sendVerificationOTP: async ({ email, otp, type }) => {
        if (type !== "sign-in") return; // only the sign-in OTP is used
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
  ],

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
