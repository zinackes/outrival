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
  });

export const env = EnvSchema.parse(process.env);
