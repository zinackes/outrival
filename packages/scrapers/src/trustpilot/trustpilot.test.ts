import { test, expect, mock, beforeEach, afterEach } from "bun:test";
import { scrape, resolveTrustpilotDomain } from "./trustpilot.scraper";
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

// The Trustpilot source used to be the one "no such surface" the user could not
// answer: the business unit was derived from the competitor's own domain, so a
// company listed under another one was simply unreachable.
test("resolveTrustpilotDomain: the competitor's own site is used as-is", () => {
  expect(resolveTrustpilotDomain("https://www.acme.com/pricing")).toBe("acme.com");
  expect(resolveTrustpilotDomain("https://acme.co.uk")).toBe("acme.co.uk");
});

test("resolveTrustpilotDomain: a pinned profile names the domain to look up", () => {
  expect(resolveTrustpilotDomain("https://www.trustpilot.com/review/acme-group.de")).toBe(
    "acme-group.de",
  );
  expect(resolveTrustpilotDomain("https://trustpilot.com/review/acme.com?stars=5")).toBe("acme.com");
});

test("resolveTrustpilotDomain: a non-profile trustpilot URL names no domain", () => {
  // Falling back to the host here would look up Trustpilot's own business unit and
  // store a snapshot of the wrong company.
  expect(resolveTrustpilotDomain("https://www.trustpilot.com/categories/saas")).toBeNull();
  expect(resolveTrustpilotDomain("https://www.trustpilot.com")).toBeNull();
});
