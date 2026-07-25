import { describe, expect, test } from "bun:test";
import { nextAutomaticDetectionAt } from "./detection";

// The Discovery rail states a date for the next automatic scan instead of "runs
// every Sunday", which is only true when the org's last run is old enough: the cron
// fires weekly but skips any org inside its cadence window. That arithmetic is the
// difference between a promise the product keeps and one it breaks.
const WEEKLY = { autoDetect: true, cadence: "weekly" as const };

describe("nextAutomaticDetectionAt", () => {
  test("an org that opted out gets no date at all", () => {
    expect(
      nextAutomaticDetectionAt(new Date("2026-07-01T00:00:00Z"), {
        autoDetect: false,
        cadence: "weekly",
      }),
    ).toBeNull();
  });

  test("a long-idle org runs at the coming Sunday slot", () => {
    // Wednesday 22 July, last run a month ago.
    const at = nextAutomaticDetectionAt(
      new Date("2026-06-20T09:00:00Z"),
      WEEKLY,
      new Date("2026-07-22T11:00:00Z"),
    );
    expect(at?.toISOString()).toBe("2026-07-26T20:00:00.000Z");
  });

  test("a scan two days ago pushes past the coming Sunday", () => {
    // Last run Friday 24 July: the 6-day gate is not met by Sunday 26, so the cron
    // skips it and the real next run is Sunday 2 August.
    const at = nextAutomaticDetectionAt(
      new Date("2026-07-24T09:00:00Z"),
      WEEKLY,
      new Date("2026-07-25T11:00:00Z"),
    );
    expect(at?.toISOString()).toBe("2026-08-02T20:00:00.000Z");
  });

  test("Sunday before the slot still runs that same evening", () => {
    const at = nextAutomaticDetectionAt(
      new Date("2026-06-01T09:00:00Z"),
      WEEKLY,
      new Date("2026-07-26T09:00:00Z"),
    );
    expect(at?.toISOString()).toBe("2026-07-26T20:00:00.000Z");
  });

  test("Sunday after the slot has already passed rolls to the next week", () => {
    const at = nextAutomaticDetectionAt(
      new Date("2026-06-01T09:00:00Z"),
      WEEKLY,
      new Date("2026-07-26T21:30:00Z"),
    );
    expect(at?.toISOString()).toBe("2026-08-02T20:00:00.000Z");
  });

  test("monthly cadence waits 27 days before the next eligible Sunday", () => {
    const at = nextAutomaticDetectionAt(
      new Date("2026-07-01T09:00:00Z"),
      { autoDetect: true, cadence: "monthly" },
      new Date("2026-07-22T11:00:00Z"),
    );
    // 27 days after 1 July is 28 July (a Tuesday), so the run lands on 2 August.
    expect(at?.toISOString()).toBe("2026-08-02T20:00:00.000Z");
  });

  test("an org that has never run is eligible at the coming slot", () => {
    const at = nextAutomaticDetectionAt(null, WEEKLY, new Date("2026-07-22T11:00:00Z"));
    expect(at?.toISOString()).toBe("2026-07-26T20:00:00.000Z");
  });
});
