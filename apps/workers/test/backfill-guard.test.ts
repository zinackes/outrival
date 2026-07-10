import { describe, expect, test } from "bun:test";
import { isArchiveCaptureVoid } from "../src/lib/backfill-guard";

// ÉTAPE 3 (2026-07 audit) — anti-void parity for the archive backfill path. A
// Wayback reconstruction can come back near-empty (a redirect stub, a partial
// capture) WITHOUT being a deny page, so the existing deny/challenge skip misses
// it. Stored as a `success` archive snapshot it would diff `"" → current` and
// fabricate a phantom "whole page added" signal. This guard is the silent-failure
// reproduction: an empty archive against a substantive current page is a broken
// capture, not a real past page.
describe("isArchiveCaptureVoid", () => {
  test("near-empty archive against a substantive current page → void (the bug)", () => {
    expect(isArchiveCaptureVoid(120, 3000)).toBe(true);
  });

  test("healthy archive against current → NOT void (backfill still works)", () => {
    expect(isArchiveCaptureVoid(2500, 3000)).toBe(false);
  });

  test("legitimately smaller past page (has real content) → NOT void", () => {
    // A page that genuinely grew must still produce a backfill change — only an
    // absolutely-tiny capture is treated as broken.
    expect(isArchiveCaptureVoid(700, 3000)).toBe(false);
  });

  test("current itself small → NOT void (conservative, no reference to trust)", () => {
    expect(isArchiveCaptureVoid(120, 400)).toBe(false);
  });
});
