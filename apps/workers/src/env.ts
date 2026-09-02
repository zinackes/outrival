import { z } from "zod";
import { SECTORAL_MIN_COMPETITORS } from "@outrival/shared";

// Required for the whole worker pipeline. Missing any of these is a deployment
// misconfiguration we want to surface loudly at boot (src/queue/worker.ts calls this
// before registering a single handler) rather than three retries deep inside a job.
const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Feature/best-effort secrets. Not required to boot (a worker without GROQ
  // still scrapes; AI jobs fail clearly on use), but validated for format when
  // present so a malformed value is caught early. QUEUE_DATABASE_URL and
  // WORKER_ROLE are deliberately absent: src/queue/worker.ts hard-requires both
  // before it calls this, so declaring them optional here said the opposite of what
  // boot actually enforces.
  GROQ_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EXA_API_KEY: z.string().optional(),
  POSTHOG_API_KEY: z.string().optional(),
  // AES-256-GCM key (32 bytes, 64 hex chars) decrypting the CRM destination signing
  // secrets at rest (code:SEC-08). Same value as the API's. Unset → an encrypted
  // destination is skipped with a logged error instead of pushing unsigned.
  OAUTH_TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "OAUTH_TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes)")
    .optional(),
  // Trustpilot official API key (Reviews v2). The trustpilot_public scraper reads the
  // surface (score/count/distribution) via the official API — there is no keyless
  // public endpoint and no scraping fallback. Unset → the scraper throws cleanly.
  TRUSTPILOT_API_KEY: z.string().optional(),

  // Scraping cascade egress (collection doctrine). Optional: a missing datacenter
  // tier degrades to the direct IP (best-effort), so the worker still boots without
  // a proxy. The datacenter egress is chosen upstream, never in reaction to a block.
  PROXYSCRAPE_DC_ENDPOINT: z.string().optional(),
  PROXYSCRAPE_DC_USERNAME: z.string().optional(),
  PROXYSCRAPE_DC_PASSWORD: z.string().optional(),
  SCRAPING_LEVEL_1_ENABLED: z.string().optional(),
  SCRAPE_MIN_DOMAIN_GAP_MS: z.coerce.number().int().positive().optional(),

  // Sectoral analysis (patch-13). Runtime knobs with sane defaults so a missing
  // env never breaks the weekly job. The cron itself is static (Mon 07:00 UTC).
  SECTORAL_MIN_COMPETITORS: z.coerce.number().int().min(2).default(SECTORAL_MIN_COMPETITORS),
  SECTORAL_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),
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
