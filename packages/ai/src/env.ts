import { z } from "zod";

const EnvSchema = z.object({
  GROQ_API_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().optional(),
});

let cached: z.infer<typeof EnvSchema> | null = null;

export function aiEnv(): z.infer<typeof EnvSchema> {
  if (!cached) cached = EnvSchema.parse(process.env);
  return cached;
}
