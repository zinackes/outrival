import { z } from "zod";

// The Groq/provider keys are read directly by the provider pool (provider-pool.ts,
// patch-22) from AI_PROVIDER_N_* / GROQ_API_KEY, so they are no longer validated
// here — the pool tolerates a partial config and degrades. Only Claude's key (the
// non-pool fallback provider) is read through this schema.
const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
});

let cached: z.infer<typeof EnvSchema> | null = null;

export function aiEnv(): z.infer<typeof EnvSchema> {
  if (!cached) cached = EnvSchema.parse(process.env);
  return cached;
}
