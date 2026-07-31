import { test, expect, describe } from "bun:test";
import {
  costAtVolume,
  validateTierSet,
  reachedTier,
  MAX_TIERS,
  type CostTier,
} from "./cost-model";

// The ladder used across the arithmetic tests, written the way a page prints it:
//   0–10,000       $0.10
//   10,000–50,000  $0.08
//   50,000+        $0.05
const LADDER: CostTier[] = [
  { fromQty: 0, toQty: 10_000, unitPrice: 0.1, flatFee: null },
  { fromQty: 10_000, toQty: 50_000, unitPrice: 0.08, flatFee: null },
  { fromQty: 50_000, toQty: null, unitPrice: 0.05, flatFee: null },
];

// The same ladder in the other notation a page may use ("10,001–50,000"). It
// must compute identically — the maths runs on the ceilings, not the labels.
const LADDER_INCLUSIVE: CostTier[] = [
  { fromQty: 0, toQty: 10_000, unitPrice: 0.1, flatFee: null },
  { fromQty: 10_001, toQty: 50_000, unitPrice: 0.08, flatFee: null },
  { fromQty: 50_001, toQty: null, unitPrice: 0.05, flatFee: null },
];

describe("costAtVolume — graduated", () => {
  const graduated = { rateStructure: "graduated" as const, tiers: LADDER };

  test("sums the bands the quantity traverses", () => {
    // 10,000 x 0.10 + 40,000 x 0.08 + 50,000 x 0.05 = 1000 + 3200 + 2500
    expect(costAtVolume(graduated, 100_000)).toBeCloseTo(6_700, 6);
  });

  test("prices inside the first band without touching the others", () => {
    expect(costAtVolume(graduated, 1_000)).toBeCloseTo(100, 6);
  });

  test("exact band boundaries belong to the band that ends there", () => {
    expect(costAtVolume(graduated, 10_000)).toBeCloseTo(1_000, 6);
    // 1000 + 40,000 x 0.08
    expect(costAtVolume(graduated, 50_000)).toBeCloseTo(4_200, 6);
    // one unit past the boundary crosses into the next rate
    expect(costAtVolume(graduated, 10_001)).toBeCloseTo(1_000.08, 6);
  });

  test("both printed notations of one ladder compute the same", () => {
    for (const qty of [0, 1, 9_999, 10_000, 10_001, 50_000, 100_000]) {
      expect(costAtVolume({ rateStructure: "graduated", tiers: LADDER_INCLUSIVE }, qty)).toBeCloseTo(
        costAtVolume(graduated, qty)!,
        6,
      );
    }
  });

  test("zero units cost zero", () => {
    expect(costAtVolume(graduated, 0)).toBe(0);
  });

  test("band order in the input does not matter", () => {
    const shuffled = [LADDER[2]!, LADDER[0]!, LADDER[1]!];
    expect(costAtVolume({ rateStructure: "graduated", tiers: shuffled }, 100_000)).toBeCloseTo(
      6_700,
      6,
    );
  });

  test("a flat fee is charged on entering its band", () => {
    const stair: CostTier[] = [
      { fromQty: 0, toQty: 1_000, unitPrice: 0, flatFee: 25 },
      { fromQty: 1_000, toQty: null, unitPrice: 0.02, flatFee: 50 },
    ];
    // Platform fee alone at zero usage.
    expect(costAtVolume({ rateStructure: "graduated", tiers: stair }, 0)).toBeCloseTo(25, 6);
    expect(costAtVolume({ rateStructure: "graduated", tiers: stair }, 500)).toBeCloseTo(25, 6);
    // 25 + 50 + 1,000 x 0.02
    expect(costAtVolume({ rateStructure: "graduated", tiers: stair }, 2_000)).toBeCloseTo(95, 6);
  });

  test("a graduated plan with no ladder cannot be priced", () => {
    expect(costAtVolume({ rateStructure: "graduated", tiers: [], unitPrice: 0.1 }, 100)).toBeNull();
    expect(costAtVolume({ rateStructure: "graduated", unitPrice: 0.1 }, 100)).toBeNull();
  });
});

