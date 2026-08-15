import { test, expect, afterEach } from "bun:test";
import { startOfDay, endOfDay, subDays } from "date-fns";
import { lastNUtcDays, bucketLabels, trendBuckets } from "../src/lib/overview-window";

// OUT-185 — /dashboard threw React #418 because the overview's window was built
// with local calendar-day bounds: the UTC server and the viewer's browser derived
// two grids offset by the viewer's UTC offset, bucketed the same signals into
// different bars, and disagreed on the period count.
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

// A fixed instant so the assertions never straddle a real midnight.
const NOW = new Date("2026-08-15T08:30:00.000Z");

// East and west of Greenwich: one shifts the day boundary forward, the other back,
// so a fix that only works for positive offsets fails here.
const ZONES = ["UTC", "Europe/Paris", "Pacific/Honolulu", "Asia/Tokyo"];

test("lastNUtcDays yields the same instants in every timezone", () => {
  const windows = ZONES.map((tz) =>
    inTz(tz, () => {
      const r = lastNUtcDays(7, NOW);
      return [r.from.getTime(), r.to.getTime()];
    }),
  );

  for (const w of windows) expect(w).toEqual(windows[0]!);
  expect(new Date(windows[0]![0]!).toISOString()).toBe("2026-08-08T00:00:00.000Z");
  expect(new Date(windows[0]![1]!).toISOString()).toBe("2026-08-15T23:59:59.999Z");
});

// The regression itself: what the component used to seed its first render with.
test("the local window it replaces does NOT agree across timezones", () => {
  const local = (tz: string) =>
    inTz(tz, () => startOfDay(subDays(NOW, 7)).getTime());

  expect(local("Europe/Paris")).not.toBe(local("UTC"));
  expect(local("Pacific/Honolulu")).not.toBe(local("UTC"));
  // …and the drift is exactly the offset that moved signals between bars.
  expect(local("UTC") - local("Europe/Paris")).toBe(2 * 3_600_000);
});

test("a signal near a day boundary lands in the same bar in every timezone", () => {
  // 00:45 UTC on the second day of the window — inside the offset band that used to
  // push a signal into the previous bucket for a viewer east of Greenwich.
  const signals = [{ createdAt: "2026-08-09T00:45:00.000Z" }];

  const bars = ZONES.map((tz) =>
    inTz(tz, () => {
      const { from, to } = lastNUtcDays(7, NOW);
      return trendBuckets(signals, from.getTime(), to.getTime(), 8);
    }),
  );

  for (const b of bars) expect(b).toEqual(bars[0]!);
  expect(bars[0]!.indexOf(1)).toBe(1);
});

test("bucketLabels pinned to UTC read the same in every timezone", () => {
  const labels = ZONES.map((tz) =>
    inTz(tz, () => {
      const { from, to } = lastNUtcDays(7, NOW);
      return bucketLabels(from.getTime(), to.getTime(), 8, "UTC");
    }),
  );

  for (const l of labels) expect(l).toEqual(labels[0]!);
  // Pinned verbatim, quirk included: the window's end is inclusive (23:59:59.999),
  // so eight buckets each fall 1 ms short of a day and every label after the first
  // starts just inside the previous one — "Aug 8" is printed twice and "Aug 15"
  // never appears. That predates this change and is left alone here; what the fix
  // owns is that both runtimes now print the SAME eight labels.
  expect(labels[0]).toEqual([
    "Aug 8",
    "Aug 8",
    "Aug 9",
    "Aug 10",
    "Aug 11",
    "Aug 12",
    "Aug 13",
    "Aug 14",
  ]);
});

test("bucketLabels without a timezone reads a UTC midnight as the day before, west of Greenwich", () => {
  // Why the pre-mount pass pins "UTC": left to the runtime, the same bound names
  // two different days, which is a hydration mismatch of its own.
  const { from, to } = lastNUtcDays(7, NOW);
  const paris = inTz("Europe/Paris", () =>
    bucketLabels(from.getTime(), to.getTime(), 8),
  );
  const honolulu = inTz("Pacific/Honolulu", () =>
    bucketLabels(from.getTime(), to.getTime(), 8),
  );

  expect(paris[0]).toBe("Aug 8");
  expect(honolulu[0]).toBe("Aug 7");
});

test("a range wider than MAX_BARS labels each bucket with its span", () => {
  const from = Date.UTC(2026, 4, 17);
  const to = Date.UTC(2026, 7, 15, 23, 59, 59, 999);
  const labels = bucketLabels(from, to, 14, "UTC");

  expect(labels).toHaveLength(14);
  expect(labels[0]).toContain(" to ");
  expect(labels[0]!.startsWith("May 17")).toBe(true);
});

test("trendBuckets ignores signals outside the window", () => {
  const { from, to } = lastNUtcDays(7, NOW);
  const bars = trendBuckets(
    [
      { createdAt: "2026-07-01T12:00:00.000Z" },
      { createdAt: "2026-08-10T12:00:00.000Z" },
      { createdAt: "2026-12-01T12:00:00.000Z" },
    ],
    from.getTime(),
    to.getTime(),
    8,
  );

  expect(bars.reduce((a, b) => a + b, 0)).toBe(1);
});

// endOfDay is only used here to show the local window's other end also drifts —
// the component no longer calls it before mount.
test("the local window's end drifts too", () => {
  const ends = ["UTC", "Asia/Tokyo"].map((tz) => inTz(tz, () => endOfDay(NOW).getTime()));
  expect(ends[0]).not.toBe(ends[1]);
});
