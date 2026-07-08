import { test, expect } from "bun:test";
import { api } from "../src/lib/api";
import { trendsSummaryQuery } from "../src/lib/queries";

// trendsSummaryQuery's key must be timezone-stable: the server prefetch computes
// `range` in the SERVER tz, the client's first render computes it in the BROWSER
// tz. Keying on the full ISO instant (`.toISOString()`) made those two diverge
// for any non-UTC user -> the server-dehydrated seed sat under a key the client
// never requested -> guaranteed cache miss, refetch on every Trends load.

test("keys match across TZ-different instants that land on the same UTC day (the bug this fixes)", () => {
  // Server seed and client first-render land on different wall-clock instants
  // (server tz vs browser tz) but the same UTC calendar day for each bound.
  const serverRange = {
    from: new Date("2026-04-09T14:00:00.000Z"),
    to: new Date("2026-07-08T02:00:00.000Z"),
  };
  const clientRange = {
    from: new Date("2026-04-09T21:30:00.000Z"),
    to: new Date("2026-07-08T23:59:59.999Z"),
  };

  const serverKey = trendsSummaryQuery(serverRange).queryKey;
  const clientKey = trendsSummaryQuery(clientRange).queryKey;

  expect(serverKey).toEqual(clientKey);
});

test("key equality holds regardless of how the same instant was constructed", () => {
  const ms = Date.UTC(2026, 6, 8, 12, 0, 0);
  const range = {
    from: new Date(Date.UTC(2026, 3, 9, 0, 0, 0)),
    to: new Date(ms),
  };
  const rangeRoundTripped = {
    from: range.from,
    to: new Date(new Date(ms).toISOString()),
  };

  expect(trendsSummaryQuery(range).queryKey).toEqual(trendsSummaryQuery(rangeRoundTripped).queryKey);
});

test("derives the UTC yyyy-MM-dd for each bound", () => {
  const range = {
    from: new Date("2026-04-09T23:59:59.999Z"),
    to: new Date("2026-07-08T00:00:00.000Z"),
  };

  expect(trendsSummaryQuery(range).queryKey).toEqual(["trends", "summary", "2026-04-09", "2026-07-08"]);
});

test("appends productId to the key when provided", () => {
  const range = {
    from: new Date("2026-04-09T00:00:00.000Z"),
    to: new Date("2026-07-08T00:00:00.000Z"),
  };

  expect(trendsSummaryQuery(range, "p1").queryKey).toEqual([
    "trends",
    "summary",
    "2026-04-09",
    "2026-07-08",
    "p1",
  ]);
});

test("queryFn still forwards the real range Dates (only the key is date-only)", async () => {
  const range = {
    from: new Date("2026-04-09T14:32:00.000Z"),
    to: new Date("2026-07-08T02:17:00.000Z"),
  };
  let received: unknown[] = [];
  const original = api.getTrendsSummary;
  api.getTrendsSummary = ((...args: unknown[]) => {
    received = args;
    return Promise.resolve({}) as ReturnType<typeof api.getTrendsSummary>;
  }) as typeof api.getTrendsSummary;

  try {
    await trendsSummaryQuery(range, "p1").queryFn?.(
      // @ts-expect-error - minimal context stub, queryFn ignores it here
      {},
    );
  } finally {
    api.getTrendsSummary = original;
  }

  expect(received[0]).toBe(range);
  expect((received[0] as typeof range).from).toBeInstanceOf(Date);
  expect((received[0] as typeof range).from.toISOString()).toBe("2026-04-09T14:32:00.000Z");
  expect(received[1]).toBe("p1");
});
