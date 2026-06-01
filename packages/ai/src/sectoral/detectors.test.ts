import { describe, expect, it } from "bun:test";
import {
  detectFeatureTrends,
  detectHiringTrends,
  detectPricingTrends,
  detectPositioningShifts,
} from "./detectors";
import type { CompetitorSectoralData } from "./types";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

function comp(
  id: string,
  name: string,
  over: Partial<CompetitorSectoralData> = {},
): CompetitorSectoralData {
  return {
    id,
    name,
    productSignals: [],
    jobs: [],
    pricePoints: [],
    statusTimeline: [],
    ...over,
  };
}

describe("detectFeatureTrends", () => {
  it("flags a theme shared by ≥40% of competitors", () => {
    const competitors: CompetitorSectoralData[] = [
      comp("1", "Alpha", { productSignals: [{ insight: "Shipped an AI copilot", soWhat: null, createdAt: daysAgo(3) }] }),
      comp("2", "Beta", { productSignals: [{ insight: "New LLM-powered search", soWhat: null, createdAt: daysAgo(5) }] }),
      comp("3", "Gamma", { productSignals: [{ insight: "Added an AI assistant", soWhat: "automate triage", createdAt: daysAgo(8) }] }),
      comp("4", "Delta", { productSignals: [{ insight: "Launched generative drafts", soWhat: null, createdAt: daysAgo(10) }] }),
      // false-positive guard: "email" must NOT match the "ai" token.
      comp("5", "Epsilon", { productSignals: [{ insight: "New email and domain templates", soWhat: null, createdAt: daysAgo(4) }] }),
      comp("6", "Zeta"),
      comp("7", "Eta"),
      comp("8", "Theta"),
    ];

    const patterns = detectFeatureTrends(competitors, 30);
    const ai = patterns.find((p) => p.evidence.metric === "feature_theme:AI");
    expect(ai).toBeDefined();
    expect(ai!.category).toBe("feature_trend");
    expect(ai!.evidence.competitors).toHaveLength(4);
    expect(ai!.evidence.competitors.map((c) => c.name)).not.toContain("Epsilon");
    expect(ai!.confidence).toBeCloseTo(0.5);
  });

  it("ignores a theme under the 40% / 2-competitor floor", () => {
    const competitors = [
      comp("1", "Alpha", { productSignals: [{ insight: "Shipped an AI copilot", soWhat: null, createdAt: daysAgo(3) }] }),
      comp("2", "Beta"),
      comp("3", "Gamma"),
      comp("4", "Delta"),
    ];
    expect(detectFeatureTrends(competitors, 30)).toHaveLength(0);
  });

  it("ignores signals outside the window", () => {
    const competitors = [
      comp("1", "Alpha", { productSignals: [{ insight: "AI copilot", soWhat: null, createdAt: daysAgo(99) }] }),
      comp("2", "Beta", { productSignals: [{ insight: "AI assistant", soWhat: null, createdAt: daysAgo(99) }] }),
      comp("3", "Gamma"),
      comp("4", "Delta"),
    ];
    expect(detectFeatureTrends(competitors, 30)).toHaveLength(0);
  });
});

describe("detectHiringTrends", () => {
  it("flags a role category hired by ≥3 competitors", () => {
    const competitors = [
      comp("1", "Alpha", { jobs: [{ title: "Account Executive", department: "Sales", detectedAt: daysAgo(2) }] }),
      comp("2", "Beta", { jobs: [{ title: "Enterprise AE", department: null, detectedAt: daysAgo(4) }] }),
      comp("3", "Gamma", { jobs: [{ title: "SDR", department: "Sales", detectedAt: daysAgo(6) }] }),
      comp("4", "Delta", { jobs: [{ title: "Backend Engineer", department: "Engineering", detectedAt: daysAgo(3) }] }),
      comp("5", "Epsilon"),
      comp("6", "Zeta"),
      comp("7", "Eta"),
      comp("8", "Theta"),
    ];

    const patterns = detectHiringTrends(competitors, 30);
    const sales = patterns.find((p) => p.evidence.metric === "hiring_role:sales");
    expect(sales).toBeDefined();
    expect(sales!.evidence.competitors).toHaveLength(3);
    expect(sales!.confidence).toBeCloseTo(3 / 8);
    // engineering: only 1 competitor → not a pattern.
    expect(patterns.find((p) => p.evidence.metric === "hiring_role:engineering")).toBeUndefined();
  });

  it("needs at least 3 competitors", () => {
    const competitors = [
      comp("1", "Alpha", { jobs: [{ title: "Account Executive", department: "Sales", detectedAt: daysAgo(2) }] }),
      comp("2", "Beta", { jobs: [{ title: "SDR", department: "Sales", detectedAt: daysAgo(2) }] }),
      comp("3", "Gamma"),
      comp("4", "Delta"),
    ];
    expect(detectHiringTrends(competitors, 30)).toHaveLength(0);
  });
});

