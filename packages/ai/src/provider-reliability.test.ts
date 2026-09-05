import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { redis } from "@outrival/shared";
import { complete } from "./provider";
import { checkGlobalBreaker } from "./provider/circuit-breaker";

// Exercise the real SDK and pool; only HTTP and Redis are replaced. No provider,
// Redis or ops webhook can be contacted by these fault-injection tests.
const realRedis = { ...redis };
const realFetch = globalThis.fetch;
const savedEnv = new Map<string, string | undefined>();
const store = new Map<string, { value: string; expires: number }>();
let now = 0;
let requests: string[] = [];
let statuses: Record<string, number | "connection" | "timeout"> = {};

function live(key: string) {
  const row = store.get(key);
  return row && row.expires > now ? row.value : null;
}

beforeEach(() => {
  store.clear();
  requests = [];
  statuses = {};
  now = 0;
  const keys = new Set([
    ...Object.keys(process.env).filter((key) => key.startsWith("AI_PROVIDER_")),
    "GROQ_API_KEY", "OPS_SLACK_WEBHOOK_URL", "AI_CIRCUIT_BREAKER_THRESHOLD",
    "AI_CIRCUIT_BREAKER_RESET_MIN",
    ...[1, 2].flatMap((i) => ["ID", "API_KEY", "BASE_URL", "MODEL", "PRIORITY"]
      .map((suffix) => `AI_PROVIDER_${i}_${suffix}`)),
  ]);
  for (const key of keys) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env.AI_CIRCUIT_BREAKER_THRESHOLD = "2";
  process.env.AI_CIRCUIT_BREAKER_RESET_MIN = "1";
  for (const [index, id] of ["out278-a", "out278-b"].entries()) {
    const prefix = `AI_PROVIDER_${index + 1}_`;
    process.env[`${prefix}ID`] = id;
    process.env[`${prefix}API_KEY`] = "test-only";
    process.env[`${prefix}BASE_URL`] = `https://${id}.invalid/v1`;
    process.env[`${prefix}MODEL`] = "test-model";
    process.env[`${prefix}PRIORITY`] = String(index);
  }
  Object.assign(redis, {
    get: async (key: string) => live(key),
    mget: async (...keys: string[]) => keys.map(live),
    set: async (key: string, value: unknown, opts?: { ex: number }) => {
      store.set(key, { value: String(value), expires: opts ? now + opts.ex * 1000 : Infinity });
      return "OK";
    },
    incr: async (key: string) => {
      const value = Number(live(key) ?? 0) + 1;
      store.set(key, { value: String(value), expires: Infinity });
      return value;
    },
    incrby: async (key: string, amount: number) => {
      const value = Number(live(key) ?? 0) + amount;
      store.set(key, { value: String(value), expires: store.get(key)?.expires ?? Infinity });
      return value;
    },
    expire: async (key: string, seconds: number) => {
      const row = store.get(key);
      if (row) row.expires = now + seconds * 1000;
      return row ? 1 : 0;
    },
    del: async (...keys: string[]) => keys.reduce((n, key) => n + Number(store.delete(key)), 0),
    ttl: async (key: string) => live(key) === null ? -2 : Math.ceil((store.get(key)!.expires - now) / 1000),
  });
  globalThis.fetch = Object.assign(mock(async (input: string | URL | Request) => {
    const host = new URL(input instanceof Request ? input.url : String(input)).hostname;
    if (!host.startsWith("out278-")) throw new Error(`Unexpected HTTP destination: ${host}`);
    requests.push(host);
    const status = statuses[host] ?? 200;
    if (status === "connection") throw new TypeError("fetch failed");
    if (status === "timeout") throw new DOMException("request timed out", "AbortError");
    return Response.json(status === 200 ? {
      choices: [{ message: { content: "recovered" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    } : { error: { message: `injected ${status}` } }, {
      status,
      // Keep SDK retry delays out of this test: verify the pool's failover walk.
      headers: { "x-should-retry": "false", "retry-after": "1" },
    });
  }), { preconnect: realFetch.preconnect });
});

afterEach(() => {
  Object.assign(redis, realRedis);
  globalThis.fetch = realFetch;
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
});

const request = () => complete({ provider: "groq", model: "ignored" }, { prompt: "test", maxTokens: 16 });

describe("OUT-278 HTTP fault injection and recovery", () => {
  for (const status of [402, 429, 503]) {
    test(`${status} fails over once and a healthy provider clears the failure streak`, async () => {
      statuses["out278-a.invalid"] = status;
      store.set("ai:failures:global", { value: "1", expires: Infinity });
      expect(await request()).toBe("recovered");
      expect(requests).toEqual(["out278-a.invalid", "out278-b.invalid"]);
      expect(live("ai:failures:global")).toBeNull();
      expect((await checkGlobalBreaker()).open).toBe(false);
    });
  }

  for (const fault of ["connection", "timeout"] as const) {
    test(`${fault} failure in the SDK fails over to a healthy provider`, async () => {
      statuses["out278-a.invalid"] = fault;
      expect(await request()).toBe("recovered");
      expect(requests).toEqual(["out278-a.invalid", "out278-b.invalid"]);
    });
  }

  test("billing exhaustion is observable, fails fast while parked, and recovers after expiry", async () => {
    statuses = { "out278-a.invalid": 402, "out278-b.invalid": 402 };
    await expect(request()).rejects.toThrow("ai_out_of_credit");
    expect(requests).toHaveLength(2);
    expect((await checkGlobalBreaker()).reason).toBe("ai_out_of_credit");
    await expect(request()).rejects.toThrow("ai_out_of_credit");
    expect(requests).toHaveLength(2);
    now += 61_000;
    statuses = {};
    expect(await request()).toBe("recovered");
    expect((await checkGlobalBreaker()).open).toBe(false);
  });

  test("a full outage counts failed tasks, trips at threshold, then recovers", async () => {
    statuses = { "out278-a.invalid": 503, "out278-b.invalid": 503 };
    await expect(request()).rejects.toThrow("all_providers_failed");
    expect(live("ai:failures:global")).toBe("1");
    await expect(request()).rejects.toThrow("no_providers_available");
    expect(requests).toHaveLength(2);
    expect((await checkGlobalBreaker()).open).toBe(true);
    now += 61_000;
    statuses = {};
    expect(await request()).toBe("recovered");
    expect(live("ai:failures:global")).toBeNull();
  });

  test("rate-limited providers become usable after their short park", async () => {
    statuses = { "out278-a.invalid": 429, "out278-b.invalid": 429 };
    await expect(request()).rejects.toThrow("all_providers_failed");
    expect(requests).toHaveLength(2);
    expect((await checkGlobalBreaker()).open).toBe(false);
    now += 2_000;
    statuses = {};
    expect(await request()).toBe("recovered");
  });
});
