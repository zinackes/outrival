import { test, expect, describe } from "bun:test";
import { diffEntitlements, type EntitlementRow } from "./entitlement-diff";

const row = (over: Partial<EntitlementRow> & Pick<EntitlementRow, "plan_name" | "feature_slug">): EntitlementRow => ({
  feature_label: over.feature_slug,
  kind: "boolean",
  is_canonical: 1,
  ...over,
});

const RANK = ["Free", "Starter", "Pro", "Enterprise"];

describe("guards", () => {
  test("empty prev (first capture) yields nothing", () => {
    expect(diffEntitlements([], [row({ plan_name: "Pro", feature_slug: "sso" })])).toEqual([]);
  });

  test("empty next yields nothing (collapse is the caller's guard)", () => {
    expect(diffEntitlements([row({ plan_name: "Pro", feature_slug: "sso" })], [])).toEqual([]);
  });

  test("identical batches yield nothing", () => {
    const batch = [
      row({ plan_name: "Pro", feature_slug: "sso", feature_label: "SSO" }),
      row({ plan_name: "Starter", feature_slug: "seats_included", kind: "metered", value_num: 5, unit: "seats" }),
    ];
    expect(diffEntitlements(batch, batch)).toEqual([]);
  });

  test("never emits critical", () => {
    // Worst case on every axis at once: move + huge limit cut + add + remove.
    const prev = [
      row({ plan_name: "Enterprise", feature_slug: "sso" }),
      row({ plan_name: "Starter", feature_slug: "seats_included", kind: "metered", value_num: 100, unit: "seats" }),
      row({ plan_name: "Pro", feature_slug: "audit_log" }),
    ];
    const next = [
      row({ plan_name: "Free", feature_slug: "sso" }),
      row({ plan_name: "Starter", feature_slug: "seats_included", kind: "metered", value_num: 1, unit: "seats" }),
      row({ plan_name: "Pro", feature_slug: "white_label" }),
    ];
    const changes = diffEntitlements(prev, next, { planRank: RANK });
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((c) => c.severity !== "critical")).toBe(true);
  });
});

describe("entitlement_moved", () => {
  test("SSO leaving Enterprise for Pro is high, downmarket, exact human strings", () => {
    const prev = [row({ plan_name: "Enterprise", feature_slug: "sso", feature_label: "SSO" })];
    const next = [row({ plan_name: "Pro", feature_slug: "sso", feature_label: "SSO" })];
    const [c] = diffEntitlements(prev, next, { planRank: RANK });
    expect(c).toMatchObject({
      type: "entitlement_moved",
      severity: "high",
      direction: "down",
      humanBefore: "SSO — Enterprise",
      humanAfter: "SSO — Pro",
    });
    expect(c!.summary).toContain("downmarket");
  });

  test("a feature retreating into Enterprise reads upmarket", () => {
    const prev = [
      row({ plan_name: "Pro", feature_slug: "audit_log", feature_label: "Audit log" }),
      row({ plan_name: "Enterprise", feature_slug: "audit_log", feature_label: "Audit log" }),
    ];
    const next = [row({ plan_name: "Enterprise", feature_slug: "audit_log", feature_label: "Audit log" })];
    const [c] = diffEntitlements(prev, next, { planRank: RANK });
    expect(c).toMatchObject({ type: "entitlement_moved", direction: "up" });
  });

  test("widening to one more plan without a rank still reads downmarket", () => {
    const prev = [row({ plan_name: "Enterprise", feature_slug: "sso" })];
    const next = [
      row({ plan_name: "Enterprise", feature_slug: "sso" }),
      row({ plan_name: "Pro", feature_slug: "sso" }),
    ];
    const [c] = diffEntitlements(prev, next);
    expect(c).toMatchObject({ type: "entitlement_moved", direction: "down" });
  });

  test("a free-text feature changing plans emits nothing (rewording churn)", () => {
    const prev = [
      row({ plan_name: "Pro", feature_slug: "magic_wand", is_canonical: 0 }),
      row({ plan_name: "Pro", feature_slug: "sso" }),
    ];
    const next = [
      row({ plan_name: "Enterprise", feature_slug: "magic_wand", is_canonical: 0 }),
      row({ plan_name: "Pro", feature_slug: "sso" }),
    ];
    expect(diffEntitlements(prev, next, { planRank: RANK })).toEqual([]);
  });
});

