import { describe, expect, test } from "bun:test";
import {
  consumeUsage,
  getActiveModel,
  getActiveProvider,
  markModel,
  markProvider,
  markUsage,
  withAiContext,
} from "./provider-context";

const tick = () => new Promise((r) => setTimeout(r, 1));

// Simulates complete(): marks happen in a CHILD async frame, past a real async
// boundary — the exact pattern that lost the context on Bun and on the Trigger
// runtime (every prod ai_runs row had 0 tokens and a static model label).
async function completeLike(provider: string, model: string, tokens: number) {
  await tick();
  markProvider(provider);
  markModel(model);
  markUsage({ promptTokens: tokens, completionTokens: tokens, totalTokens: tokens * 2 });
}

describe("withAiContext", () => {
  test("marks made inside a child frame are readable at the log site after await", async () => {
    await withAiContext(async () => {
      await completeLike("cerebras", "gpt-oss-120b", 100);
      expect(getActiveProvider()).toBe("cerebras");
      expect(getActiveModel()).toBe("gpt-oss-120b");
      expect(consumeUsage().totalTokens).toBe(200);
    });
  });

  test("usage accumulates across calls and consumeUsage read-and-clears", async () => {
    await withAiContext(async () => {
      await completeLike("groq", "gpt-oss-20b", 10);
      await completeLike("groq", "gpt-oss-20b", 5);
      expect(consumeUsage().totalTokens).toBe(30);
      // Cleared: the next log point starts from zero.
      expect(consumeUsage().totalTokens).toBe(0);
    });
  });

  test("concurrent contexts do not cross-contaminate (parallel API requests)", async () => {
    const [a, b] = await Promise.all([
      withAiContext(async () => {
        await completeLike("cerebras", "gpt-oss-120b", 1);
        await tick();
        return { usage: consumeUsage().totalTokens, model: getActiveModel() };
      }),
      withAiContext(async () => {
        await completeLike("hyperbolic", "gpt-oss-20b", 1000);
        await tick();
        return { usage: consumeUsage().totalTokens, model: getActiveModel() };
      }),
    ]);
    expect(a).toEqual({ usage: 2, model: "gpt-oss-120b" });
    expect(b).toEqual({ usage: 2000, model: "gpt-oss-20b" });
  });

  test("the wrapped value passes through", async () => {
    expect(await withAiContext(async () => 42)).toBe(42);
  });
});
