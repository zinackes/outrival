import { test, expect, afterAll } from "bun:test";
import { pickProvider, checkProviderModels } from "./provider-pool";

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

// The pool above is, verbatim, the production configuration of 2026-07-22: Cerebras
// pinned to llama-3.3-70b, a model it does not serve. Nothing static could see it —
// the pool loaded two providers and looked healthy — and the first AI call surfaced it
// as a global breaker trip rather than as a bad variable. This check is what turns
// that into one readable line at boot.
const models = (ids: string[]) =>
  new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 });

const stub = (handler: (url: string) => Response | Promise<Response>): typeof fetch =>
  ((url: string | URL | Request) => Promise.resolve(handler(String(url)))) as typeof fetch;

const cerebrasReal = ["gemma-4-31b", "gpt-oss-120b", "zai-glm-4.7"];

test("names the provider, the missing model, and what it actually serves", async () => {
  const checks = await checkProviderModels(
    stub((url) =>
      url.startsWith("https://api.cerebras.ai")
        ? models(cerebrasReal)
        : models(["openai/gpt-oss-120b", "openai/gpt-oss-20b"]),
    ),
  );

  const cerebras = checks.find((c) => c.id === "cerebras")!;
  expect(cerebras.ok).toBe(false);
  expect(cerebras.detail).toContain("llama-3.3-70b"); // what we asked for
  expect(cerebras.detail).toContain("gpt-oss-120b"); // what it has instead

  expect(checks.find((c) => c.id === "groq")!.ok).toBe(true);
});

test("a fast model that the provider does not serve is caught too", async () => {
  process.env.AI_PROVIDER_2_FAST_MODEL = "openai/gpt-oss-20b";
  try {
    const checks = await checkProviderModels(
      stub((url) =>
        url.startsWith("https://api.cerebras.ai")
          ? models(cerebrasReal)
          : models(["openai/gpt-oss-120b"]), // 20b absent
      ),
    );
    const groq = checks.find((c) => c.id === "groq")!;
    expect(groq.ok).toBe(false);
    expect(groq.detail).toContain("openai/gpt-oss-20b");
  } finally {
    delete process.env.AI_PROVIDER_2_FAST_MODEL;
  }
});

// Fails OPEN, three ways. A diagnostic that cries wolf when it simply cannot see gets
// muted by whoever reads it, and then it is worth nothing on the day it is right.
test("a provider without a /models endpoint is not accused", async () => {
  const checks = await checkProviderModels(stub(() => new Response("nope", { status: 404 })));
  expect(checks.every((c) => c.ok)).toBe(true);
  expect(checks[0]!.detail).toContain("skipped");
});

test("an unreachable provider is not accused", async () => {
  const checks = await checkProviderModels(
    stub(() => {
      throw new Error("ECONNRESET");
    }),
  );
  expect(checks.every((c) => c.ok)).toBe(true);
  expect(checks[0]!.detail).toContain("ECONNRESET");
});

test("an empty model list is not accused", async () => {
  const checks = await checkProviderModels(stub(() => models([])));
  expect(checks.every((c) => c.ok)).toBe(true);
});
