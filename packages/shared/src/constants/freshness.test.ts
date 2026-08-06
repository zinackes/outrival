import { describe, expect, test } from "bun:test";
import { aggregateFreshness, computeFreshness } from "./freshness";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

// A surface the competitor doesn't have is recorded as a BENIGN SKIP: the worker
// stamps lastRunAt and clears the failure columns exactly like a real capture, and
// keeps the verdict in lastError. Read on timestamps alone it is indistinguishable
// from a healthy source, which is what painted absent sources green.
const noSurface = {
  sourceType: "roadmap",
  lastError: "no_roadmap_portal",
  lastRunAt: hoursAgo(2),
  lastFailedAt: null,
};

describe("aggregateFreshness: a surface that doesn't exist has no freshness", () => {
  test("a dot whose sources ALL came back absent reports it, instead of going green", () => {
    const agg = aggregateFreshness([
      noSurface,
      {
        sourceType: "trustpilot_public",
        lastError: "No Trustpilot business unit for this domain",
        lastRunAt: hoursAgo(3),
        lastFailedAt: null,
      },
    ]);
    expect(agg).toEqual({ lastScrapedAt: null, status: "not_available" });
    expect(computeFreshness(agg!.lastScrapedAt, agg!.status)).toBe("none");
  });

  test("an absent source never speaks for the sources beside it", () => {
    const blogRun = hoursAgo(4);
    const agg = aggregateFreshness([
      noSurface,
      { sourceType: "blog", lastError: null, lastRunAt: blogRun, lastFailedAt: null },
    ]);
    // The blog is the only thing there is anything to say about — and a "no such
    // surface" verdict must not fail the group either.
    expect(agg).toEqual({ lastScrapedAt: blogRun, status: "success" });
  });

  test("a real failure on a real surface still wins", () => {
    const agg = aggregateFreshness([
      noSurface,
      {
        sourceType: "blog",
        lastError: "timeout",
        lastRunAt: hoursAgo(30),
        lastFailedAt: hoursAgo(1),
      },
    ]);
    expect(agg?.status).toBe("failed");
  });

  test("callers with no diagnosis to offer keep the old reading", () => {
    const run = hoursAgo(2);
    expect(aggregateFreshness([{ lastRunAt: run, lastFailedAt: null }])).toEqual({
      lastScrapedAt: run,
      status: "success",
    });
    expect(aggregateFreshness([])).toBeNull();
  });
});
