import { describe, expect, test } from "bun:test";
import { countActivePages, type MonitorRosterRow } from "../src/lib/digest-counts";

// Lever 6 — the all-quiet weekly briefing's "N pages" count. Pure roster
// filtering: active, non-internal-anchor, non-self monitors only. The DB-hitting
// wrapper (getAllQuietCounts) isn't unit-tested here (no DB in this suite); this
// locks the filtering rule it depends on.

const row = (overrides: Partial<MonitorRosterRow>): MonitorRosterRow => ({
  isActive: true,
  sourceType: "homepage",
  competitorType: "competitor",
  ...overrides,
});

describe("countActivePages", () => {
  test("counts active, user-facing monitors", () => {
    const rows = [
      row({ sourceType: "homepage" }),
      row({ sourceType: "pricing" }),
      row({ sourceType: "blog" }),
    ];
    expect(countActivePages(rows)).toBe(3);
  });

  test("excludes inactive monitors", () => {
    const rows = [row({ isActive: true }), row({ isActive: false })];
    expect(countActivePages(rows)).toBe(1);
  });

  test("excludes internal anchors (tech_stack, sitemap, news)", () => {
    const rows = [
      row({ sourceType: "homepage" }),
      row({ sourceType: "tech_stack" }),
      row({ sourceType: "sitemap" }),
      row({ sourceType: "news" }),
    ];
    expect(countActivePages(rows)).toBe(1);
  });

  test("excludes the org's own self-product monitors", () => {
    const rows = [
      row({ competitorType: "competitor" }),
      row({ competitorType: "self" }),
    ];
    expect(countActivePages(rows)).toBe(1);
  });

  test("empty roster → 0", () => {
    expect(countActivePages([])).toBe(0);
  });
});
