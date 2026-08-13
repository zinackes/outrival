import { describe, expect, it } from "bun:test";
import { planIncludesFeature } from "@outrival/shared";
import { resolvePlan } from "../src/lib/plan";

describe("resolvePlan", () => {
  it("passes through the plan keys the API echoes", () => {
    expect(resolvePlan("free")).toBe("free");
    expect(resolvePlan("starter")).toBe("starter");
    expect(resolvePlan("pro")).toBe("pro");
    expect(resolvePlan("business")).toBe("business");
  });

  it("accepts the display-cased fallback the dashboard layout threads", () => {
    // layout.tsx substitutes the literal "Free" when the billing read fails.
    expect(resolvePlan("Free")).toBe("free");
    expect(resolvePlan("Business")).toBe("business");
  });

  it("falls back to free on missing or unknown values", () => {
    expect(resolvePlan(undefined)).toBe("free");
    expect(resolvePlan(null)).toBe("free");
    expect(resolvePlan("")).toBe("free");
    expect(resolvePlan("enterprise")).toBe("free");
  });

  it("gates AI Visibility on pro+ once resolved", () => {
    // What the sidebar reads: only the plans that own the feature keep the entry.
    const canSee = (raw?: string) =>
      planIncludesFeature(resolvePlan(raw), "aiVisibility");
    expect(canSee("Free")).toBe(false);
    expect(canSee("starter")).toBe(false);
    expect(canSee("pro")).toBe(true);
    expect(canSee("business")).toBe(true);
  });
});
