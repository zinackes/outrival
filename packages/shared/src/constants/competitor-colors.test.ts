import { describe, expect, test } from "bun:test";
import {
  COMPETITOR_COLORS,
  COMPETITOR_COLOR_TOKENS,
  hexToOklch,
  isValidCompetitorColor,
  resolveCompetitorColor,
} from "./competitor-colors";

describe("resolveCompetitorColor", () => {
  test("resolves a palette token to its hue + chroma", () => {
    const indigo = COMPETITOR_COLORS.find((c) => c.token === "indigo")!;
    expect(resolveCompetitorColor("indigo")).toEqual({
      h: indigo.hue,
      c: indigo.chroma,
    });
  });

  test("resolves a valid hex to an OKLCH hue + chroma", () => {
    const r = resolveCompetitorColor("#6d5eff");
    expect(r).not.toBeNull();
    expect(r!.h).toBeGreaterThanOrEqual(0);
    expect(r!.h).toBeLessThan(360);
    expect(r!.c).toBeGreaterThan(0);
  });

  test("returns null for null, empty, and unknown/invalid values", () => {
    expect(resolveCompetitorColor(null)).toBeNull();
    expect(resolveCompetitorColor(undefined)).toBeNull();
    expect(resolveCompetitorColor("")).toBeNull();
    expect(resolveCompetitorColor("not-a-color")).toBeNull();
    expect(resolveCompetitorColor("#fff")).toBeNull(); // 3-digit not accepted
    expect(resolveCompetitorColor("#zzzzzz")).toBeNull();
  });
});

describe("hexToOklch", () => {
  test("pure blue lands in the blue hue band with real chroma", () => {
    const { h, c } = hexToOklch("#0000ff");
    expect(h).toBeGreaterThan(250);
    expect(h).toBeLessThan(290);
    expect(c).toBeGreaterThan(0.1);
  });

  test("grayscale collapses chroma toward zero", () => {
    expect(hexToOklch("#888888").c).toBeLessThan(0.01);
  });

  test("clamps chroma to the max for an extreme neon", () => {
    expect(hexToOklch("#ff00ff").c).toBeLessThanOrEqual(0.16);
  });
});

describe("isValidCompetitorColor", () => {
  test("accepts every palette token", () => {
    for (const t of COMPETITOR_COLOR_TOKENS) {
      expect(isValidCompetitorColor(t)).toBe(true);
    }
  });

  test("accepts a 6-digit hex, rejects junk", () => {
    expect(isValidCompetitorColor("#1a2b3c")).toBe(true);
    expect(isValidCompetitorColor("#fff")).toBe(false);
    expect(isValidCompetitorColor("blue")).toBe(false);
  });
});
