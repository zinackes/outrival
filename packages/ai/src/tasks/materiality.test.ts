import { describe, expect, test } from "bun:test";
import {
  severityFromMateriality,
  isSignificantFromMateriality,
  applyCategoryFloor,
  resolveSeverity,
  type Materiality,
} from "./materiality";

const m = (
  decision_impact: number,
  urgency: number,
  corroboration = 1,
): Materiality => ({ decision_impact, urgency, corroboration });

// This table decides who gets paged: "critical" bypasses every notification
// moderation layer and emails the customer within minutes. It used to be a model
// judgement; the whole point of moving it into TypeScript is that its edges are
// pinned here and a change to them shows up as a failing test, not as a customer
// being woken up.
describe("severityFromMateriality — the mapping table", () => {
  test("decision_impact 0 is always low, whatever the urgency", () => {
    for (const u of [0, 1, 2, 3]) {
      expect(severityFromMateriality(m(0, u))).toBe("low");
    }
  });

  test("critical requires BOTH axes maxed — the two-part test", () => {
    expect(severityFromMateriality(m(3, 3))).toBe("critical");
    // One notch off on either axis and it is not page-worthy.
    expect(severityFromMateriality(m(3, 2))).toBe("high");
    expect(severityFromMateriality(m(2, 3))).toBe("high");
  });

  test("high: maximal impact, or strong impact with real urgency", () => {
    expect(severityFromMateriality(m(3, 0))).toBe("high");
    expect(severityFromMateriality(m(2, 2))).toBe("high");
    // Impact 2 without urgency stays incremental.
    expect(severityFromMateriality(m(2, 1))).toBe("medium");
  });

  test("medium is the floor for anything actionable at all", () => {
    expect(severityFromMateriality(m(1, 0))).toBe("medium");
    expect(severityFromMateriality(m(1, 3))).toBe("medium");
  });

  describe("corroboration modulator", () => {
    test("c=0 (contradicted / capture artifact) demotes one band", () => {
      expect(severityFromMateriality(m(3, 3, 0))).toBe("high");
      expect(severityFromMateriality(m(3, 0, 0))).toBe("medium");
      expect(severityFromMateriality(m(1, 0, 0))).toBe("low");
    });

    test("c=0 floors at low — never below the scale", () => {
      expect(severityFromMateriality(m(0, 0, 0))).toBe("low");
    });

    test("c>=2 promotes medium to high when impact is already >= 2", () => {
      expect(severityFromMateriality(m(2, 1, 2))).toBe("high");
      expect(severityFromMateriality(m(2, 1, 3))).toBe("high");
    });

    test("corroboration NEVER opens a second route to critical", () => {
      // The only path to critical stays d=3 & u=3. Three surfaces agreeing on a
      // high-severity move must not page the customer on their own.
      expect(severityFromMateriality(m(3, 2, 3))).toBe("high");
      expect(severityFromMateriality(m(2, 2, 3))).toBe("high");
      expect(severityFromMateriality(m(3, 0, 3))).toBe("high");
    });

    test("c>=2 does not promote low-impact noise", () => {
      // Promotion requires decision_impact >= 2: three surfaces showing the same
      // trivial copy tweak is still a trivial copy tweak.
      expect(severityFromMateriality(m(1, 1, 3))).toBe("medium");
      expect(severityFromMateriality(m(0, 3, 3))).toBe("low");
    });

    test("c=1 (the normal single-surface case) changes nothing", () => {
      expect(severityFromMateriality(m(3, 3, 1))).toBe("critical");
      expect(severityFromMateriality(m(2, 2, 1))).toBe("high");
      expect(severityFromMateriality(m(1, 1, 1))).toBe("medium");
    });
  });
});

