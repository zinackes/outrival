import { test, expect, describe, afterEach } from "bun:test";
import { format } from "date-fns";
import { nowOnClock, onClock } from "@/lib/hydration-clock";
import { dayKeyOf, dayLabel } from "@/components/dashboard/activity/format";

// `code:PER-24` — the dashboard cut its day buckets with date-fns, which reads the
// runtime's own timezone. The UTC server and the viewer's browser therefore grouped
// the same feed into a different set of day sections, and a different set of sections
// is a STRUCTURAL hydration failure: React throws the tree away and re-renders it
// (#418). The fix is the two-pass shape OUT-185 already used for the overview window
// — first paint on a clock both sides derive, the viewer's own on mount.
//
// Bun re-reads `process.env.TZ` for every Date operation, so a runtime swap is a
// faithful stand-in for "the same render, in two places".

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

function inTz<T>(tz: string, fn: () => T): T {
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    process.env.TZ = ORIGINAL_TZ;
  }
}

// East and west of Greenwich: one pushes the day boundary forward, the other back,
// so a fix that only works for positive offsets fails here.
const ZONES = ["UTC", "Europe/Paris", "Pacific/Honolulu", "Asia/Tokyo"];

// Late enough in the UTC day that Paris and Tokyo are already on the next one, and
// early enough in local terms that Honolulu is still on the previous.
const LATE = "2026-07-25T23:30:00.000Z";
const EARLY = "2026-07-25T00:30:00.000Z";

describe("onClock", () => {
  test("the shared clock prints the same wall reading in every timezone", () => {
    for (const iso of [LATE, EARLY]) {
      const reads = ZONES.map((tz) =>
        inTz(tz, () => format(onClock(iso, false), "yyyy-MM-dd HH:mm")),
      );
      for (const r of reads) expect(r).toBe(reads[0]!);
      expect(reads[0]).toBe(new Date(iso).toISOString().slice(0, 16).replace("T", " "));
    }
  });

  test("the viewer's clock does NOT agree across timezones — that is the point", () => {
    const reads = ZONES.map((tz) => inTz(tz, () => format(onClock(LATE, true), "yyyy-MM-dd HH:mm")));
    expect(new Set(reads).size).toBeGreaterThan(1);
  });

  test("a date is shifted by its own offset, not by today's", () => {
    // Paris is UTC+1 in January and UTC+2 in July. Reading the winter instant with
    // the summer offset would land an hour off.
    const winter = inTz("Europe/Paris", () =>
      format(onClock("2026-01-15T23:30:00.000Z", false), "yyyy-MM-dd HH:mm"),
    );
    expect(winter).toBe("2026-01-15 23:30");
  });
});

describe("activity day buckets", () => {
  test("the first pass buckets an instant into the same day everywhere", () => {
    for (const iso of [LATE, EARLY]) {
      const keys = ZONES.map((tz) => inTz(tz, () => dayKeyOf(iso, false)));
      for (const k of keys) expect(k).toBe(keys[0]!);
      expect(keys[0]).toBe("2026-07-25");
    }
  });

  // The regression itself: what the log used to compute on both sides.
  test("the viewer's own buckets disagree across timezones", () => {
    const keys = ZONES.map((tz) => inTz(tz, () => dayKeyOf(LATE, true)));
    expect(new Set(keys).size).toBeGreaterThan(1);
  });

  test("a label reads the same everywhere on the first pass", () => {
    const key = dayKeyOf(LATE, false);
    const labels = ZONES.map((tz) => inTz(tz, () => dayLabel(key, false)));
    for (const l of labels) expect(l).toBe(labels[0]!);
  });

  test("today and yesterday still resolve on the shared clock", () => {
    const today = format(nowOnClock(false), "yyyy-MM-dd");
    const yesterday = format(
      new Date(nowOnClock(false).getTime() - 86_400_000),
      "yyyy-MM-dd",
    );
    expect(dayLabel(today, false)).toBe("Today");
    expect(dayLabel(yesterday, false)).toBe("Yesterday");
  });

  test("the viewer's clock still names their own today", () => {
    const today = format(nowOnClock(true), "yyyy-MM-dd");
    expect(dayLabel(today, true)).toBe("Today");
  });
});
