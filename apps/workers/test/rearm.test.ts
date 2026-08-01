import { describe, expect, test } from "bun:test";
import { rearmableMonitorIds, type RearmCandidate } from "../src/lib/rearm";

// C2 regression: onFailure pauses a monitor (isActive:false + markedUnscrapable)
// after 3 failures and nothing ever un-pauses it, so a site that was merely down
// for ~2 days dies forever. rearmableMonitorIds picks the paused-unscrapable
// monitors whose last failure is older than the interval — the set to re-probe.

const DAY = 86_400_000;
const now = new Date("2026-07-06T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * DAY);

const candidate = (over: Partial<RearmCandidate> = {}): RearmCandidate => ({
  id: "m1",
  isActive: false,
  markedUnscrapable: true,
  lastFailedAt: ago(8),
  sourceType: "homepage",
  ...over,
});

describe("rearmableMonitorIds — C2 auto re-arm", () => {
  test("re-arms a paused-unscrapable monitor whose last failure is past the interval", () => {
    expect(rearmableMonitorIds([candidate()], now, 7)).toEqual(["m1"]);
  });

  test("does NOT re-arm within the interval (still cooling down)", () => {
    expect(rearmableMonitorIds([candidate({ lastFailedAt: ago(2) })], now, 7)).toEqual([]);
  });

  test("does NOT re-arm an already-active monitor", () => {
    expect(rearmableMonitorIds([candidate({ isActive: true })], now, 7)).toEqual([]);
  });

  test("does NOT re-arm a paused monitor that is not marked unscrapable", () => {
    expect(rearmableMonitorIds([candidate({ markedUnscrapable: false })], now, 7)).toEqual([]);
  });

  test("does NOT re-arm when lastFailedAt is null", () => {
    expect(rearmableMonitorIds([candidate({ lastFailedAt: null })], now, 7)).toEqual([]);
  });

  test("does NOT re-arm a monitor whose source has no scraper left", () => {
    // The re-arm is for a source that was DOWN. A retired source is gone: nothing is
    // bound to it, so waking it buys `No scraper for source type: …` and an immediate
    // re-pause, every 7 days, forever (prod: two trustpilot_reviews monitors sitting
    // at 5 and 6 consecutive failures on a source retired in July).
    expect(rearmableMonitorIds([candidate({ sourceType: "trustpilot_reviews" })], now, 7)).toEqual(
      [],
    );
    expect(rearmableMonitorIds([candidate({ sourceType: "linkedin" })], now, 7)).toEqual([]);
    // The live successor is untouched — this must not silence Trustpilot as a source.
    expect(
      rearmableMonitorIds([candidate({ sourceType: "trustpilot_public" })], now, 7),
    ).toEqual(["m1"]);
  });

  test("filters a mixed set to only the due ones", () => {
    const ids = rearmableMonitorIds(
      [
        candidate({ id: "due" }),
        candidate({ id: "fresh", lastFailedAt: ago(1) }),
        candidate({ id: "active", isActive: true }),
      ],
      now,
      7,
    );
    expect(ids).toEqual(["due"]);
  });
});
