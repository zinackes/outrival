import { test, expect, describe } from "bun:test";
import { parseEntitlementTable } from "./entitlement-table";

const PLANS = ["Starter", "Pro", "Enterprise"];

// A realistic comparison table: header names plans (with prices inline), body
// mixes text checks, svg checks (aria-label), crosses, numbers and free text.
const COMPARISON_TABLE = `
<html><body>
<h2>Compare plans</h2>
<table>
  <thead>
    <tr><th>Features</th><th>Starter<br/>$19/mo</th><th>Pro<br/>$49/mo</th><th>Enterprise<br/>Custom</th></tr>
  </thead>
  <tbody>
    <tr><td>Users included</td><td>5</td><td>25</td><td>Unlimited</td></tr>
    <tr><td colspan="4">SECURITY</td></tr>
    <tr><td>Single sign-on (SSO)</td><td>—</td><td>✗</td><td>✓</td></tr>
    <tr><td>Audit log</td><td></td><td><svg aria-label="Included"></svg></td><td>✓</td></tr>
    <tr><td>API calls</td><td>1k /mo</td><td>50,000 /mo</td><td>Unlimited</td></tr>
    <tr><td>Support</td><td>Email</td><td>Priority</td><td>24/7 dedicated</td></tr>
  </tbody>
</table>
</body></html>`;

describe("parseEntitlementTable", () => {
  test("parses the plan-anchored comparison table deterministically", () => {
    const rows = parseEntitlementTable(COMPARISON_TABLE, PLANS)!;
    expect(rows).not.toBeNull();

    const cell = (plan: string, label: string) =>
      rows.find((r) => r.plan_name === plan && r.feature_label === label);

    // Numbers → metered, with k-scaling and reset period.
    expect(cell("Starter", "Users included")).toMatchObject({ kind: "metered", value_num: 5 });
    expect(cell("Pro", "API calls")).toMatchObject({ kind: "metered", value_num: 50000 });
    expect(cell("Starter", "API calls")).toMatchObject({ kind: "metered", value_num: 1000 });

    // Unlimited → config value_text.
    expect(cell("Enterprise", "Users included")).toMatchObject({
      kind: "config",
      value_text: "unlimited",
    });

    // ✓/svg-with-aria → boolean; ✗/—/empty → no row at all.
    expect(cell("Enterprise", "Single sign-on (SSO)")).toMatchObject({ kind: "boolean" });
    expect(cell("Starter", "Single sign-on (SSO)")).toBeUndefined();
    expect(cell("Pro", "Single sign-on (SSO)")).toBeUndefined();
    expect(cell("Pro", "Audit log")).toMatchObject({ kind: "boolean" });
    expect(cell("Starter", "Audit log")).toBeUndefined();

    // Free text → config verbatim.
    expect(cell("Pro", "Support")).toMatchObject({ kind: "config", value_text: "Priority" });

    // The section header row ("SECURITY") is not a feature.
    expect(rows.some((r) => r.feature_label === "SECURITY")).toBe(false);
  });

  test("a French/German matrix parses through the same path (labels stay verbatim)", () => {
    const html = `
<table>
  <tr><th>Fonctionnalités</th><th>Débutant 19€/mois</th><th>Pro 49€/mois</th></tr>
  <tr><td>Utilisateurs inclus</td><td>3</td><td>10</td></tr>
  <tr><td>Journal d'audit</td><td>—</td><td>✓</td></tr>
  <tr><td>Support prioritaire</td><td>non</td><td>oui</td></tr>
</table>`;
    const rows = parseEntitlementTable(html, ["Débutant", "Pro"])!;
    expect(rows).not.toBeNull();
    expect(rows.find((r) => r.feature_label === "Journal d'audit")).toMatchObject({
      plan_name: "Pro",
      kind: "boolean",
    });
    expect(rows.find((r) => r.feature_label === "Support prioritaire")).toMatchObject({
      plan_name: "Pro",
      kind: "boolean",
    });
    expect(rows.filter((r) => r.plan_name === "Débutant")).toHaveLength(1);
  });

  test("a cards+bullets page (no table) yields null — the AI stage's job", () => {
    const html = `
<div class="pricing-card"><h3>Pro</h3><ul><li>SSO</li><li>API access</li></ul></div>
<div class="pricing-card"><h3>Enterprise</h3><ul><li>Everything in Pro</li></ul></div>`;
    expect(parseEntitlementTable(html, PLANS)).toBeNull();
  });

  test("a table whose headers match <2 known plans is not THE matrix", () => {
    const html = `
<table>
  <tr><th>Currency</th><th>Monthly</th><th>Yearly</th></tr>
  <tr><td>USD</td><td>$19</td><td>$190</td></tr>
  <tr><td>EUR</td><td>€18</td><td>€180</td></tr>
  <tr><td>GBP</td><td>£16</td><td>£160</td></tr>
</table>`;
    expect(parseEntitlementTable(html, PLANS)).toBeNull();
  });

  test("fewer than 3 feature rows never qualifies (no invented matrix)", () => {
    const html = `
<table>
  <tr><th></th><th>Starter</th><th>Pro</th></tr>
  <tr><td>Users</td><td>5</td><td>25</td></tr>
</table>`;
    expect(parseEntitlementTable(html, PLANS)).toBeNull();
  });

  test("no known plans → null (nothing to anchor on)", () => {
    expect(parseEntitlementTable(COMPARISON_TABLE, [])).toBeNull();
  });
});