describe("costAtVolume — volume", () => {
  const volume = { rateStructure: "volume" as const, tiers: LADDER };

  test("the reached band's rate applies to every unit", () => {
    expect(costAtVolume(volume, 100_000)).toBeCloseTo(5_000, 6);
    expect(costAtVolume(volume, 1_000)).toBeCloseTo(100, 6);
  });

  test("a boundary quantity is still covered by the band that ends there", () => {
    expect(costAtVolume(volume, 10_000)).toBeCloseTo(1_000, 6);
    expect(costAtVolume(volume, 10_001)).toBeCloseTo(800.08, 6);
  });

  test("volume is never dearer than graduated on the same ladder", () => {
    for (const qty of [1, 10_000, 25_000, 100_000, 1_000_000]) {
      const v = costAtVolume(volume, qty)!;
      const g = costAtVolume({ rateStructure: "graduated", tiers: LADDER }, qty)!;
      expect(v).toBeLessThanOrEqual(g + 1e-9);
    }
  });

  test("reachedTier names the band a quantity lands in", () => {
    expect(reachedTier(LADDER, 5_000)?.unitPrice).toBe(0.1);
    expect(reachedTier(LADDER, 10_000)?.unitPrice).toBe(0.1);
    expect(reachedTier(LADDER, 10_001)?.unitPrice).toBe(0.08);
    expect(reachedTier(LADDER, 10_000_000)?.unitPrice).toBe(0.05);
    expect(reachedTier([], 10)).toBeNull();
  });
});

describe("costAtVolume — package", () => {
  const pack = { rateStructure: "package" as const, unitPrice: 5, packageSize: 1_000 };

  test("a part-used block is a whole block", () => {
    expect(costAtVolume(pack, 1)).toBeCloseTo(5, 6);
    expect(costAtVolume(pack, 1_000)).toBeCloseTo(5, 6);
    expect(costAtVolume(pack, 1_001)).toBeCloseTo(10, 6);
    expect(costAtVolume(pack, 10_000)).toBeCloseTo(50, 6);
  });

  test("no units, no block", () => {
    expect(costAtVolume(pack, 0)).toBe(0);
  });

  test("a block size we never captured cannot be priced", () => {
    expect(costAtVolume({ rateStructure: "package", unitPrice: 5 }, 1_000)).toBeNull();
    expect(
      costAtVolume({ rateStructure: "package", unitPrice: 5, packageSize: 0 }, 1_000),
    ).toBeNull();
  });
});

describe("costAtVolume — standard and the unlabelled rate", () => {
  test("quantity times the rate", () => {
    expect(costAtVolume({ rateStructure: "standard", unitPrice: 0.1 }, 10_000)).toBeCloseTo(
      1_000,
      6,
    );
  });

  test("a plain usage row with no declared structure still prices", () => {
    expect(costAtVolume({ rateStructure: null, unitPrice: 0.02 }, 50_000)).toBeCloseTo(1_000, 6);
  });

  test("a free rate is a cost of zero, not an unknown", () => {
    expect(costAtVolume({ rateStructure: "standard", unitPrice: 0 }, 10_000)).toBe(0);
  });

  test("no rate at all is unknown, never zero", () => {
    expect(costAtVolume({ rateStructure: "standard" }, 10_000)).toBeNull();
    expect(costAtVolume({ rateStructure: null, unitPrice: null }, 10_000)).toBeNull();
  });

  test("a ladder with no structure naming it is not priced by guessing one", () => {
    expect(costAtVolume({ rateStructure: null, tiers: LADDER }, 100_000)).toBeNull();
  });
});

describe("costAtVolume — the monthly minimum", () => {
  const withMinimum = { rateStructure: "graduated" as const, tiers: LADDER, minimumAmount: 500 };

  test("the floor takes over below it", () => {
    expect(costAtVolume(withMinimum, 0)).toBeCloseTo(500, 6);
    expect(costAtVolume(withMinimum, 1_000)).toBeCloseTo(500, 6);
  });

  test("usage takes over above it — the minimum is a floor, not a surcharge", () => {
    expect(costAtVolume(withMinimum, 100_000)).toBeCloseTo(6_700, 6);
  });

  test("exactly at the floor", () => {
    expect(costAtVolume({ ...withMinimum, minimumAmount: 1_000 }, 10_000)).toBeCloseTo(1_000, 6);
  });

  test("a minimum on a plan we cannot price does not invent a cost", () => {
    expect(costAtVolume({ rateStructure: "graduated", minimumAmount: 500 }, 10)).toBeNull();
  });
});

