import { describe, expect, test } from "bun:test";
import {
  isArchiveCaptureVoid,
  resolveBackfillOutcome,
  type BackfillSkips,
} from "../src/lib/backfill-guard";

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

// The SLO miss buckets (docs/slos/onboarding-first-signal.md): every backfill run
// must resolve to exactly one queryable outcome — success wins over everything,
// a zero-seed run explains WHY Wayback gave nothing, a seeded-but-silent run
// distinguishes "the past looks like the present" from a trivial diff.
describe("resolveBackfillOutcome", () => {
  const skips = (over: Partial<BackfillSkips> = {}): BackfillSkips => ({
    noCapture: 0,
    tooRecent: 0,
    challengeOrDeny: 0,
    voidCapture: 0,
    ...over,
  });

  test("a triggered change wins regardless of skips", () => {
    expect(resolveBackfillOutcome(1, true, skips({ noCapture: 2 }))).toEqual({
      outcome: "change_triggered",
      detail: null,
    });
  });

  test("zero seeded → no_archive_capture with the per-cause tally", () => {
    const out = resolveBackfillOutcome(
      0,
      false,
      skips({ noCapture: 1, challengeOrDeny: 2 }),
    );
    expect(out.outcome).toBe("no_archive_capture");
    expect(out.detail).toBe("no_capture=1 too_recent=0 challenge_or_deny=2 void=0");
  });

  test("seeded but trivial diff → no_significant_change with the significance reason", () => {
    expect(resolveBackfillOutcome(1, false, skips({ trivialReason: "only_dates" }))).toEqual({
      outcome: "no_significant_change",
      detail: "only_dates",
    });
  });

  test("seeded, no textual diff at all → no_diff detail", () => {
    expect(resolveBackfillOutcome(2, false, skips({ noDiff: true }))).toEqual({
      outcome: "no_significant_change",
      detail: "no_diff",
    });
  });

  test("seeded elsewhere but the lookback capture was unusable", () => {
    // Pricing seeded a 30d point, but the 90d lookback offset had no capture →
    // no change was even attempted.
    expect(resolveBackfillOutcome(1, false, skips({ noCapture: 1 }))).toEqual({
      outcome: "no_significant_change",
      detail: "lookback_capture_unusable",
    });
  });
});
