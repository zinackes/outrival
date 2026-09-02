import { z } from "zod";

export const EnvSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url(),
    PORT: z.coerce.number().default(3001),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    // Upstash backs the HARD rate limiters: authRateLimit (anti-OTP-brute-force,
    // per email+IP) and aiIntensiveRateLimit (anti-AI-abuse). Both no-op when these
    // are absent — tolerable in dev/test, a silent security hole in prod. Required
    // in production (fail-boot via the refine below) so a misconfigured deploy fails
    // loudly instead of running with rate-limiting silently disabled.
    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
    // Managed Turnstile secret. verifyTurnstileToken() bypasses (returns true) when
    // this is unset — fine in dev, a silent captcha hole in prod (auth OTP + contact
    // form). Required in production via the refine below, same rationale as Upstash.
    TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
    // Shared secret for worker→API internal calls (standing-query re-evaluation).
    // Unset → the /api/internal/* routes answer 404 and workers skip re-evaluation
    // (the feature degrades to "saved but never re-evaluated", never a crash).
    INTERNAL_API_SECRET: z.string().min(16).optional(),
    // Trustpilot official API key (Reviews v2). The trustpilot_public source reads the
    // surface (score/count/distribution) via the official API — there is no keyless
    // public endpoint. Unset → the enable route refuses trustpilot_public (clean
    // degradation) and the scraper throws; never a scraping fallback.
    TRUSTPILOT_API_KEY: z.string().min(1).optional(),
    // AES-256-GCM key (32 bytes, 64 hex chars) encrypting the secrets this product
    // stores: third-party OAuth tokens in `oauth_connections`, and the CRM webhook
    // signing secret in `crm_destinations` (code:SEC-08). The workers box needs the
    // SAME value — it signs the outbound push. Optional on purpose: a boot-blocking
    // refine would break the deploy of every env that has no secret to protect yet.
    // Unset → the connect routes answer 500 `oauth_encryption_unconfigured`, saving a
    // CRM secret answers 500 `secret_encryption_unconfigured`, and nothing is ever
    // written in plaintext.
    OAUTH_TOKEN_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, "OAUTH_TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes)")
      .optional(),
  })
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === "production" && (!e.UPSTASH_REDIS_REST_URL || !e.UPSTASH_REDIS_REST_TOKEN)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["UPSTASH_REDIS_REST_URL"],
        message:
          "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production: " +
          "without them the auth and AI-intensive rate limiters silently no-op, disabling " +
          "anti-brute-force and anti-AI-abuse protection.",
      });
    }
    if (e.NODE_ENV === "production" && !e.TURNSTILE_SECRET_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["TURNSTILE_SECRET_KEY"],
        message:
          "TURNSTILE_SECRET_KEY is required in production: without it Turnstile " +
          "verification silently passes, disabling captcha on auth and the contact form.",
      });
    }
  });

export const env = EnvSchema.parse(process.env);
