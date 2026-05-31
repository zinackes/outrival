import { z } from "zod";

// Required for the whole worker pipeline. Missing any of these is a deployment
// misconfiguration we want to surface loudly at boot (via the `init` hook in
// trigger.config.ts) rather than three retries deep inside a job.
const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Feature/best-effort secrets. Not required to boot (a worker without GROQ
  // still scrapes; AI jobs fail clearly on use), but validated for format when
  // present so a malformed value is caught early.
  TRIGGER_SECRET_KEY: z.string().optional(),
  TRIGGER_PROJECT_ID: z.string().optional(),
  CLICKHOUSE_URL: z.string().url().optional(),
  CLICKHOUSE_PASSWORD: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  SCRAPINGBEE_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EXA_API_KEY: z.string().optional(),
  POSTHOG_API_KEY: z.string().optional(),
});

export type WorkerEnv = z.infer<typeof EnvSchema>;

let cached: WorkerEnv | null = null;

/**
 * Parse and validate the worker environment. Throws a single readable error
 * listing every invalid/missing variable. Cached after the first successful
 * call so it is cheap to invoke per run from the global `init` hook.
 */
export function validateWorkerEnv(): WorkerEnv {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid worker environment:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
