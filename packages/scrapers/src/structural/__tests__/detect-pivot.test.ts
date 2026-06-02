import { describe, expect, test } from "bun:test";
import { detectStructuralSignal, textDifference, type SnapshotPoint } from "../detect-pivot";

// pHash hex strings whose Hamming distance is large (full visual redesign).
const PHASH_A = "0000000000000000";
const PHASH_B = "ffffffffffffffff";

const PROJECT_TOOL =
  "Linear is the issue tracker for high performance software teams plan build ship projects roadmap";
const REAL_ESTATE =
  "Browse luxury apartments houses villas for sale rent mortgage realtor neighborhood listings";

describe("textDifference", () => {
  test("identical text → 0", () => {
    expect(textDifference(PROJECT_TOOL, PROJECT_TOOL)).toBe(0);
  });
  test("completely different text → close to 1", () => {
    expect(textDifference(PROJECT_TOOL, REAL_ESTATE)).toBeGreaterThan(0.8);
  });
  test("both empty → 0", () => {
    expect(textDifference("", "")).toBe(0);
  });
});

describe("detectStructuralSignal", () => {
  test("returns null with fewer than MIN_SCRAPES snapshots", () => {
    expect(detectStructuralSignal([{ text: PROJECT_TOOL, phashHex: PHASH_A }])).toBeNull();
  });

  test("stable radical change (text + visual) → signal", () => {
    // newest first: two recent identical real-estate captures, one old project-tool capture.
    const recent: SnapshotPoint[] = [
      { text: REAL_ESTATE, phashHex: PHASH_B },
      { text: REAL_ESTATE, phashHex: PHASH_B },
      { text: PROJECT_TOOL, phashHex: PHASH_A },
    ];
    const signal = detectStructuralSignal(recent);
    expect(signal).not.toBeNull();
    expect(signal!.textDiffRatio).toBeGreaterThan(0.8);
    expect(signal!.consistent).toBe(true);
  });

  test("A/B test (latest differs from previous) → null", () => {
    // latest != previous → not a stable new version → suppressed.
    const recent: SnapshotPoint[] = [
      { text: REAL_ESTATE, phashHex: PHASH_B },
      { text: PROJECT_TOOL, phashHex: PHASH_A },
      { text: PROJECT_TOOL, phashHex: PHASH_A },
    ];
    expect(detectStructuralSignal(recent)).toBeNull();
  });

  test("minor change (same product) → null", () => {
    const tweaked = `${PROJECT_TOOL} now with dark mode`;
    const recent: SnapshotPoint[] = [
      { text: tweaked, phashHex: PHASH_A },
      { text: tweaked, phashHex: PHASH_A },
      { text: PROJECT_TOOL, phashHex: PHASH_A },
    ];
    expect(detectStructuralSignal(recent)).toBeNull();
  });
});
