import { beforeEach, describe, expect, mock, test } from "bun:test";

// The server-prefetch helpers are the load-bearing half of the RSC perf work:
// each getXData() must forward the caller's session cookie to the API and, on ANY
// failure, return null so the page falls back to its own client fetch ("never
// slower than before"). If that best-effort contract breaks, a page crashes in
// RSC (blank screen) instead of degrading — exactly what these tests pin down.
//
// api-server.ts calls cookies() from next/headers, which is request-scoped and
// throws outside a Next request. Mock it BEFORE the module under test is
// (dynamically) imported, mirroring the apps/api harness ("set up, then import").

let cookieHeader = "session=abc; theme=dark";
mock.module("next/headers", () => ({
  cookies: async () => ({ toString: () => cookieHeader }),
}));

type MockRes = { ok: boolean; status: number; json: () => Promise<unknown> };
const fetchCalls: { url: string; init: RequestInit | undefined }[] = [];
let router: (url: string) => MockRes;

const ok = (body: unknown): MockRes => ({ ok: true, status: 200, json: async () => body });
const fail = (status = 500): MockRes => ({ ok: false, status, json: async () => ({}) });

beforeEach(() => {
  fetchCalls.length = 0;
  cookieHeader = "session=abc; theme=dark";
  router = () => ok({});
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    return router(String(url));
  }) as typeof fetch;
});

// Dynamic import AFTER the mock is registered (static imports would hoist above it).
const load = () => import("../src/lib/api-server");

describe("serverGet contract", () => {
  test("forwards the session cookie to the right path, no-store", async () => {
    router = (u) => (u.endsWith("/api/billing") ? ok({ plan: "pro" }) : fail(404));
    const { getBillingData } = await load();

    const data = await getBillingData();

    expect(data).toEqual({ plan: "pro" });
    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0]!;
    expect(call.url.endsWith("/api/billing")).toBe(true);
    expect((call.init?.headers as Record<string, string>).cookie).toBe(cookieHeader);
    expect(call.init?.cache).toBe("no-store");
  });
});

describe("best-effort: failures return null, never throw", () => {
  test("fetch rejects (API down / hairpin blocked) -> null", async () => {
    router = () => {
      throw new Error("ECONNREFUSED");
    };
    const { getBillingData } = await load();

    expect(await getBillingData()).toBeNull();
  });

  test("non-2xx response (e.g. 401, no session) -> null", async () => {
    router = () => fail(401);
    const { getOverviewData } = await load();

    expect(await getOverviewData()).toBeNull();
  });
});

describe("success path maps the API shape", () => {
  test("getOverviewData merges the two parallel fetches", async () => {
    router = (u) =>
      u.includes("/api/signals")
        ? ok({ signals: [{ id: "s1" }] })
        : ok({ competitors: [{ id: "c1" }] });
    const { getOverviewData } = await load();

    expect(await getOverviewData()).toEqual({
      signals: [{ id: "s1" }],
      competitors: [{ id: "c1" }],
    });
  });

  test("getSignalsData threads sort + productId into the query string", async () => {
    router = () => ok({ signals: [] });
    const { getSignalsData } = await load();

    await getSignalsData({ productId: "p9", sort: "recent" });

    const url = fetchCalls[0]!.url;
    expect(url).toContain("/api/signals?");
    expect(url).toContain("limit=200");
    expect(url).toContain("sort=recent");
    expect(url).toContain("productId=p9");
  });
});
