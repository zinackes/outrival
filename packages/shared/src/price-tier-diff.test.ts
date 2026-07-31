import { test, expect, describe } from "bun:test";
import { diffPriceTiers, bandPhrase, formatQty, type TierBandRow } from "./price-tier-diff";

const band = (
  from: number,
  to: number | null,
  price: number,
  extra: Partial<TierBandRow> = {},
): TierBandRow => ({
  plan_name: "Scale",
  unit: "request",
  from_qty: from,
  to_qty: to,
  unit_price: price,
  flat_fee: null,
  ...extra,
});

const LADDER: TierBandRow[] = [band(0, 10_000, 0.1), band(10_000, 50_000, 0.08), band(50_000, null, 0.05)];
const opts = { currency: "USD" };

describe("formatQty / bandPhrase", () => {
  test("a boundary reads the way the page prints it", () => {
    expect(formatQty(0)).toBe("0");
    expect(formatQty(750)).toBe("750");
    expect(formatQty(10_000)).toBe("10k");
    expect(formatQty(1_500_000)).toBe("1.5M");
  });

  test("a band reads as its range and its rate", () => {
    expect(bandPhrase(band(0, 10_000, 0.1), "USD")).toBe("0–10k @ $0.1");
    expect(bandPhrase(band(50_000, null, 0.05), "USD")).toBe("50k+ @ $0.05");
    expect(bandPhrase(band(0, 1_000, 0, { flat_fee: 25 }), "USD")).toBe("0–1k @ $0 + $25");
  });
});

describe("diffPriceTiers — the boundary that slides", () => {
  test("a shrunk first band is HIGH, with the exact pair a human reads", () => {
    const next = [band(0, 5_000, 0.1), band(5_000, 50_000, 0.08), band(50_000, null, 0.05)];
    const changes = diffPriceTiers(LADDER, next, opts);
    const moved = changes.find((c) => c.type === "tier_boundary_moved");
    expect(moved?.severity).toBe("high");
    expect(moved?.humanBefore).toBe("Scale (request) — 0–10k @ $0.1");
    expect(moved?.humanAfter).toBe("Scale (request) — 0–5k @ $0.1");
    expect(moved?.previousValue).toBe(10_000);
    expect(moved?.currentValue).toBe(5_000);
    expect(moved?.direction).toBe("down");
    expect(moved?.summary).toContain("volume bands moved");
  });

  test("an unchanged ladder is silent", () => {
    expect(diffPriceTiers(LADDER, [...LADDER], opts)).toEqual([]);
  });

  test("band order in either batch does not matter", () => {
    const shuffled = [LADDER[2]!, LADDER[0]!, LADDER[1]!];
    expect(diffPriceTiers(shuffled, [...LADDER], opts)).toEqual([]);
  });

  test("a band added to the ladder reads as the boundaries moving", () => {
    const next = [...LADDER.slice(0, 2), band(50_000, 200_000, 0.05), band(200_000, null, 0.03)];
    const changes = diffPriceTiers(LADDER, next, opts);
    expect(changes.some((c) => c.type === "tier_boundary_moved")).toBe(true);
  });

  test("one boundary move is one change, not one per band", () => {
    const next = [band(0, 5_000, 0.1), band(5_000, 50_000, 0.08), band(50_000, null, 0.05)];
    const moves = diffPriceTiers(LADDER, next, opts).filter(
      (c) => c.type === "tier_boundary_moved",
    );
    expect(moves).toHaveLength(1);
  });
});

describe("diffPriceTiers — a band's own rate", () => {
  test("a cut past the undercut threshold is critical", () => {
    const next = [band(0, 10_000, 0.05), LADDER[1]!, LADDER[2]!];
    const changes = diffPriceTiers(LADDER, next, opts);
    const rate = changes.find((c) => c.type === "rate_changed");
    expect(rate?.severity).toBe("critical");
    expect(rate?.pctChange).toBe(-50);
    expect(rate?.humanBefore).toBe("Scale (request) — 0–10k @ $0.1");
    expect(rate?.humanAfter).toBe("Scale (request) — 0–10k @ $0.05");
  });

  test("a rise is medium — a rate has no low band", () => {
    const next = [band(0, 10_000, 0.101), LADDER[1]!, LADDER[2]!];
    expect(diffPriceTiers(LADDER, next, opts).find((c) => c.type === "rate_changed")?.severity).toBe(
      "medium",
    );
  });

  test("a rate is never compared across a moved boundary", () => {
    // The band that used to start at 10k now starts at 5k: these are two
    // different bands, and calling one a rate change on the other is a lie.
    const next = [band(0, 5_000, 0.1), band(5_000, 50_000, 0.02), band(50_000, null, 0.05)];
    const rates = diffPriceTiers(LADDER, next, opts).filter((c) => c.type === "rate_changed");
    expect(rates).toHaveLength(0);
  });
});

describe("diffPriceTiers — what it stays silent about", () => {
  test("a first ladder is not a ladder that moved", () => {
    expect(diffPriceTiers([], LADDER, opts)).toEqual([]);
  });

  test("a capture that read no ladder never reads as one withdrawn", () => {
    expect(diffPriceTiers(LADDER, [], opts)).toEqual([]);
  });

  test("a ladder appearing on a known plan is the extractor, not the competitor", () => {
    const prev = [band(0, null, 0.1, { plan_name: "Starter" })];
    const next = [...prev, ...LADDER];
    expect(diffPriceTiers(prev, next, opts)).toEqual([]);
  });

  test("ladders on different meters are different ladders", () => {
    const next = LADDER.map((b) => ({ ...b, unit: "gb" }));
    expect(diffPriceTiers(LADDER, next, opts)).toEqual([]);
  });
});
