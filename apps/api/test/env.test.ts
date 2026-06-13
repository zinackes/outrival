import { beforeAll, describe, expect, test } from "bun:test";
import type { z } from "zod";

// Security invariant (audit 2026-06-13): the hard rate limiters (authRateLimit,
// aiIntensiveRateLimit) silently no-op without Upstash. In production that
// disables anti-brute-force / anti-AI-abuse, so the env schema must FAIL to parse
// — making the API crash at boot instead of running insecure.

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "https://api.outrival.io",
};

// env.ts parses process.env at module load; seed the base vars so that import
// itself succeeds, then assert on the exported schema directly.
let EnvSchema: z.ZodTypeAny;
beforeAll(async () => {
  Object.assign(process.env, base);
  ({ EnvSchema } = await import("../src/env"));
});

describe("env Upstash fail-boot in production", () => {
  test("production WITHOUT Upstash fails to parse", () => {
    expect(EnvSchema.safeParse({ ...base, NODE_ENV: "production" }).success).toBe(false);
  });

  test("production with only the URL (no token) still fails", () => {
    const r = EnvSchema.safeParse({
      ...base,
      NODE_ENV: "production",
      UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
    });
    expect(r.success).toBe(false);
  });

  test("production WITH both Upstash creds parses", () => {
    const r = EnvSchema.safeParse({
      ...base,
      NODE_ENV: "production",
      UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "tok",
    });
    expect(r.success).toBe(true);
  });

  test("development without Upstash parses (no-op rate limiting is fine in dev)", () => {
    expect(EnvSchema.safeParse({ ...base, NODE_ENV: "development" }).success).toBe(true);
  });

  test("test env without Upstash parses (harness needs no Upstash)", () => {
    expect(EnvSchema.safeParse({ ...base, NODE_ENV: "test" }).success).toBe(true);
  });
});