describe("isSignificantFromMateriality", () => {
  test("derives from decision_impact alone — no separate model judgement", () => {
    expect(isSignificantFromMateriality(m(0, 3, 3))).toBe(false);
    expect(isSignificantFromMateriality(m(1, 0, 0))).toBe(true);
    expect(isSignificantFromMateriality(m(3, 3))).toBe(true);
  });
});

describe("applyCategoryFloor", () => {
  test("raises only — a floor never lowers a band the scores earned", () => {
    // ads floors at medium, but a high-scoring ads change keeps high.
    expect(applyCategoryFloor("ads", "high", "")).toBe("high");
    expect(applyCategoryFloor("ads", "low", "")).toBe("medium");
  });

  test("the six legacy categories are untouched", () => {
    for (const c of ["pricing", "product", "hiring", "reviews", "content", "funding"]) {
      expect(applyCategoryFloor(c, "low", "anything")).toBe("low");
    }
  });

  test("ma floors at critical", () => {
    expect(applyCategoryFloor("ma", "low", "")).toBe("critical");
  });

  test("security_compliance floors at high", () => {
    expect(applyCategoryFloor("security_compliance", "low", "")).toBe("high");
  });

  test("partnerships: high only when a product integration is in evidence", () => {
    expect(applyCategoryFloor("partnerships", "low", "Now integrates with Salesforce")).toBe("high");
    expect(applyCategoryFloor("partnerships", "low", "Native connector for HubSpot")).toBe("high");
    // A co-marketing announcement with no product surface stays incremental.
    expect(applyCategoryFloor("partnerships", "low", "Joins the Acme partner program")).toBe(
      "medium",
    );
  });

  test("leadership: high only for C-level / board", () => {
    expect(applyCategoryFloor("leadership", "low", "Appoints new CFO")).toBe("high");
    expect(applyCategoryFloor("leadership", "low", "Names a Chief Revenue Officer")).toBe("high");
    expect(applyCategoryFloor("leadership", "low", "Hires a Director of Support")).toBe("medium");
  });

  test("an unknown category passes through untouched", () => {
    expect(applyCategoryFloor("something_else", "low", "")).toBe("low");
  });
});

// The scenarios the pipeline actually has to get right, end to end through the
// deterministic layer. The FIXTURE is the model's answer (its category + its three
// scores); the ASSERTION is on what our code derives from it. Whether the model
// scores a given article this way is the labelled eval's job (eval:severity, live
// calls) — this suite pins the half that must never drift silently.
describe("resolveSeverity — pipeline scenarios", () => {
  test("a pricing tier is removed → high decision impact → critical", () => {
    const evidence =
      "Pricing page: the Starter plan at $29/mo has been removed; the entry tier is now Growth at $99/mo.";
    // Direct threat to the customer's own positioning, days-long reaction window.
    expect(resolveSeverity("pricing", m(3, 3), evidence)).toBe("critical");
  });

  test("the same removal without urgency stays high, not critical", () => {
    expect(resolveSeverity("pricing", m(3, 1), "Starter plan removed")).toBe("high");
  });

  test("an M&A article is critical even when the model under-scores it", () => {
    const evidence =
      "Blog: Acme announces it has acquired Beacon Analytics to expand its data platform.";
    // The model scored this as merely notable; the category floor overrides.
    expect(resolveSeverity("ma", m(1, 1), evidence)).toBe("critical");
  });

  test("a SOC 2 certification is security_compliance / high", () => {
    const evidence = "Trust center: Acme is now SOC 2 Type II certified.";
    expect(resolveSeverity("security_compliance", m(1, 0), evidence)).toBe("high");
  });

  test("a copy pass that slipped past the gate still resolves to low", () => {
    // Belt and braces: even if the semantic gate misses a rewrite, decision_impact
    // 0 means no signal is generated (is_significant false) and the band is low.
    const scores = m(0, 0);
    expect(resolveSeverity("content", scores, "Hero copy reworded")).toBe("low");
    expect(isSignificantFromMateriality(scores)).toBe(false);
  });
});
