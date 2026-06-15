import { test, expect, afterAll } from "bun:test";
import { pickProvider } from "./provider-pool";

// Configure a deterministic two-provider pool (cerebras p1, groq p2) via env. No
// UPSTASH_* in the test env → the redis facade no-ops (mget → nulls), so this is
// exactly the Redis-less path where the per-provider breaker can't persist and
// in-loop failover must instead advance via pickProvider's `exclude` set.
const snapshot: Record<string, string | undefined> = {};
for (const k of Object.keys(process.env)) {
  if (k.startsWith("AI_PROVIDER_")) snapshot[k] = process.env[k];
}
for (const k of Object.keys(snapshot)) delete process.env[k];

process.env.AI_PROVIDER_1_ID = "cerebras";
process.env.AI_PROVIDER_1_BASE_URL = "https://api.cerebras.ai/v1";
process.env.AI_PROVIDER_1_API_KEY = "test-key-1";
process.env.AI_PROVIDER_1_MODEL = "llama-3.3-70b";
process.env.AI_PROVIDER_1_PRIORITY = "1";
process.env.AI_PROVIDER_2_ID = "groq";
process.env.AI_PROVIDER_2_BASE_URL = "https://api.groq.com/openai/v1";
process.env.AI_PROVIDER_2_API_KEY = "test-key-2";
process.env.AI_PROVIDER_2_MODEL = "openai/gpt-oss-120b";
process.env.AI_PROVIDER_2_PRIORITY = "2";

afterAll(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("AI_PROVIDER_")) delete process.env[k];
  }
  for (const [k, v] of Object.entries(snapshot)) {
    if (v !== undefined) process.env[k] = v;
  }
});

test("pickProvider returns the top-priority (free) provider by default", async () => {
  const p = await pickProvider();
  expect(p?.id).toBe("cerebras");
});

test("an excluded provider is skipped — Redis-independent failover to the next", async () => {
  const p = await pickProvider(new Set(["cerebras"]));
  expect(p?.id).toBe("groq");
});

test("when every provider is excluded, returns null (loop exhausts cleanly)", async () => {
  const p = await pickProvider(new Set(["cerebras", "groq"]));
  expect(p).toBeNull();
});
