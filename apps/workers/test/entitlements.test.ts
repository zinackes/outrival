import { test, expect, describe } from "bun:test";
import {
  prepareEntitlements,
  rankPlansByPrice,
  MAX_ENTITLEMENT_FEATURES,
  MAX_ENTITLEMENT_PLANS,
} from "../src/lib/entitlements";
import { isSuspectedEntitlementCollapse } from "../src/lib/pricing-guard";
import type { PlanEntitlementRow } from "../src/lib/analytics";
import type { ParsedEntitlement } from "@outrival/scrapers/pricing";

const AT = new Date("2026-07-30T00:00:00Z");

const raw = (
  over: Partial<ParsedEntitlement> & Pick<ParsedEntitlement, "plan_name" | "feature_label">,
): ParsedEntitlement => ({
  kind: "boolean",
  value_num: null,
  value_text: null,
  unit: null,
  reset_period: null,
  ...over,
});

const stored = (
  over: Partial<PlanEntitlementRow> &
    Pick<PlanEntitlementRow, "plan_name" | "feature_slug" | "feature_label">,
): PlanEntitlementRow => ({
  competitor_id: "c1",
  kind: "boolean",
  value_num: null,
  value_text: null,
  unit: null,
  reset_period: null,
  is_canonical: 1,
  recorded_at: AT,
  ...over,
});

const prepare = (
  args: Partial<Parameters<typeof prepareEntitlements>[0]> & { raw: ParsedEntitlement[] },
) =>
  prepareEntitlements({
    competitorId: "c1",
    pageText: "",
    previous: null,
    planRank: ["Starter", "Pro", "Enterprise"],
    recordedAt: AT,
    ...args,
  });

describe("substring grounding (anti-hallucination, code-side)", () => {
  const page = "Compare plans. Single sign-on (SSO) — Enterprise. Audit log for Pro and up.";

  test("a label absent from the page text is dropped, whatever the prompt said", () => {
    const out = prepare({
      raw: [
        raw({ plan_name: "Enterprise", feature_label: "Single sign-on (SSO)" }),
        raw({ plan_name: "Pro", feature_label: "Quantum teleportation" }),
      ],
      pageText: page,
    });
    expect(out.rows.map((r) => r.feature_label)).toEqual(["Single sign-on (SSO)"]);
    expect(out.dropped.substring).toBe(1);
  });

  test("matching is diacritics/case/whitespace-insensitive, not verbatim-fragile", () => {
    const out = prepare({
      raw: [raw({ plan_name: "Pro", feature_label: "AUDIT   LOG" })],
      pageText: page,
    });
    expect(out.rows).toHaveLength(1);
  });
});

describe("caps (15 features × 6 plans, page order)", () => {
  test("the 16th feature is dropped and counted", () => {
    const rows = Array.from({ length: MAX_ENTITLEMENT_FEATURES + 3 }, (_, i) =>
      raw({ plan_name: "Pro", feature_label: `feature ${i}` }),
    );
    const out = prepare({
      raw: rows,
      pageText: rows.map((r) => r.feature_label).join(" "),
    });
    expect(out.rows).toHaveLength(MAX_ENTITLEMENT_FEATURES);
    expect(out.dropped.featureCap).toBe(3);
  });

  test("the 7th plan is dropped and counted", () => {
    const rows = Array.from({ length: MAX_ENTITLEMENT_PLANS + 2 }, (_, i) =>
      raw({ plan_name: `Plan ${i}`, feature_label: "SSO" }),
    );
    const out = prepare({ raw: rows, pageText: "SSO" });
    expect(out.rows).toHaveLength(MAX_ENTITLEMENT_PLANS);
    expect(out.dropped.planCap).toBe(2);
  });
});

describe("collapse guard", () => {
  const prevMatrix = Array.from({ length: 8 }, (_, i) =>
    stored({ plan_name: "Pro", feature_slug: `f_${i}`, feature_label: `feature ${i}` }),
  );

  test("a rich prior matrix extracting to one row writes nothing and signals nothing", () => {
    const out = prepare({
      raw: [raw({ plan_name: "Pro", feature_label: "feature 0" })],
      pageText: "feature 0",
      previous: prevMatrix,
    });
    expect(out.skipped).toBe("entitlement_collapse_guard");
    expect(out.rows).toEqual([]);
    expect(out.changes).toEqual([]);
  });

  test("extracting to zero on a rich prior matrix is also blocked", () => {
    expect(isSuspectedEntitlementCollapse({ prevCount: 8, nextCount: 0 })).toBe(true);
  });

  test("a small prior matrix (<5) never arms the guard — first captures stay writable", () => {
    expect(isSuspectedEntitlementCollapse({ prevCount: 4, nextCount: 0 })).toBe(false);
  });

  test("partial shrink above 30% passes and diffs normally", () => {
    expect(isSuspectedEntitlementCollapse({ prevCount: 8, nextCount: 4 })).toBe(false);
  });
});

describe("prepare → diff wiring", () => {
  test("an SSO move out of Enterprise emits the typed high change with exact strings", () => {
    const out = prepare({
      raw: [raw({ plan_name: "Pro", feature_label: "Single sign-on (SSO)" })],
      pageText: "Single sign-on (SSO) now on Pro",
      previous: [
        stored({
          plan_name: "Enterprise",
          feature_slug: "sso",
          feature_label: "Single sign-on (SSO)",
        }),
      ],
    });
    expect(out.rows[0]).toMatchObject({ feature_slug: "sso", is_canonical: 1 });
    expect(out.changes[0]).toMatchObject({
      type: "entitlement_moved",
      severity: "high",
      direction: "down",
      humanBefore: "Single sign-on (SSO) — Enterprise",
      humanAfter: "Single sign-on (SSO) — Pro",
    });
  });

  test("no previous batch → rows written, zero changes (first capture is not news)", () => {
    const out = prepare({
      raw: [raw({ plan_name: "Pro", feature_label: "Webhooks" })],
      pageText: "Webhooks",
    });
    expect(out.rows).toHaveLength(1);
    expect(out.changes).toEqual([]);
  });
});

describe("rankPlansByPrice", () => {
  test("ranks by monthly-equivalent price, quote-based tiers last", () => {
    expect(
      rankPlansByPrice([
        { plan_name: "Enterprise", price: null, currency: "USD", billing_period: "custom" },
        { plan_name: "Pro", price: 490, currency: "USD", billing_period: "yearly" },
        { plan_name: "Starter", price: 19, currency: "USD", billing_period: "monthly" },
      ]),
    ).toEqual(["Starter", "Pro", "Enterprise"]);
  });
});
