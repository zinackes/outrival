import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { redis, type SafeRedis } from "@outrival/shared";
import {
  AIUnavailableError,
  checkGlobalBreaker,
  recordFailure,
  recordSuccess,
  tripGlobalBreaker,
} from "./circuit-breaker";

// The global breaker is the switch that blanks AI for the whole product, and it had
// no test at all. Two failures matter in opposite directions: it never trips, so a
// dead pool is hammered for every job; or it trips too eagerly and every workspace
// loses AI over one bad provider. The state lives in Redis, so the tests swap the
// shared `redis` facade for an in-memory one — patching its methods rather than
// mock.module, so nothing leaks into another file (see apps/workers/CLAUDE.md).

type Store = Map<string, { value: string; expiresAt: number | null }>;

function fakeRedis(store: Store): SafeRedis {
  const live = (k: string) => {
    const row = store.get(k);
    if (!row) return null;
    if (row.expiresAt !== null && row.expiresAt <= Date.now()) {
      store.delete(k);
      return null;
    }
    return row;
  };
  return {
    async get<T = string>(key: string) {
      return (live(key)?.value ?? null) as T | null;
    },
    async set(key, value, opts) {
      store.set(key, {
        value: String(value),
        expiresAt: opts ? Date.now() + opts.ex * 1000 : null,
      });
      return "OK";
    },
    async incr(key) {
      const next = Number(live(key)?.value ?? 0) + 1;
      store.set(key, { value: String(next), expiresAt: live(key)?.expiresAt ?? null });
      return next;
    },
    async incrby(key, n) {
      const next = Number(live(key)?.value ?? 0) + n;
      store.set(key, { value: String(next), expiresAt: live(key)?.expiresAt ?? null });
      return next;
    },
    async expire(key, seconds) {
      const row = live(key);
      if (!row) return 0;
      store.set(key, { value: row.value, expiresAt: Date.now() + seconds * 1000 });
      return 1;
    },
    async mget<T = string>(...keys: string[]) {
      return keys.map((k) => (live(k)?.value ?? null) as T | null);
    },
    async del(...keys) {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    },
    async ttl(key) {
      const row = live(key);
      if (!row) return -2;
      if (row.expiresAt === null) return -1;
      return Math.ceil((row.expiresAt - Date.now()) / 1000);
    },
  };
}

/** What the facade really does with no Upstash configured (packages/shared/redis.ts). */
const NO_UPSTASH: SafeRedis = {
  async get() {
    return null;
  },
  async set() {
    return null;
  },
  async incr() {
    return 0;
  },
  async incrby() {
    return 0;
  },
  async expire() {
    return 0;
  },
  async mget<T = string>(...keys: string[]) {
    return keys.map(() => null as T | null);
  },
  async del() {
    return 0;
  },
  async ttl() {
    return -2;
  },
};

const REAL = { ...redis };
const ENV = ["AI_CIRCUIT_BREAKER_RESET_MIN", "AI_CIRCUIT_BREAKER_THRESHOLD", "OPS_SLACK_WEBHOOK_URL"] as const;
const savedEnv = new Map(ENV.map((k) => [k, process.env[k]]));

function useRedis(impl: SafeRedis) {
  Object.assign(redis, impl);
}

let store: Store;

beforeEach(() => {
  store = new Map();
  useRedis(fakeRedis(store));
  for (const k of ENV) delete process.env[k];
});

