import { describe, expect, test } from "bun:test";
import {
  normalizeThemeKey,
  detectThemeShifts,
  planThemeShiftEmissions,
  mergeRisingThemeObjections,
  detectScoreDrop,
  planScoreDropEmission,
  type ThemeSeriesRow,
  type RisingTheme,
  type ScoreSeriesRow,
} from "../src/lib/review-theme-shift";

// Review complaint-theme inflection detection (feature 2026-07-11). The themes are
// already clustered upstream (patch-32 → review_scores.complaint_themes); this suite
// covers the three load-bearing pure pieces: (a) label normalization merges near-
// identical phrasings, (b) a sliding-window rise emits while stable noise stays
// silent, (c) the rising theme is injected as a battle-card objection + the plan
// signals the refresh flag.

const NOW = new Date("2026-07-11T00:00:00Z");
function day(offset: number): Date {
  return new Date(NOW.getTime() - offset * 86_400_000);
}
function row(source: string, offset: number, themes: Array<[string, string]>): ThemeSeriesRow {
  return {
    source,
    recordedAt: day(offset),
    themes: themes.map(([theme, prevalence]) => ({ theme, prevalence })),
  };
}

// ── (a) normalization ────────────────────────────────────────────────────────────
describe("normalizeThemeKey — (a) merges near-identical phrasings", () => {
  test("two phrasings of the same grievance collapse to one key", () => {
    expect(normalizeThemeKey("slow support")).toBe(normalizeThemeKey("Support is slow"));
    expect(normalizeThemeKey("onboarding is slow")).toBe(normalizeThemeKey("slow onboarding"));
    expect(normalizeThemeKey("Too many bugs")).toBe(normalizeThemeKey("bug"));
  });

  test("distinct grievances stay distinct (no over-merge)", () => {
    expect(normalizeThemeKey("slow support")).not.toBe(normalizeThemeKey("expensive pricing"));
    // sentiment words carry meaning and must NOT be stripped
    expect(normalizeThemeKey("slow support")).not.toBe(normalizeThemeKey("great support"));
  });
});

// ── (b) sliding-window rise vs stable noise ──────────────────────────────────────
// Baseline (42-84 days ago): only "pricing confusion" (medium). Recent (≤42 days):
// "onboarding" rises from absent → high (three different phrasings, must merge), while
// "pricing confusion" stays medium (stable).
const risingSeries: ThemeSeriesRow[] = [
  row("g2", 80, [["pricing confusion", "medium"]]),
  row("g2", 70, [["pricing confusion", "medium"]]),
  row("g2", 56, [["pricing confusion", "medium"]]),
  row("g2", 30, [["onboarding is slow", "high"], ["pricing confusion", "medium"]]),
  row("g2", 14, [["slow onboarding", "high"], ["pricing confusion", "medium"]]),
  row("capterra", 3, [["onboarding slow", "high"], ["pricing confusion", "medium"]]),
];

describe("detectThemeShifts — (b) rise emits, stable noise stays silent", () => {
  const rising = detectThemeShifts(risingSeries, { now: NOW });

  test("exactly the rising theme surfaces", () => {
    expect(rising.length).toBe(1);
    expect(rising[0]!.label.toLowerCase()).toContain("onboarding");
    // the three phrasings merged into one normalized theme
    expect(normalizeThemeKey(rising[0]!.label)).toBe("onboarding slow");
  });

  test("the stable theme does NOT surface", () => {
    expect(rising.some((r) => r.key.includes("pricing") || r.key.includes("confusion"))).toBe(false);
  });

  test("evidence carries sources + recent dates (grounding)", () => {
    expect(rising[0]!.sources).toContain("g2");
    expect(rising[0]!.sources).toContain("capterra");
    expect(rising[0]!.recentDates.length).toBeGreaterThanOrEqual(2);
    expect(rising[0]!.baselineScore).toBe(0);
    expect(rising[0]!.recentScore).toBeGreaterThan(rising[0]!.baselineScore);
  });

  test("a fully stable series emits nothing", () => {
    const stable: ThemeSeriesRow[] = [
      row("g2", 80, [["pricing confusion", "medium"]]),
      row("g2", 56, [["pricing confusion", "medium"]]),
      row("g2", 30, [["pricing confusion", "medium"]]),
      row("g2", 10, [["pricing confusion", "medium"]]),
    ];
    expect(detectThemeShifts(stable, { now: NOW })).toHaveLength(0);
  });

  test("a single-scrape blip is below the min-occurrence floor → nothing", () => {
    const blip: ThemeSeriesRow[] = [
      row("g2", 70, [["pricing confusion", "medium"]]),
      row("g2", 30, [["pricing confusion", "medium"]]),
      row("g2", 3, [["random one-off gripe", "high"], ["pricing confusion", "medium"]]),
    ];
    const r = detectThemeShifts(blip, { now: NOW });
    expect(r.some((x) => x.key.includes("gripe"))).toBe(false);
  });
});

