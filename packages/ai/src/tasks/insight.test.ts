import { describe, expect, it } from "bun:test";
import { buildInsightPrompt, toMyProductContext } from "./insight";
import type { Classification } from "./classify";

const classification: Classification = {
  category: "pricing",
  severity: "high",
  is_significant: true,
  reason: "price changed",
};

describe("buildInsightPrompt", () => {
  it("omits the my_product block and keeps the generic so_what when no profile is given", () => {
    const prompt = buildInsightPrompt("$99 -> $79", "Acme", "B2B SaaS", classification);
    expect(prompt).not.toContain("<my_product>");
    expect(prompt).toContain("Strategic implication for the user");
  });

  it("injects the my_product block and reframes the so_what when a profile is given", () => {
    const prompt = buildInsightPrompt("$99 -> $79", "Acme", "B2B SaaS", classification, {
      category: "Project management",
      audience: "Agencies of 10-50",
      valueProp: "Ship client work faster",
    });
    expect(prompt).toContain("<my_product>");
    expect(prompt).toContain("Project management");
    expect(prompt).toContain("Agencies of 10-50");
    expect(prompt).toContain("Ship client work faster");
    expect(prompt).toContain("for OUR product");
    expect(prompt).not.toContain("Strategic implication for the user");
  });

  it("still embeds the competitor change text", () => {
    const prompt = buildInsightPrompt("DIFF_MARKER", "Acme", null, classification);
    expect(prompt).toContain("DIFF_MARKER");
  });
});

describe("toMyProductContext", () => {
  it("returns undefined for null / non-object / empty profiles", () => {
    expect(toMyProductContext(null)).toBeUndefined();
    expect(toMyProductContext("nope")).toBeUndefined();
    expect(toMyProductContext({})).toBeUndefined();
    expect(toMyProductContext({ pricingModel: "Freemium" })).toBeUndefined();
  });

  it("maps a full profile and tolerates a partial one", () => {
    expect(
      toMyProductContext({
        category: "PM",
        audience: "Agencies",
        valueProp: "Ship faster",
        pricingModel: "Subscription",
      }),
    ).toEqual({ category: "PM", audience: "Agencies", valueProp: "Ship faster" });

    expect(toMyProductContext({ category: "PM" })).toEqual({
      category: "PM",
      audience: "",
      valueProp: "",
    });
  });
});
