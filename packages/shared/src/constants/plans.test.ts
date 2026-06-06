import { afterEach, describe, expect, test } from "bun:test";
import {
  PLANS,
  PLAN_LIMITS,
  clampFrequencyToPlan,
  forcedRescansPerDay,
  isWithinLimit,
  productLimit,
  type Plan,
} from "./plans";
import type { MonitorFrequency } from "./sources";

// The decided grid (Notion "Repenser limites par tier", 2026-06-04). These are the
// numbers that must not silently drift — one row per dimension, all four tiers.
const rows = {
  maxCompetitors: { free: 2, starter: 5, pro: 15, business: 50 },
  forcedRescansPerDay: { free: 1, starter: 5, pro: 20, business: 100 },
  battleCardsPerDay: { free: 1, starter: 10, pro: 50, business: 100 },
  discoveriesPerMonth: { free: 3, starter: 20, pro: 100, business: 500 },
  usersPerOrg: { free: 1, starter: 1, pro: 3, business: 10 },
  historyRetentionDays: { free: 7, starter: 30, pro: 365, business: 1095 },
} as const;

describe("PLAN_LIMITS — decided grid (2026-06-04)", () => {
  for (const [dimension, perTier] of Object.entries(rows)) {
    for (const plan of PLANS) {
      test(`${dimension} / ${plan} = ${perTier[plan]}`, () => {
        expect(PLAN_LIMITS[plan][dimension as keyof typeof rows]).toBe(perTier[plan]);
      });
    }
  }

  test("business maxCompetitors is a real cap, never Infinity", () => {
    expect(Number.isFinite(PLAN_LIMITS.business.maxCompetitors)).toBe(true);
    expect(PLAN_LIMITS.business.maxCompetitors).toBe(50);
  });

  test("scrapeFrequency ladder", () => {
    expect(PLANS.map((p) => PLAN_LIMITS[p].scrapeFrequency)).toEqual([
      "weekly",
      "daily",
      "daily_adaptive",
      "daily_priority",
    ]);
  });
});

describe("PLAN_LIMITS — features", () => {
  test("battle cards open on every tier (governed by the daily cap)", () => {
    for (const plan of PLANS) expect(PLAN_LIMITS[plan].features.battleCards).toBe(true);
  });

  test("api + crmIntegrations are business-only", () => {
    for (const plan of PLANS) {
      const business = plan === "business";
      expect(PLAN_LIMITS[plan].features.api).toBe(business);
      expect(PLAN_LIMITS[plan].features.crmIntegrations).toBe(business);
    }
  });

  test("fullMode off only on free", () => {
    expect(PLAN_LIMITS.free.features.fullMode).toBe(false);
    for (const plan of ["starter", "pro", "business"] as const) {
      expect(PLAN_LIMITS[plan].features.fullMode).toBe(true);
    }
  });
});

describe("forcedRescansPerDay", () => {
  const KEYS = {
    free: "FORCED_RESCAN_LIMIT_FREE",
    starter: "FORCED_RESCAN_LIMIT_STARTER",
    pro: "FORCED_RESCAN_LIMIT_PRO",
    business: "FORCED_RESCAN_LIMIT_BUSINESS",
  } as const;

  afterEach(() => {
    for (const k of Object.values(KEYS)) delete process.env[k];
  });

  test("defaults match PLAN_LIMITS (business = 100, not unlimited)", () => {
    expect(forcedRescansPerDay("business")).toBe(100);
    for (const plan of PLANS) {
      expect(forcedRescansPerDay(plan)).toBe(PLAN_LIMITS[plan].forcedRescansPerDay);
    }
  });

  test("env overrides the default", () => {
    process.env.FORCED_RESCAN_LIMIT_BUSINESS = "250";
    expect(forcedRescansPerDay("business")).toBe(250);
  });

  test("ignores a non-positive / garbage env override", () => {
    process.env.FORCED_RESCAN_LIMIT_PRO = "0";
    expect(forcedRescansPerDay("pro")).toBe(20);
    process.env.FORCED_RESCAN_LIMIT_PRO = "abc";
    expect(forcedRescansPerDay("pro")).toBe(20);
  });
});

describe("productLimit defaults (unchanged by tier-limits)", () => {
  test.each([
    ["free", 1],
    ["starter", 2],
    ["pro", 5],
    ["business", 999],
  ] as const)("%s = %d", (plan, expected) => {
    expect(productLimit(plan)).toBe(expected);
  });
});

describe("clampFrequencyToPlan — downgrade throttling", () => {
  // requested → expected, per tier. Free has only weekly; starter caps at daily.
  const cases: Record<Plan, Record<MonitorFrequency, MonitorFrequency>> = {
    free: { realtime: "weekly", daily: "weekly", weekly: "weekly" },
    starter: { realtime: "daily", daily: "daily", weekly: "weekly" },
    pro: { realtime: "realtime", daily: "daily", weekly: "weekly" },
    business: { realtime: "realtime", daily: "daily", weekly: "weekly" },
  };
  for (const plan of PLANS) {
    for (const [req, expected] of Object.entries(cases[plan])) {
      test(`${plan}: ${req} → ${expected}`, () => {
        expect(clampFrequencyToPlan(plan, req as MonitorFrequency)).toBe(expected);
      });
    }
  }

  test("an allowed frequency is never altered", () => {
    for (const plan of PLANS) {
      for (const freq of PLAN_LIMITS[plan].allowedFrequencies) {
        expect(clampFrequencyToPlan(plan, freq)).toBe(freq);
      }
    }
  });
});

describe("isWithinLimit — below / at / above the threshold", () => {
  test("below the limit is allowed", () => {
    expect(isWithinLimit(1, 3)).toBe(true);
  });
  test("the last slot (used + 1 === limit) is allowed", () => {
    expect(isWithinLimit(2, 3)).toBe(true);
  });
  test("at the limit, adding one more is blocked", () => {
    expect(isWithinLimit(3, 3)).toBe(false);
  });
  test("above the limit is blocked", () => {
    expect(isWithinLimit(4, 3)).toBe(false);
  });
  test("adding zero never blocks at the limit", () => {
    expect(isWithinLimit(3, 3, 0)).toBe(true);
  });
});
