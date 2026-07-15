import { test, expect, mock, afterEach } from "bun:test";
import { scrape } from "./appstore-reviews.scraper";
import type { AppStoreSnapshot } from "@outrival/shared";

const APP_URL = "https://apps.apple.com/us/app/slack/id618783545";
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Review {
  id: string;
  rating: number;
}

/** Build an Apple RSS JSON body: entry[0] is app metadata (no im:rating/id). */
function feed(reviews: Review[]) {
  return {
    feed: {
      entry: [
        { "im:name": { label: "Slack" } },
        ...reviews.map((r) => ({
          id: { label: r.id },
          "im:rating": { label: String(r.rating) },
          title: { label: `title-${r.id}` },
          content: { label: `content-${r.id}` },
          author: { name: { label: "reviewer" } },
          updated: { label: "2026-01-01T00:00:00-07:00" },
        })),
      ],
    },
  };
}

/** Mock global fetch keyed by storefront; page 1 → body, page ≥ 2 → empty feed. */
function mockByCountry(map: Record<string, { status: number; reviews?: Review[] }>) {
  globalThis.fetch = mock(async (input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const country = new URL(url).pathname.split("/")[1] ?? "";
    const page = Number(url.match(/\/page=(\d+)\//)?.[1] ?? 1);
    const entry = map[country];
    if (!entry) return new Response("", { status: 404 });
    if (entry.status !== 200) return new Response("", { status: entry.status });
    if (page >= 2) return new Response(JSON.stringify({ feed: {} }), { status: 200 });
    return new Response(JSON.stringify(feed(entry.reviews ?? [])), { status: 200 });
  }) as typeof fetch;
}

function parse(html: string): AppStoreSnapshot {
  return JSON.parse(html) as AppStoreSnapshot;
}

test("merges configured storefronts, dedups by id, sorts, drops app metadata", async () => {
  mockByCountry({
    us: { status: 200, reviews: [{ id: "2", rating: 5 }, { id: "10", rating: 4 }] },
    fr: { status: 200, reviews: [{ id: "3", rating: 3 }, { id: "10", rating: 4 }] },
  });

  const out = await scrape("c1", APP_URL, { countries: ["us", "fr"] });
  const snap = parse(out.html);

  // id "10" appears in both storefronts → deduped to one entry.
  expect(snap.reviews.map((r) => r.id)).toEqual(["10", "2", "3"]); // localeCompare order
  expect(snap.countries).toEqual(["fr", "us"]); // sorted
  expect(snap.appId).toBe("618783545");
  expect(out.metadata.reviewCount).toBe(3);
  // the app-metadata entry (no im:rating) never becomes a review
  expect(snap.reviews.every((r) => r.rating > 0)).toBe(true);
});

test("defaults to the app URL's storefront when no countries configured", async () => {
  mockByCountry({ us: { status: 200, reviews: [{ id: "1", rating: 5 }] } });
  const out = await scrape("c1", APP_URL);
  expect(parse(out.html).countries).toEqual(["us"]);
});

test("a bad storefront (HTTP 400) is skipped when another succeeds", async () => {
  mockByCountry({
    zz: { status: 400 },
    us: { status: 200, reviews: [{ id: "7", rating: 5 }] },
  });
  const out = await scrape("c1", APP_URL, { countries: ["zz", "us"] });
  expect(parse(out.html).reviews.map((r) => r.id)).toEqual(["7"]);
});

test("throws (never an empty success snapshot) when NO storefront returns data", async () => {
  mockByCountry({ us: { status: 503 }, fr: { status: 400 } });
  expect(scrape("c1", APP_URL, { countries: ["us", "fr"] })).rejects.toThrow(/no data/i);
});

test("rejects a non-App-Store URL", async () => {
  expect(scrape("c1", "https://example.com/app")).rejects.toThrow(/valid App Store URL/i);
});
