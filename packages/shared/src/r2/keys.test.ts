import { test, expect } from "bun:test";
import { snapshotObjectKeys } from "./keys";

// ─── happy path: extensionless stored key expands to all three suffixes ─────

test("extensionless snapshot key expands to .html, .png and .txt", () => {
  const key = "snapshots/a/homepage/2026-01-01T00:00:00Z";
  const out = snapshotObjectKeys(key);
  expect(out).toEqual([`${key}.html`, `${key}.png`, `${key}.txt`]);
});

// ─── idempotence: a key that already carries a known extension is untouched ─

test("a key already ending .html is returned unchanged", () => {
  expect(snapshotObjectKeys("snapshots/a/homepage/2026-01-01T00:00:00Z.html")).toEqual([
    "snapshots/a/homepage/2026-01-01T00:00:00Z.html",
  ]);
});

test("a key already ending .png is returned unchanged", () => {
  expect(snapshotObjectKeys("snapshots/a/homepage/2026-01-01T00:00:00Z.png")).toEqual([
    "snapshots/a/homepage/2026-01-01T00:00:00Z.png",
  ]);
});

test("a key already ending .txt is returned unchanged", () => {
  expect(snapshotObjectKeys("snapshots/a/review_shift/2026-01-01T00:00:00Z.txt")).toEqual([
    "snapshots/a/review_shift/2026-01-01T00:00:00Z.txt",
  ]);
});

test("a key already ending .pdf (battle-card key passed by mistake) is returned unchanged", () => {
  expect(snapshotObjectKeys("battle-cards/a/2026-01-01T00:00:00Z.pdf")).toEqual([
    "battle-cards/a/2026-01-01T00:00:00Z.pdf",
  ]);
});

// ─── empty / whitespace-only input ───────────────────────────────────────────

test("empty string returns []", () => {
  expect(snapshotObjectKeys("")).toEqual([]);
});

test("whitespace-only string returns []", () => {
  expect(snapshotObjectKeys("   ")).toEqual([]);
});

// ─── the regression itself: the old `.replace(/\.html$/, ".png")` never ─────
// matched an extensionless key, so the deleter built [key, key] — the bare,
// non-existent key twice. Assert the bare key is never in the output.

test("output for a realistic stored key never contains the bare key itself", () => {
  const key = "snapshots/11111111-1111-1111-1111-111111111111/homepage/2026-07-20T12:00:00.000Z";
  const out = snapshotObjectKeys(key);
  expect(out).not.toContain(key);
  expect(out).toEqual([`${key}.html`, `${key}.png`, `${key}.txt`]);
});