describe("entitlement_limit_changed", () => {
  const seats = (value: number): EntitlementRow =>
    row({
      plan_name: "Starter",
      feature_slug: "seats_included",
      feature_label: "Users included",
      kind: "metered",
      value_num: value,
      unit: "seats",
    });

  test("5 → 4 seats is medium (−20%), exact human strings", () => {
    const [c] = diffEntitlements([seats(5)], [seats(4)]);
    expect(c).toMatchObject({
      type: "entitlement_limit_changed",
      severity: "medium",
      previousValue: 5,
      currentValue: 4,
      pctChange: -20,
      direction: "down",
      humanBefore: "Starter — 5 seats",
      humanAfter: "Starter — 4 seats",
    });
  });

  test("5 → 3 seats crosses the 30% bar and reads high", () => {
    const [c] = diffEntitlements([seats(5)], [seats(3)]);
    expect(c).toMatchObject({ type: "entitlement_limit_changed", severity: "high", pctChange: -40 });
  });

  test("a raised limit is signalled too, direction up", () => {
    const [c] = diffEntitlements([seats(5)], [seats(10)]);
    expect(c).toMatchObject({ severity: "high", direction: "up", pctChange: 100 });
  });

  test("an identical free-text slug still qualifies (same wording = same feature)", () => {
    const mk = (v: number) =>
      row({
        plan_name: "Pro",
        feature_slug: "monthly_active_widgets",
        feature_label: "Monthly active widgets",
        kind: "metered",
        value_num: v,
        is_canonical: 0,
      });
    const [c] = diffEntitlements([mk(1000)], [mk(500)]);
    expect(c).toMatchObject({ type: "entitlement_limit_changed", severity: "high" });
  });

  test("a value appearing where none was stated is not a limit change", () => {
    const prev = [row({ plan_name: "Pro", feature_slug: "retention", kind: "boolean" })];
    const next = [
      row({ plan_name: "Pro", feature_slug: "retention", kind: "metered", value_num: 30, unit: "days" }),
    ];
    expect(diffEntitlements(prev, next)).toEqual([]);
  });
});

describe("entitlement_added / entitlement_removed", () => {
  const anchor = row({ plan_name: "Pro", feature_slug: "webhooks" });

  test("a canonical feature appearing is low", () => {
    const next = [anchor, row({ plan_name: "Enterprise", feature_slug: "sso", feature_label: "SSO" })];
    const [c] = diffEntitlements([anchor], next);
    expect(c).toMatchObject({
      type: "entitlement_added",
      severity: "low",
      humanAfter: "SSO — Enterprise",
    });
  });

  test("a canonical feature vanishing from the matrix is medium", () => {
    const prev = [anchor, row({ plan_name: "Pro", feature_slug: "audit_log", feature_label: "Audit log" })];
    const [c] = diffEntitlements(prev, [anchor]);
    expect(c).toMatchObject({
      type: "entitlement_removed",
      severity: "medium",
      humanBefore: "Audit log — Pro",
      humanAfter: null,
    });
  });

  test("free-text appear/disappear stays silent", () => {
    const prev = [anchor, row({ plan_name: "Pro", feature_slug: "old_wording", is_canonical: 0 })];
    const next = [anchor, row({ plan_name: "Pro", feature_slug: "new_wording", is_canonical: 0 })];
    expect(diffEntitlements(prev, next)).toEqual([]);
  });
});
