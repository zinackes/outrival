import { test, expect, mock, beforeEach, afterEach } from "bun:test";
import { scrape } from "./trustpilot.scraper";
import type { TrustpilotSnapshot } from "@outrival/shared";

const realFetch = globalThis.fetch;
const realKey = process.env.TRUSTPILOT_API_KEY;

beforeEach(() => {
  process.env.TRUSTPILOT_API_KEY = "test-key";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.TRUSTPILOT_API_KEY;
  else process.env.TRUSTPILOT_API_KEY = realKey;
});

function mockApi(opts: {
  find?: { status: number; body?: unknown };
  dist?: { status: number; body?: unknown };
}) {
  globalThis.fetch = mock(async (input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/business-units/find")) {
      const f = opts.find ?? { status: 200, body: {} };
      return f.status === 200
        ? new Response(JSON.stringify(f.body), { status: 200 })
        : new Response("", { status: f.status });
    }
    if (url.includes("/star-distribution")) {
      const d = opts.dist ?? { status: 404 };
      return d.status === 200
        ? new Response(JSON.stringify(d.body), { status: 200 })
        : new Response("", { status: d.status });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
}

function parse(html: string): TrustpilotSnapshot {
  return JSON.parse(html) as TrustpilotSnapshot;
}

test("reads score + count + distribution from the official API", async () => {
  mockApi({
    find: {
      status: 200,
      body: {
        id: "bu-123",
        score: { trustScore: 4.3, stars: 4 },
        numberOfReviews: { total: 812 },
      },
    },
    dist: {
      status: 200,
      body: {
        distribution: [
          { stars: 5, count: 500 },
          { stars: 1, count: 100 },
          { stars: 3, count: 212 },
        ],
      },
    },
  });

  const out = await scrape("c1", "https://www.slack.com/pricing");
  const snap = parse(out.html);
  expect(snap.source).toBe("trustpilot");
  expect(snap.domain).toBe("slack.com"); // registrable domain derived from URL
  expect(snap.businessUnitId).toBe("bu-123");
  expect(snap.trustScore).toBe(4.3);
  expect(snap.reviewCount).toBe(812);
  // distribution sorted ascending by stars (deterministic snapshot)
  expect(snap.distribution.map((d) => d.stars)).toEqual([1, 3, 5]);
});

test("distribution failure is non-fatal (score point still captured)", async () => {
  mockApi({
    find: { status: 200, body: { id: "bu-1", trustScore: 4.0, numberOfReviews: 10 } },
    dist: { status: 500 },
  });
  const snap = parse((await scrape("c1", "https://acme.com")).html);
  expect(snap.trustScore).toBe(4.0);
  expect(snap.reviewCount).toBe(10);
  expect(snap.distribution).toEqual([]);
});

test("no API key → clean failure (never a scraping fallback)", async () => {
  delete process.env.TRUSTPILOT_API_KEY;
  mockApi({ find: { status: 200, body: { id: "x", trustScore: 4 } } });
  expect(scrape("c1", "https://acme.com")).rejects.toThrow(/trustpilot_api_key_missing/);
});

test("404 business unit → throws (no hollow snapshot)", async () => {
  mockApi({ find: { status: 404 } });
  expect(scrape("c1", "https://unknown-brand.com")).rejects.toThrow(/No Trustpilot business unit/i);
});

test("resolved unit with no score and no reviews → throws (anti-silent-failure)", async () => {
  mockApi({ find: { status: 200, body: { id: "bu-empty", numberOfReviews: { total: 0 } } } });
  expect(scrape("c1", "https://acme.com")).rejects.toThrow(/no usable surface/i);
});