// ── planner: grounded reviews emission ───────────────────────────────────────────
describe("planThemeShiftEmissions — grounded reviews signal", () => {
  const rising = detectThemeShifts(risingSeries, { now: NOW });

  test("emits a significant reviews classification grounded on sources + dates", () => {
    const { emission, shouldFlagBattleCards } = planThemeShiftEmissions(rising, {
      competitorName: "Acme",
      windowDays: 42,
    });
    expect(emission).not.toBeNull();
    expect(shouldFlagBattleCards).toBe(true);
    expect(emission!.classification.category).toBe("reviews");
    expect(emission!.classification.is_significant).toBe(true);
    expect(emission!.classification.severity).toBe("high");
    expect(emission!.diffText.toLowerCase()).toContain("onboarding");
    expect(emission!.diffText).toContain("g2");
    expect(emission!.diffText).toMatch(/202\d-\d{2}-\d{2}/); // an ISO date = grounding evidence
    expect(emission!.risingKeys).toContain("onboarding slow");
  });

  test("nothing rising → no emission, no flag", () => {
    const { emission, shouldFlagBattleCards } = planThemeShiftEmissions([], {
      competitorName: "Acme",
      windowDays: 42,
    });
    expect(emission).toBeNull();
    expect(shouldFlagBattleCards).toBe(false);
  });

  test("bonus: a recent pricing/product signal adds a causality note", () => {
    const { emission } = planThemeShiftEmissions(rising, {
      competitorName: "Acme",
      windowDays: 42,
      causalitySignals: [
        { category: "pricing", insight: "Raised Pro to $99/mo", createdAt: day(20) },
      ],
    });
    expect(emission!.diffText.toLowerCase()).toContain("coincides");
    expect(emission!.diffText).toContain("Raised Pro to $99/mo");
  });
});

// ── (c) battle-card objection injection ──────────────────────────────────────────
const RISING: RisingTheme[] = [
  {
    key: "onboarding slow",
    label: "slow onboarding",
    recentScore: 3,
    baselineScore: 0,
    delta: 3,
    sources: ["g2"],
    recentDates: [new Date("2026-07-08T00:00:00Z")],
    peakPrevalence: "high",
  },
];

function emptyCard(objections: Array<{ objection: string; response: string }> = []) {
  return {
    their_strengths: [],
    our_strengths: [],
    their_weaknesses: [],
    common_objections: objections,
    when_we_win: [],
    when_we_lose: [],
  };
}

describe("mergeRisingThemeObjections — (c) injects the rising complaint", () => {
  test("adds the rising theme as an objection, keeps existing ones", () => {
    const card = emptyCard([{ objection: "They're cheaper", response: "Value framing" }]);
    const merged = mergeRisingThemeObjections(card, RISING, {
      competitorName: "Acme",
      myProductName: "Us",
      valueProp: "instant onboarding",
    });
    expect(merged.common_objections.length).toBe(2);
    // injected first (fresh munition)
    expect(merged.common_objections[0]!.objection.toLowerCase()).toContain("onboarding");
    expect(merged.common_objections[0]!.response.toLowerCase()).toContain("instant onboarding");
    // existing preserved
    expect(merged.common_objections.some((o) => o.objection === "They're cheaper")).toBe(true);
  });

  test("does not duplicate a theme the AI already raised", () => {
    const card = emptyCard([
      { objection: "Reviewers mention slow onboarding a lot", response: "x" },
    ]);
    const merged = mergeRisingThemeObjections(card, RISING, { competitorName: "Acme" });
    expect(merged.common_objections.length).toBe(1);
  });

  test("respects the schema cap of 5, injected theme wins", () => {
    const card = emptyCard(
      Array.from({ length: 5 }, (_, i) => ({ objection: `existing ${i}`, response: "r" })),
    );
    const merged = mergeRisingThemeObjections(card, RISING, { competitorName: "Acme" });
    expect(merged.common_objections.length).toBe(5);
    expect(merged.common_objections[0]!.objection.toLowerCase()).toContain("onboarding");
  });

  test("no rising themes → card unchanged", () => {
    const card = emptyCard([{ objection: "a", response: "b" }]);
    expect(mergeRisingThemeObjections(card, [], { competitorName: "Acme" })).toEqual(card);
  });
});

