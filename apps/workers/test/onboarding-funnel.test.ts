import { describe, expect, test } from "bun:test";
import { stampOnce, stampFirstScrape } from "../src/lib/onboarding-funnel";

describe("stampOnce", () => {
  test("writes the milestone when unset", () => {
    const next = stampOnce({ started: 100 }, "digest_sample", 500);
    expect(next).toEqual({ started: 100, digest_sample: 500 });
  });

  test("returns null when already set (never overwrites)", () => {
    expect(stampOnce({ digest_sample: 1 }, "digest_sample", 500)).toBeNull();
  });

  test("does not mutate the input timings", () => {
    const timings = { started: 100 };
    stampOnce(timings, "digest_sample", 500);
    expect(timings).toEqual({ started: 100 });
  });
});

describe("stampFirstScrape — recency-gated (scrape-monitor runs for every org forever)", () => {
  const WINDOW = 7 * 86_400_000;

  test("stamps when the session is inside the onboarding window", () => {
    const session = { timings: { started: 0 }, startedAt: new Date(1_000_000) };
    const next = stampFirstScrape(session, 1_000_000 + 3600_000, WINDOW);
    expect(next).toEqual({ started: 0, first_scrape: 1_000_000 + 3600_000 });
  });

  test("never back-stamps a session older than the window (poisons durations)", () => {
    const session = { timings: { started: 0 }, startedAt: new Date(0) };
    expect(stampFirstScrape(session, WINDOW + 1, WINDOW)).toBeNull();
  });

  test("returns null when first_scrape is already set", () => {
    const session = { timings: { first_scrape: 1 }, startedAt: new Date(1_000_000) };
    expect(stampFirstScrape(session, 1_000_000, WINDOW)).toBeNull();
  });
});