describe("costAtVolume — what it refuses to answer", () => {
  test("percentage is out of the numeric layer by construction", () => {
    expect(costAtVolume({ rateStructure: "percentage", unitPrice: 0.3 }, 10_000)).toBeNull();
  });

  test("a nonsense quantity", () => {
    const input = { rateStructure: "graduated" as const, tiers: LADDER };
    expect(costAtVolume(input, -1)).toBeNull();
    expect(costAtVolume(input, Number.NaN)).toBeNull();
    expect(costAtVolume(input, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("validateTierSet — stored whole or not at all", () => {
  test("accepts a well-formed ladder and returns it sorted", () => {
    const result = validateTierSet([LADDER[2]!, LADDER[0]!, LADDER[1]!]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tiers.map((t) => t.fromQty)).toEqual([0, 10_000, 50_000]);
  });

  test("accepts the inclusive notation a page may print", () => {
    expect(validateTierSet(LADDER_INCLUSIVE).ok).toBe(true);
  });

  test("rejects an empty set", () => {
    expect(validateTierSet([])).toEqual({ ok: false, reason: "empty" });
  });

  test("rejects a table too long to be a published ladder", () => {
    const many = Array.from({ length: MAX_TIERS + 1 }, (_, i) => ({
      fromQty: i * 100,
      toQty: (i + 1) * 100,
      unitPrice: 0.1,
      flatFee: null,
    }));
    expect(validateTierSet(many).ok).toBe(false);
  });

  test("rejects overlapping bands", () => {
    const overlapping: CostTier[] = [
      { fromQty: 0, toQty: 10_000, unitPrice: 0.1, flatFee: null },
      { fromQty: 5_000, toQty: 50_000, unitPrice: 0.08, flatFee: null },
    ];
    expect(validateTierSet(overlapping)).toEqual({ ok: false, reason: "overlapping_tiers" });
  });

  test("rejects a hole in the ladder — a hole cannot be priced", () => {
    const gapped: CostTier[] = [
      { fromQty: 0, toQty: 10_000, unitPrice: 0.1, flatFee: null },
      { fromQty: 20_000, toQty: null, unitPrice: 0.08, flatFee: null },
    ];
    expect(validateTierSet(gapped)).toEqual({ ok: false, reason: "gap_between_tiers" });
  });

  test("rejects an unbounded band anywhere but last", () => {
    const openMiddle: CostTier[] = [
      { fromQty: 0, toQty: null, unitPrice: 0.1, flatFee: null },
      { fromQty: 10_000, toQty: null, unitPrice: 0.08, flatFee: null },
    ];
    expect(validateTierSet(openMiddle)).toEqual({ ok: false, reason: "unbounded_middle_tier" });
  });

  test("rejects duplicate lower bounds", () => {
    const dup: CostTier[] = [
      { fromQty: 0, toQty: 10_000, unitPrice: 0.1, flatFee: null },
      { fromQty: 0, toQty: 50_000, unitPrice: 0.08, flatFee: null },
    ];
    expect(validateTierSet(dup)).toEqual({ ok: false, reason: "duplicate_from_qty" });
  });

  test("rejects an inverted band", () => {
    expect(
      validateTierSet([{ fromQty: 10_000, toQty: 1_000, unitPrice: 0.1, flatFee: null }]),
    ).toEqual({ ok: false, reason: "bad_to_qty" });
  });

  test("rejects negative money", () => {
    expect(
      validateTierSet([{ fromQty: 0, toQty: 10, unitPrice: -0.1, flatFee: null }]),
    ).toEqual({ ok: false, reason: "negative_unit_price" });
    expect(
      validateTierSet([{ fromQty: 0, toQty: 10, unitPrice: 0.1, flatFee: -5 }]),
    ).toEqual({ ok: false, reason: "negative_flat_fee" });
  });

  test("rejects a band that carries no price at all", () => {
    expect(
      validateTierSet([{ fromQty: 0, toQty: 10, unitPrice: null, flatFee: null }]),
    ).toEqual({ ok: false, reason: "unpriced_tier" });
  });

  test("a free first band is a price, not a missing one", () => {
    const freeFirst: CostTier[] = [
      { fromQty: 0, toQty: 10_000, unitPrice: 0, flatFee: null },
      { fromQty: 10_000, toQty: null, unitPrice: 0.1, flatFee: null },
    ];
    expect(validateTierSet(freeFirst).ok).toBe(true);
    // "First 10k free, then $0.10"
    expect(costAtVolume({ rateStructure: "graduated", tiers: freeFirst }, 20_000)).toBeCloseTo(
      1_000,
      6,
    );
  });
});