afterEach(() => {
  Object.assign(redis, REAL);
  for (const [k, v] of savedEnv) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("checkGlobalBreaker", () => {
  test("closed when nothing is parked", async () => {
    expect(await checkGlobalBreaker()).toEqual({ open: false });
  });

  test("open carries the reason and the remaining seconds", async () => {
    await tripGlobalBreaker("ai_out_of_credit");
    const state = await checkGlobalBreaker();
    expect(state.open).toBe(true);
    expect(state.reason).toBe("ai_out_of_credit");
    // Default reset is 10 minutes; the TTL is what the UI counts down from.
    expect(state.resetInSec).toBeGreaterThan(590);
    expect(state.resetInSec).toBeLessThanOrEqual(600);
  });

  test("a key with no expiry reports open without a countdown", async () => {
    store.set("ai:global_breaker", { value: "manual_hold", expiresAt: null });
    expect(await checkGlobalBreaker()).toEqual({
      open: true,
      reason: "manual_hold",
      resetInSec: undefined,
    });
  });

  test("it reopens on its own once the park expires", async () => {
    process.env.AI_CIRCUIT_BREAKER_RESET_MIN = "0.001"; // 60ms
    await tripGlobalBreaker("too_many_failures");
    expect((await checkGlobalBreaker()).open).toBe(true);
    await Bun.sleep(80);
    expect(await checkGlobalBreaker()).toEqual({ open: false });
  });
});

describe("tripGlobalBreaker", () => {
  test("AI_CIRCUIT_BREAKER_RESET_MIN sets how long AI stays paused", async () => {
    process.env.AI_CIRCUIT_BREAKER_RESET_MIN = "30";
    await tripGlobalBreaker("ai_provider_misconfigured");
    expect(await redis.ttl("ai:global_breaker")).toBeGreaterThan(1790);
  });

  // The ops ping is best-effort by construction. A webhook that is unset, dead or
  // pointed at an internal address must not stop the breaker from being recorded —
  // otherwise the one call that protects the pipeline fails because a Slack app was
  // uninstalled.
  test("a rejected ops webhook does not stop the breaker from tripping", async () => {
    process.env.OPS_SLACK_WEBHOOK_URL = "http://127.0.0.1:1/hooks/x"; // SSRF-rejected, no fetch
    await tripGlobalBreaker("too_many_failures");
    expect((await checkGlobalBreaker()).open).toBe(true);
  });

  // The threshold has to mean the same thing on the second trip as on the first.
  // The failure count outlives the park (10-minute window vs a 2-minute reset), so
  // unless the trip clears it the breaker comes back already loaded and one failure
  // re-parks AI for everyone.
  test("the park starts the streak over, so the threshold still applies after it", async () => {
    process.env.AI_CIRCUIT_BREAKER_THRESHOLD = "2";
    process.env.AI_CIRCUIT_BREAKER_RESET_MIN = "0.001"; // 60ms
    await recordFailure("groq-1");
    await recordFailure("groq-1");
    expect((await checkGlobalBreaker()).open).toBe(true);
    await Bun.sleep(80);
    expect((await checkGlobalBreaker()).open).toBe(false);
    // One failure is not two: the count restarts, it does not resume at the threshold.
    await recordFailure("groq-1");
    expect((await checkGlobalBreaker()).open).toBe(false);
  });
});

describe("recordFailure", () => {
  test("stays closed below the threshold", async () => {
    for (let i = 0; i < 4; i++) await recordFailure("groq-1");
    expect(await checkGlobalBreaker()).toEqual({ open: false });
  });

  test("trips on the fifth failure and names the provider", async () => {
    for (let i = 0; i < 5; i++) await recordFailure("groq-1");
    const state = await checkGlobalBreaker();
    expect(state.open).toBe(true);
    expect(state.reason).toBe("too_many_failures:groq-1");
  });

  test("without a provider id the reason is still specific enough to act on", async () => {
    for (let i = 0; i < 5; i++) await recordFailure();
    expect((await checkGlobalBreaker()).reason).toBe("too_many_failures");
  });

  test("AI_CIRCUIT_BREAKER_THRESHOLD moves the trip point", async () => {
    process.env.AI_CIRCUIT_BREAKER_THRESHOLD = "2";
    await recordFailure("groq-1");
    expect((await checkGlobalBreaker()).open).toBe(false);
    await recordFailure("groq-1");
    expect((await checkGlobalBreaker()).open).toBe(true);
  });

  // The counter is a 10-minute ROLLING window, not a lifetime total: five failures
  // spread over a working day are noise, five in ten minutes are an outage.
  test("the failure count is parked on a 10-minute window", async () => {
    await recordFailure("groq-1");
    const ttl = await redis.ttl("ai:failures:global");
    expect(ttl).toBeGreaterThan(590);
    expect(ttl).toBeLessThanOrEqual(600);
  });
});

describe("recordSuccess", () => {
  test("one success clears the streak, so the next four failures are safe", async () => {
    for (let i = 0; i < 4; i++) await recordFailure("groq-1");
    await recordSuccess();
    for (let i = 0; i < 4; i++) await recordFailure("groq-1");
    expect(await checkGlobalBreaker()).toEqual({ open: false });
  });

  test("a success does not lift a breaker that is already open", async () => {
    for (let i = 0; i < 5; i++) await recordFailure("groq-1");
    await recordSuccess();
    // Deliberate: the park is a cool-down. Clearing it on the first lucky call is
    // how a flapping pool gets hammered for the whole 10 minutes.
    expect((await checkGlobalBreaker()).open).toBe(true);
  });
});

// The single most important property: no Upstash must mean "AI works, untracked",
// never "AI is off". Local dev and any deploy without Upstash run this path.
describe("without Upstash", () => {
  beforeEach(() => useRedis(NO_UPSTASH));

  test("the breaker never reads as open", async () => {
    expect(await checkGlobalBreaker()).toEqual({ open: false });
  });

  test("failures never accumulate into a trip", async () => {
    for (let i = 0; i < 50; i++) await recordFailure("groq-1");
    expect(await checkGlobalBreaker()).toEqual({ open: false });
  });

  test("tripping explicitly still leaves AI available", async () => {
    await tripGlobalBreaker("ai_out_of_credit");
    expect(await checkGlobalBreaker()).toEqual({ open: false });
  });
});

describe("AIUnavailableError", () => {
  test("carries the breaker reason as its message, under its own name", () => {
    const err = new AIUnavailableError("ai_out_of_credit");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AIUnavailableError");
    expect(err.message).toBe("ai_out_of_credit");
  });
});
