import { describe, expect, it } from "bun:test";
import { compareEntitlements, compareSummaryLines, type SidePlans } from "./entitlement-compare";
import type { EntitlementRow } from "./entitlement-diff";

function cell(
  planName: string,
  slug: string,
  label: string,
  extra: Partial<EntitlementRow> = {},
): EntitlementRow {
  return {
    plan_name: planName,
    feature_slug: slug,
    feature_label: label,
    kind: "boolean",
    is_canonical: 1,
    ...extra,
  };
}

const side = (cells: EntitlementRow[], plans: Record<string, number | null>): SidePlans => ({
  cells,
  planMonthly: new Map(Object.entries(plans)),
});

describe("compareEntitlements", () => {
  it("returns nothing when neither side captured a matrix", () => {
    expect(compareEntitlements(side([], {}), side([], {}))).toEqual([]);
  });

  it("never crosses a free-text slug, even when both pages word it the same", () => {
    const ours = side([cell("Pro", "priority_e_mail_routing", "Priority e-mail routing", { is_canonical: 0 })], {
      pro: 49,
    });
    const theirs = side(
      [cell("Business", "priority_e_mail_routing", "Priority e-mail routing", { is_canonical: 0 })],
      { business: 99 },
    );
    expect(compareEntitlements(ours, theirs)).toEqual([]);
  });

  it("anchors on the cheapest plan that lists the feature", () => {
    const ours = side(
      [cell("Pro", "sso", "SSO"), cell("Enterprise", "sso", "SSO")],
      { free: 0, pro: 49, enterprise: 199 },
    );
    const theirs = side([cell("Business", "sso", "Single sign-on")], { starter: 19, business: 99 });

    const [row] = compareEntitlements(ours, theirs);
    expect(row?.label).toBe("Single sign-on");
    expect(row?.ours).toMatchObject({ planName: "Pro", monthly: 49 });
    expect(row?.theirs).toMatchObject({ planName: "Business", monthly: 99 });
    expect(row?.priceVerdict).toBe("cheaper");
  });

  it("reads a one-sided feature as not listed, never as not offered", () => {
    const rows = compareEntitlements(
      side([], {}),
      side([cell("Business", "audit_log", "Audit log")], { business: 99 }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.priceVerdict).toBe("only_them");
    expect(rows[0]?.ours).toBeNull();

    const mirrored = compareEntitlements(
      side([cell("Pro", "audit_log", "Audit log")], { pro: 49 }),
      side([], {}),
    );
    expect(mirrored[0]?.priceVerdict).toBe("only_us");
  });

  it("gives no price verdict when a side is quote-based", () => {
    const rows = compareEntitlements(
      side([cell("Pro", "sla", "SLA")], { pro: 49 }),
      side([cell("Enterprise", "sla", "SLA")], { enterprise: null }),
    );
    expect(rows[0]?.priceVerdict).toBeNull();
    expect(rows[0]?.theirs).toMatchObject({ planName: "Enterprise", monthly: null });
  });

  it("prefers a priced plan over a quote-based one on the same feature", () => {
    const rows = compareEntitlements(
      side([cell("Enterprise", "sso", "SSO"), cell("Pro", "sso", "SSO")], {
        pro: 49,
        enterprise: null,
      }),
      side([cell("Business", "sso", "SSO")], { business: 99 }),
    );
    expect(rows[0]?.ours).toMatchObject({ planName: "Pro", monthly: 49 });
  });

  it("compares 5 users against 5 seats as equal", () => {
    const metered = { kind: "metered", value_num: 5, unit: "users" } satisfies Partial<EntitlementRow>;
    const rows = compareEntitlements(
      side([cell("Pro", "seats_included", "Users included", metered)], { pro: 49 }),
      side([cell("Business", "seats_included", "Seats", { ...metered, unit: "seats" })], {
        business: 99,
      }),
    );
    expect(rows[0]?.limitVerdict).toBe("equal");
    expect(rows[0]?.kind).toBe("metered");
  });

  it("refuses to compare 100 GB against 100 credits", () => {
    const rows = compareEntitlements(
      side([cell("Pro", "storage", "Storage", { kind: "metered", value_num: 100, unit: "GB" })], {
        pro: 49,
      }),
      side(
        [cell("Business", "storage", "Storage", { kind: "metered", value_num: 100, unit: "credits" })],
        { business: 99 },
      ),
    );
    expect(rows[0]?.limitVerdict).toBeNull();
  });

  it("compares bare counts when neither side names a unit", () => {
    const rows = compareEntitlements(
      side([cell("Pro", "projects", "Projects", { kind: "metered", value_num: 10 })], { pro: 49 }),
      side([cell("Business", "projects", "Projects", { kind: "metered", value_num: 3 })], {
        business: 99,
      }),
    );
    expect(rows[0]?.limitVerdict).toBe("higher");
  });

  it("floats diverging rows above rows the two sides agree on", () => {
    // sso comes first in the catalog but the two sides price it the same, so the
    // webhooks divergence outranks it.
    const ours = side([cell("Pro", "sso", "SSO"), cell("Pro", "webhooks", "Webhooks")], { pro: 49 });
    const theirs = side([cell("Growth", "sso", "SSO"), cell("Business", "webhooks", "Webhooks")], {
      growth: 49,
      business: 99,
    });
    expect(compareEntitlements(ours, theirs).map((r) => r.slug)).toEqual(["webhooks", "sso"]);
  });
});

describe("compareSummaryLines", () => {
  it("says who unlocks a feature cheaper, in the display currency", () => {
    const rows = compareEntitlements(
      side([cell("Enterprise", "sso", "SSO")], { enterprise: 199 }),
      side([cell("Starter", "sso", "SSO")], { starter: 19 }),
    );
    expect(compareSummaryLines(rows, "Acme", { currency: "USD" })).toEqual([
      "Acme unlocks Single sign-on at Starter ($19/mo), you at Enterprise ($199/mo).",
    ]);
  });

  it("groups what they list and we do not into one line", () => {
    const theirs = side(
      [
        cell("Business", "audit_log", "Audit log"),
        cell("Business", "sla", "SLA"),
        cell("Business", "data_residency", "Data residency"),
        cell("Business", "on_premise", "Self-hosted"),
      ],
      { business: 99 },
    );
    const [line] = compareSummaryLines(compareEntitlements(side([], {}), theirs), "Acme");
    expect(line).toBe(
      "Acme lists Audit log, Data residency, SLA and 1 more; your pricing page does not.",
    );
  });

  it("caps at five lines", () => {
    const seats = { kind: "metered", unit: "seats" } satisfies Partial<EntitlementRow>;
    const ours = side(
      [
        cell("Enterprise", "sso", "SSO"),
        cell("Enterprise", "webhooks", "Webhooks"),
        cell("Enterprise", "seats_included", "Seats", { ...seats, value_num: 5 }),
        cell("Free", "exports", "Exports"),
        cell("Enterprise", "backups", "Backups"),
      ],
      { free: 0, enterprise: 199 },
    );
    const theirs = side(
      [
        cell("Starter", "sso", "SSO"),
        cell("Starter", "webhooks", "Webhooks"),
        cell("Starter", "seats_included", "Seats", { ...seats, value_num: 20 }),
        cell("Business", "exports", "Exports"),
        cell("Starter", "audit_log", "Audit log"),
      ],
      { starter: 19, business: 99 },
    );
    // Six candidate sentences exist (two pricier, one only_them, one limit gap,
    // one cheaper, one only_us); the reader gets five.
    expect(compareSummaryLines(compareEntitlements(ours, theirs), "Acme")).toHaveLength(5);
  });
});
