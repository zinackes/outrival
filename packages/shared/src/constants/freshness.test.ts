import { describe, expect, test } from "bun:test";
import {
  aggregateCaptureFreshness,
  aggregateFreshness,
  captureFreshness,
  computeFreshness,
} from "./freshness";

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

  test("a failure over a still-fresh capture does not paint the dot red", () => {
    // OUT-182: one of the four sources behind the Content tab failed last night,
    // while the timeline on screen is a week of entries collected two days ago. The
    // dot grades the DATA, so it stays fresh and the tooltip carries the failure.
    const agg = aggregateFreshness([
      { sourceType: "blog", lastError: null, lastRunAt: hoursAgo(48), lastFailedAt: null },
      { sourceType: "roadmap", lastError: "timeout", lastRunAt: hoursAgo(50), lastFailedAt: hoursAgo(1) },
    ]);
    expect(agg?.status).toBe("failed");
    expect(computeFreshness(agg!.lastScrapedAt, agg!.status)).toBe("fresh");
  });

  test("once the frozen capture ages out, the failure takes the dot back", () => {
    // Same shape, older data: nothing has been collected in ten days, and the
    // failure is now the reason. Red is the honest reading.
    expect(computeFreshness(hoursAgo(24 * 10), "failed")).toBe("failed");
    expect(computeFreshness(hoursAgo(24 * 40), "failed")).toBe("failed");
    expect(computeFreshness(null, "failed")).toBe("failed");
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

describe("captureFreshness: unchanged for six days is not the same claim as not verified for six days", () => {
  test("a healthy source reports the same date twice and calls it verified", () => {
    const run = hoursAgo(3);
    expect(captureFreshness({ lastRunAt: run, lastFailedAt: null })).toEqual({
      lastSuccessAt: run,
      lastAttemptAt: run,
      verified: true,
      level: "fresh",
    });
  });

  test("a failure after the last success splits the two dates and drops `verified`", () => {
    const run = hoursAgo(200);
    const failed = hoursAgo(2);
    const f = captureFreshness({ lastRunAt: run, lastFailedAt: failed });
    expect(f.lastSuccessAt).toBe(run);
    expect(f.lastAttemptAt).toBe(failed);
    expect(f.verified).toBe(false);
    // The capture is out of the fresh window AND unconfirmed since: the failure is
    // now the reason it is old, exactly as the dots grade it.
    expect(f.level).toBe("failed");
  });

  test("a failure inside the fresh window still shows fresh data, and still says it is unconfirmed", () => {
    const f = captureFreshness({ lastRunAt: hoursAgo(4), lastFailedAt: hoursAgo(1) });
    expect(f.verified).toBe(false);
    expect(f.level).toBe("fresh");
  });

  test("a source that never ran has no success date and no attempt to report", () => {
    expect(captureFreshness({ lastRunAt: null, lastFailedAt: null })).toEqual({
      lastSuccessAt: null,
      lastAttemptAt: null,
      verified: true,
      level: "stale",
    });
  });

  test("a surface the competitor doesn't have is graded `none`, not fresh", () => {
    expect(captureFreshness(noSurface).level).toBe("none");
  });
});

describe("aggregateCaptureFreshness: what one dated tab can honestly claim", () => {
  test("the chip is dated by the OLDEST read behind it, not the newest", () => {
    const old = hoursAgo(50);
    const f = aggregateCaptureFreshness([
      { lastRunAt: hoursAgo(1), lastFailedAt: null },
      { lastRunAt: old, lastFailedAt: null },
    ]);
    expect(f?.lastSuccessAt).toBe(old);
    expect(f?.verified).toBe(true);
  });

  test("one failing source is enough to drop the whole tab to unverified", () => {
    const failed = hoursAgo(1);
    const f = aggregateCaptureFreshness([
      { lastRunAt: hoursAgo(2), lastFailedAt: null },
      { lastRunAt: hoursAgo(300), lastFailedAt: failed },
    ]);
    expect(f?.verified).toBe(false);
    // The latest attempt is the failure: it is what the panel reports back.
    expect(f?.lastAttemptAt).toBe(failed);
  });

  test("a source never read leaves the tab undated instead of borrowing a sibling's capture", () => {
    const f = aggregateCaptureFreshness([
      { lastRunAt: hoursAgo(2), lastFailedAt: null },
      { lastRunAt: null, lastFailedAt: null },
    ]);
    expect(f?.lastSuccessAt).toBeNull();
    expect(f?.level).toBe("stale");
  });

  test("surfaces the competitor doesn't have are left out of the fold", () => {
    const run = hoursAgo(2);
    expect(aggregateCaptureFreshness([noSurface, { lastRunAt: run, lastFailedAt: null }])).toEqual({
      lastSuccessAt: run,
      lastAttemptAt: run,
      verified: true,
      level: "fresh",
    });
    // Nothing collectible at all: no date to print, and no chip.
    expect(aggregateCaptureFreshness([noSurface])).toBeNull();
    expect(aggregateCaptureFreshness([])).toBeNull();
  });
});
