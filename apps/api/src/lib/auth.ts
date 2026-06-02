import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import { users } from "@outrival/db";
import * as schema from "@outrival/db";
import { sendMagicLinkEmail } from "./magic-link-email";

const MAGIC_LINK_TTL_SECONDS = 600; // 10 minutes

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
    magicLink({
      expiresIn: MAGIC_LINK_TTL_SECONDS,
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLinkEmail({
          to: email,
          url,
          expiresInMinutes: Math.round(MAGIC_LINK_TTL_SECONDS / 60),
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