// ── (d) aggregate-score inflection (Reviews v2) ──────────────────────────────────
// Surface sources (Trustpilot) carry a score but no verbatims; a sustained score
// drop is the reviews signal. detectScoreDrop compares recent vs baseline windows.

function srow(source: string, offset: number, score: number, reviewCount = 100): ScoreSeriesRow {
  return { source, recordedAt: day(offset), score, reviewCount };
}

describe("detectScoreDrop", () => {
  const opts = { now: NOW, windowDays: 42, lookbackDays: 84 };

  test("a sustained drop is detected with the right delta", () => {
    const rows = [
      srow("trustpilot", 70, 4.5),
      srow("trustpilot", 55, 4.5),
      srow("trustpilot", 12, 4.2),
      srow("trustpilot", 4, 4.2),
    ];
    const drop = detectScoreDrop(rows, opts);
    expect(drop).not.toBeNull();
    expect(drop!.baselineAvg).toBeCloseTo(4.5, 5);
    expect(drop!.recentAvg).toBeCloseTo(4.2, 5);
    expect(drop!.delta).toBeCloseTo(0.3, 5);
    expect(drop!.latestScore).toBe(4.2); // oldest-first input → latest is the newest recent row
  });

  test("a stable score returns null (no drop)", () => {
    const rows = [srow("trustpilot", 70, 4.5), srow("trustpilot", 12, 4.5), srow("trustpilot", 4, 4.5)];
    expect(detectScoreDrop(rows, opts)).toBeNull();
  });

  test("a rising score returns null", () => {
    const rows = [srow("trustpilot", 70, 4.2), srow("trustpilot", 12, 4.6), srow("trustpilot", 4, 4.6)];
    expect(detectScoreDrop(rows, opts)).toBeNull();
  });

  test("too few recent points returns null", () => {
    const rows = [srow("trustpilot", 70, 4.5), srow("trustpilot", 55, 4.5), srow("trustpilot", 4, 4.0)];
    expect(detectScoreDrop(rows, opts)).toBeNull(); // only 1 recent point (minRecentPoints=2)
  });

  test("a drop below threshold returns null", () => {
    const rows = [
      srow("trustpilot", 70, 4.5),
      srow("trustpilot", 12, 4.45),
      srow("trustpilot", 4, 4.45),
    ];
    expect(detectScoreDrop(rows, { ...opts, dropThreshold: 0.2 })).toBeNull(); // 0.05 < 0.2
  });
});

describe("planScoreDropEmission", () => {
  test("packages a drop as a reviews emission with a rounded dedup key", () => {
    const drop = detectScoreDrop(
      [srow("trustpilot", 70, 4.5), srow("trustpilot", 55, 4.5), srow("trustpilot", 12, 4.0), srow("trustpilot", 4, 4.0)],
      { now: NOW, windowDays: 42, lookbackDays: 84 },
    );
    const { emission, shouldFlagBattleCards } = planScoreDropEmission(drop, {
      competitorName: "Acme",
      windowDays: 42,
    });
    expect(emission).not.toBeNull();
    expect(emission!.classification.category).toBe("reviews");
    expect(emission!.classification.severity).toBe("high"); // delta 0.5 → high
    expect(emission!.risingKeys).toEqual(["score-drop:4.5->4.0"]);
    expect(emission!.diffText).toContain("4.5 → 4.0");
    expect(shouldFlagBattleCards).toBe(true);
  });

  test("null drop → no emission", () => {
    expect(planScoreDropEmission(null, { competitorName: "Acme", windowDays: 42 })).toEqual({
      emission: null,
      shouldFlagBattleCards: false,
    });
  });
});