describe("detectPricingTrends", () => {
  it("flags a median price drop over the window", () => {
    const mk = (id: string, name: string, start: number, end: number) =>
      comp(id, name, {
        pricePoints: [
          { planName: "pro", price: start, recordedAt: daysAgo(60) },
          { planName: "pro", price: end, recordedAt: daysAgo(5) },
        ],
      });
    const competitors = [
      mk("1", "Alpha", 100, 85), // -15%
      mk("2", "Beta", 100, 80), // -20%
      mk("3", "Gamma", 100, 88), // -12%
    ];

    const patterns = detectPricingTrends(competitors, 90);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.category).toBe("pricing_trend");
    expect(patterns[0]!.rawSignal).toContain("dropped");
    // median of [-20,-15,-12] = -15% → 0.15 / 0.2 = 0.75
    expect(patterns[0]!.confidence).toBeCloseTo(0.75);
  });

  it("needs ≥3 competitors with a real trajectory", () => {
    const competitors = [
      comp("1", "Alpha", { pricePoints: [{ planName: "pro", price: 100, recordedAt: daysAgo(60) }, { planName: "pro", price: 70, recordedAt: daysAgo(5) }] }),
      comp("2", "Beta", { pricePoints: [{ planName: "pro", price: 100, recordedAt: daysAgo(60) }, { planName: "pro", price: 70, recordedAt: daysAgo(5) }] }),
    ];
    expect(detectPricingTrends(competitors, 90)).toHaveLength(0);
  });

  it("ignores a stable sector (<10% move)", () => {
    const mk = (id: string, name: string, end: number) =>
      comp(id, name, { pricePoints: [{ planName: "pro", price: 100, recordedAt: daysAgo(60) }, { planName: "pro", price: end, recordedAt: daysAgo(5) }] });
    const competitors = [mk("1", "Alpha", 103), mk("2", "Beta", 98), mk("3", "Gamma", 101)];
    expect(detectPricingTrends(competitors, 90)).toHaveLength(0);
  });
});

describe("detectPositioningShifts", () => {
  it("flags ≥2 competitors gating their pricing", () => {
    const competitors = [
      comp("1", "Alpha", { statusTimeline: [{ status: "public", recordedAt: daysAgo(20) }, { status: "gated_demo", recordedAt: daysAgo(2) }] }),
      comp("2", "Beta", { statusTimeline: [{ status: "public", recordedAt: daysAgo(20) }, { status: "contact_sales", recordedAt: daysAgo(2) }] }),
      comp("3", "Gamma", { statusTimeline: [{ status: "public", recordedAt: daysAgo(20) }, { status: "public", recordedAt: daysAgo(2) }] }),
      comp("4", "Delta"),
    ];

    const patterns = detectPositioningShifts(competitors, 30);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.category).toBe("positioning_shift");
    expect(patterns[0]!.evidence.competitors).toHaveLength(2);
    expect(patterns[0]!.confidence).toBeCloseTo(0.6);
  });

  it("ignores a single gating competitor", () => {
    const competitors = [
      comp("1", "Alpha", { statusTimeline: [{ status: "public", recordedAt: daysAgo(20) }, { status: "gated_demo", recordedAt: daysAgo(2) }] }),
      comp("2", "Beta", { statusTimeline: [{ status: "public", recordedAt: daysAgo(20) }, { status: "public", recordedAt: daysAgo(2) }] }),
      comp("3", "Gamma"),
      comp("4", "Delta"),
    ];
    expect(detectPositioningShifts(competitors, 30)).toHaveLength(0);
  });
});
