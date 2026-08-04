import { test, expect, describe } from "bun:test";
import type { CompareColumn } from "../src/lib/api";
import type { CompareEntity } from "../src/components/dashboard/compare/lens";
import { positioningLensHasContent } from "../src/components/dashboard/compare/lenses";

/**
 * Positioning Intelligence v2 P4 — the compare lens hides PER METRIC.
 *
 * The old lens gated on one condition ("category or summary"), which was safe
 * because it drew one thing. The v2 draws four independent readings, and a single
 * gate over four fields fails in both directions: a roster where nobody has a
 * persona page would blank three readings that ARE captured, and a roster where
 * nobody has anything would still lay out an empty lane.
 *
 * So the rule under test is: the lens renders when ANY column holds ANY of the
 * four, and disappears only when no column holds any.
 */

function col(over: Partial<CompareColumn["positioning"]> = {}, model: string | null = null) {
  const column = {
    id: "c1",
    name: "Rival",
    url: null,
    positioning: { category: null, summary: null, h1: null, personas: [], ...over },
    pricing: model
      ? ({ model } as unknown as CompareColumn["pricing"])
      : null,
    hiring: null,
    shipping: null,
    reviews: [],
    tech: [],
    platform: null,
    latestSignal: null,
  } as unknown as CompareColumn;
  return { id: column.id, name: column.name, data: column, pending: false } as CompareEntity;
}

const empty = () =>
  ({ id: "c0", name: "Nothing", data: null, pending: false }) as CompareEntity;

describe("positioning lens self-hide", () => {
  test("hides when no column holds any of the four readings", () => {
    expect(positioningLensHasContent([col(), col()])).toBe(false);
  });

  test("a category alone keeps the lens", () => {
    expect(positioningLensHasContent([col({ category: "Competitive intel" })])).toBe(true);
  });

  test("a headline alone keeps the lens", () => {
    expect(positioningLensHasContent([col({ h1: "Win more deals" })])).toBe(true);
  });

  test("personas alone keep the lens", () => {
    expect(positioningLensHasContent([col({ personas: ["Product marketing"] })])).toBe(true);
  });

  test("a pricing model alone keeps the lens", () => {
    // The badge is read off the pricing rows, so a competitor whose homepage was
    // never captured still has one reading to contribute.
    expect(positioningLensHasContent([col({}, "per_seat")])).toBe(true);
  });

  test("one column with data carries a roster of empty ones", () => {
    expect(positioningLensHasContent([col(), col({ h1: "Only this one" }), col()])).toBe(true);
  });

  test("a still-loading column holds the lane open", () => {
    // A competitor whose column has not arrived may yet have all four; hiding the
    // lens now would make it appear under the reader a second later.
    const pending = { id: "c9", name: "Loading", data: null, pending: true } as CompareEntity;
    expect(positioningLensHasContent([col(), pending])).toBe(true);
  });

  test("a column that failed to load is not data", () => {
    expect(positioningLensHasContent([empty()])).toBe(false);
  });
});
