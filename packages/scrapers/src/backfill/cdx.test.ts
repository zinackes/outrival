import { test, expect, describe, afterEach } from "bun:test";
import { listArchiveCaptures, sampleQuarterly, type ArchiveCapture } from "./cdx";

const capture = (iso: string, digest: string | null = null): ArchiveCapture => ({
  waybackTimestamp: iso.replace(/[-:TZ.]/g, "").slice(0, 14),
  capturedAt: new Date(iso),
  digest,
});

describe("sampleQuarterly", () => {
  test("keeps at most one capture per calendar quarter", () => {
    const picked = sampleQuarterly(
      [
        capture("2025-01-05T00:00:00Z", "a"),
        capture("2025-02-11T00:00:00Z", "b"),
        capture("2025-03-30T00:00:00Z", "c"),
        capture("2025-04-02T00:00:00Z", "d"),
      ],
      { max: 12 },
    );
    expect(picked.map((c) => c.capturedAt.toISOString().slice(0, 10))).toEqual([
      "2025-01-05",
      "2025-04-02",
    ]);
  });

  test("picks the FIRST capture of a quarter, so a re-run picks the same one", () => {
    const list = [capture("2025-07-20T00:00:00Z", "b"), capture("2025-07-02T00:00:00Z", "a")];
    expect(sampleQuarterly(list, { max: 12 })[0]!.digest).toBe("a");
    // Same input in the other order still resolves to the same capture.
    expect(sampleQuarterly([...list].reverse(), { max: 12 })[0]!.digest).toBe("a");
  });

  test("a quarter whose page is byte-identical to the last kept one is skipped", () => {
    const picked = sampleQuarterly(
      [
        capture("2024-01-10T00:00:00Z", "same"),
        capture("2024-04-10T00:00:00Z", "same"),
        capture("2024-07-10T00:00:00Z", "moved"),
      ],
      { max: 12 },
    );
    expect(picked.map((c) => c.digest)).toEqual(["same", "moved"]);
  });

  test("captures with no digest are never collapsed together", () => {
    const picked = sampleQuarterly(
      [capture("2024-01-10T00:00:00Z"), capture("2024-04-10T00:00:00Z")],
      { max: 12 },
    );
    expect(picked).toHaveLength(2);
  });

  test("over the cap, the most recent quarters survive", () => {
    const list = Array.from({ length: 12 }, (_, i) =>
      capture(`202${Math.floor(i / 4) + 2}-${String((i % 4) * 3 + 1).padStart(2, "0")}-05T00:00:00Z`, `d${i}`),
    );
    const picked = sampleQuarterly(list, { max: 3 });
    expect(picked).toHaveLength(3);
    expect(picked.map((c) => c.digest)).toEqual(["d9", "d10", "d11"]);
  });

  test("an empty index samples to nothing", () => {
    expect(sampleQuarterly([], { max: 12 })).toEqual([]);
  });
});

describe("listArchiveCaptures", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const mockCdx = (body: unknown, ok = true) => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(body), { status: ok ? 200 : 503 })) as typeof fetch;
  };

  test("parses the CDX table, drops the header row and sorts oldest first", async () => {
    mockCdx([
      ["timestamp", "statuscode", "digest"],
      ["20250401120000", "200", "BBB"],
      ["20240101090000", "200", "AAA"],
    ]);
    const rows = await listArchiveCaptures("https://x.test/pricing", {
      from: new Date("2023-01-01T00:00:00Z"),
      to: new Date("2026-01-01T00:00:00Z"),
    });
    expect(rows.map((r) => r.digest)).toEqual(["AAA", "BBB"]);
    expect(rows[0]!.capturedAt.toISOString()).toBe("2024-01-01T09:00:00.000Z");
  });

  test("a URL with no index reads as no archive, never as an error", async () => {
    mockCdx([]);
    expect(
      await listArchiveCaptures("https://x.test/pricing", {
        from: new Date("2023-01-01T00:00:00Z"),
        to: new Date("2026-01-01T00:00:00Z"),
      }),
    ).toEqual([]);
  });

  test("an unreachable index reads as no archive", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    expect(
      await listArchiveCaptures("https://x.test/pricing", {
        from: new Date("2023-01-01T00:00:00Z"),
        to: new Date("2026-01-01T00:00:00Z"),
      }),
    ).toEqual([]);
  });

  test("malformed rows are skipped, not fatal", async () => {
    mockCdx([
      ["timestamp", "statuscode", "digest"],
      ["not-a-timestamp", "200", "X"],
      [null, "200", "Y"],
      ["20250101000000", "200", "Z"],
    ]);
    const rows = await listArchiveCaptures("https://x.test/pricing", {
      from: new Date("2023-01-01T00:00:00Z"),
      to: new Date("2026-01-01T00:00:00Z"),
    });
    expect(rows.map((r) => r.digest)).toEqual(["Z"]);
  });
});
