import { test, expect, describe } from "bun:test";
import type { CompareColumn } from "../src/lib/api";
import {
  agePhrase,
  avgReview,
  axisTicks,
  buildVerdict,
  costAxis,
  countWord,
  displayCurrency,
  median,
  nameList,
  niceMax,
  priceReading,
  priceScale,
  hiringScale,
  ratingScale,
  robustCeiling,
  shortAge,
  techDiff,
  techOf,
  availableMeters,
  releasesPerMonth,
  releaseTrend,
  shippingScale,
} from "../src/components/dashboard/compare/derive";

// The compare page states its verdict as fact, so the arithmetic behind it is locked
// here: the shared scales, the tech diff, and every branch of the reading.

const NOW = Date.UTC(2026, 6, 25, 12, 0, 0);
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

function col(over: Partial<CompareColumn> & { id: string; name: string }): CompareColumn {
  return {
    url: `https://${over.name.toLowerCase()}.example`,
    // P4 — the lens reads h1 + personas alongside the category; `derive` itself
    // does not, so the default stays empty and only the lens tests fill it.
    positioning: { category: null, summary: null, h1: null, personas: [] },
    pricing: null,
    hiring: null,
    shipping: null,
    reviews: [],
    tech: [],
    platform: null,
    latestSignal: null,
    ...over,
  };
}

function priced(
  id: string,
  name: string,
  entry: number | null,
  top: number | null,
): CompareColumn {
  return col({
    id,
    name,
    pricing: {
      entry,
      top,
      currency: "USD",
      billingPeriod: "monthly",
      plans: [],
      capturedAt: null,
      model: null,
      meters: [],
    },
  });
}

function rated(id: string, name: string, score: number): CompareColumn {
  return col({
    id,
    name,
    reviews: [{ source: "g2", score, reviewCount: 10, sub: null, recordedAt: null }],
  });
}

function hiring(
  id: string,
  name: string,
  totalOpen: number,
  engineeringOpen: number | null,
): CompareColumn {
  return col({
    id,
    name,
    hiring: {
      totalOpen,
      topDepartment: "Engineering",
      departments: [{ department: "Engineering", count: totalOpen }],
      engineeringOpen,
      capturedAt: null,
    },
  });
}

describe("scalar readings", () => {
  test("median handles odd and even counts", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  test("avgReview averages every captured source", () => {
    const c = col({
      id: "a",
      name: "A",
      reviews: [
        { source: "g2", score: 4, reviewCount: 1, sub: null, recordedAt: null },
        { source: "capterra", score: 5, reviewCount: 1, sub: null, recordedAt: null },
      ],
    });
    expect(avgReview(c)).toBe(4.5);
    expect(avgReview(col({ id: "b", name: "B" }))).toBeNull();
  });

  test("countWord and nameList stay readable at the cap", () => {
    expect(countWord(5)).toBe("five");
    expect(countWord(12)).toBe("12");
    expect(nameList(["Acme"])).toBe("Acme");
    expect(nameList(["Acme", "Beta"])).toBe("Acme and Beta");
    expect(nameList(["Acme", "Beta", "Ceta", "Delta"])).toBe("Acme, Beta and 2 others");
  });

  test("shortAge reads in the feed's units", () => {
    expect(shortAge(ago(0), NOW)).toBe("today");
    expect(shortAge(ago(2), NOW)).toBe("2d");
    expect(shortAge(ago(21), NOW)).toBe("3w");
    expect(shortAge(ago(90), NOW)).toBe("3mo");
  });

  test("agePhrase never composes 'today ago'", () => {
    expect(agePhrase(ago(0), NOW)).toBe("today");
    expect(agePhrase(ago(2), NOW)).toBe("2d ago");
  });
});

describe("scales", () => {
  test("niceMax rounds a ceiling into a readable axis", () => {
    expect(niceMax(399)).toBe(500);
    expect(niceMax(149)).toBe(200);
    expect(niceMax(89)).toBe(100);
    expect(niceMax(0)).toBe(1);
  });

  test("axisTicks spans zero to max inclusive", () => {
    expect(axisTicks(400, 4)).toEqual([0, 100, 200, 300, 400]);
  });

  test("priceScale takes the median entry and ignores quote-only columns", () => {
    const s = priceScale([
      priced("a", "A", 29, 149),
      priced("b", "B", 49, 399),
      priced("c", "C", null, null),
    ]);
    expect(s.max).toBe(500);
    expect(s.medianEntry).toBe(39);
    expect(s.period).toBe("mo");
    expect(s.hasData).toBe(true);
  });

  test("priceScale reports no data when nobody published a number", () => {
    expect(priceScale([priced("a", "A", null, null)]).hasData).toBe(false);
  });

  // The cost curve reads volumes from 1 to 10M, so its costs span decades too and a
  // linear Y flattens every volume under ~100k onto the floor — the crush the price
  // lens fixes with a trimmed ceiling, arriving one chart over.
  describe("costAxis", () => {
    const rows = (...points: Array<[number, number, number]>) =>
      points.map(([qty, a, b]) => ({ qty, a, b }));

    test("goes log once the costs span decades", () => {
      const axis = costAxis(rows([1, 0.05, 0.1], [1_000, 25, 40], [1_000_000, 9_000, 22_000]));
      expect(axis.log).toBe(true);
      expect(axis.domain).toEqual([0.01, 100_000]);
      expect(axis.ticks).toEqual([0.01, 0.1, 1, 10, 100, 1_000, 10_000, 100_000]);
    });

    test("stays linear on a narrow spread, where log only costs legibility", () => {
      expect(costAxis(rows([1, 20, 25], [1_000, 40, 55])).log).toBe(false);
    });

    // Clipping a $0 to the floor of a log axis would draw "free" as "cheap", which
    // is the one number on this chart a reader would act on.
    test("stays linear when a free tier puts a $0 on the curve", () => {
      expect(costAxis(rows([1, 0, 0.1], [1_000_000, 9_000, 22_000])).log).toBe(false);
    });

    test("an empty set has no axis to build", () => {
      expect(costAxis([]).log).toBe(false);
      expect(costAxis([{ qty: 10 }]).log).toBe(false);
    });
  });

  test("robustCeiling drops a top that dwarfs the median, keeps a merely-high one", () => {
    // $2,400 against a $180 median owns the axis and flattens everyone else.
    expect(robustCeiling([16, 99, 159, 200, 500, 2400])).toBe(500);
    // Nothing here is an outlier, so the raw maximum stands.
    expect(robustCeiling([89, 149])).toBe(149);
    expect(robustCeiling([])).toBe(0);
  });

  test("priceScale trims the outlier off the axis and says so", () => {
    const cols = [
      priced("a", "A", 0, 16),
      priced("b", "B", 0, 200),
      priced("c", "C", 75, 2400),
      priced("d", "D", 20, 500),
    ];
    const trimmed = priceScale(cols);
    expect(trimmed.max).toBe(500);
    expect(trimmed.fullMax).toBe(2500);
    expect(trimmed.clipped).toBe(true);

    // The way back to the true spread: nothing is clipped on the full axis.
    const fullScale = priceScale(cols, { full: true });
    expect(fullScale.max).toBe(2500);
    expect(fullScale.clipped).toBe(false);
  });

  test("hiringScale flags whether any engineering share can be picked out", () => {
    expect(hiringScale([hiring("a", "A", 6, 3), hiring("b", "B", 31, null)])).toEqual({
      max: 31,
      robustMax: 31,
      fullMax: 31,
      clipped: false,
      hasData: true,
      hasEngineering: true,
    });
    expect(hiringScale([hiring("b", "B", 31, null)]).hasEngineering).toBe(false);
  });

  test("hiringScale trims the one competitor hiring ten times the field", () => {
    const cols = [
      hiring("a", "A", 12, 4),
      hiring("b", "B", 9, 3),
      hiring("c", "C", 18, 6),
      hiring("d", "D", 800, 300),
    ];
    const scale = hiringScale(cols);
    // Without the trim, 9 open roles drew 1.1% of the track — a stub, not a bar.
    expect(scale.max).toBe(18);
    expect(scale.fullMax).toBe(800);
    expect(scale.clipped).toBe(true);

    const full = hiringScale(cols, { full: true });
    expect(full.max).toBe(800);
    expect(full.clipped).toBe(false);
    // The robust ceiling is what the way-back control is gated on, so it holds
    // steady while the reader is looking at the full scale.
    expect(full.robustMax).toBe(18);
  });

  test("ratingScale marks the winner only when there is something to win", () => {
    const many = ratingScale([rated("a", "A", 4.6), rated("b", "B", 4.2)]);
    expect([...many.best]).toEqual(["a"]);
    expect(many.median).toBe(4.4);
    // A single scored column has no comparison to win.
    expect([...ratingScale([rated("a", "A", 4.6)]).best]).toEqual([]);
  });
});

describe("one monthly axis", () => {
  function planned(
    id: string,
    name: string,
    plans: Array<{ name: string; price: number | null; billingPeriod: string | null }>,
    currency = "USD",
  ): CompareColumn {
    const comparable = plans.filter((p) => p.price != null).map((p) => p.price as number);
    return col({
      id,
      name,
      pricing: {
        entry: comparable.length ? Math.min(...comparable) : null,
        top: comparable.length ? Math.max(...comparable) : null,
        currency,
        billingPeriod: "monthly",
        plans,
        capturedAt: null,
      },
    });
  }

  // 0.8 EUR to the dollar, so €100 reads as $125 on the axis.
  const RATES = { USD: 1, EUR: 0.8 };

  const monthlyAndYearly = planned("a", "A", [
    { name: "Starter", price: 29, billingPeriod: "monthly" },
    { name: "Pro", price: 99, billingPeriod: "monthly" },
    { name: "Starter", price: 290, billingPeriod: "yearly" },
    { name: "Pro", price: 990, billingPeriod: "yearly" },
    { name: "Enterprise", price: null, billingPeriod: "custom" },
  ]);
  const yearlyOnly = planned("y", "Y", [
    { name: "Team", price: 600, billingPeriod: "yearly" },
    { name: "Scale", price: 1200, billingPeriod: "yearly" },
  ]);
  const euro = planned("e", "E", [{ name: "Team", price: 100, billingPeriod: "monthly" }], "EUR");

  test("a column is read on the cheapest unit of commitment it publishes", () => {
    // The annual variants of the SAME plans are the same offer billed differently,
    // not two cheaper tiers — a column that publishes monthly is read monthly.
    expect(priceReading(monthlyAndYearly, null)).toMatchObject({
      kind: "band",
      entry: 29,
      top: 99,
      approx: false,
      period: "monthly",
    });
  });

  test("an annual-only column reads as its monthly equivalent, marked derived", () => {
    expect(priceReading(yearlyOnly, null)).toMatchObject({
      kind: "band",
      entry: 50,
      top: 100,
      approx: true,
      period: "yearly",
    });
  });

  test("another currency is converted onto the axis and names itself", () => {
    expect(priceReading(euro, RATES, "USD")).toMatchObject({
      kind: "band",
      entry: 125,
      top: 125,
      approx: true,
      from: "EUR",
    });
  });

  test("with no rate table the foreign column stays off the axis rather than guessing", () => {
    expect(priceReading(euro, null, "USD")).toEqual({ kind: "foreign", currency: "EUR" });
    // ...and the axis falls back to what the set is mostly captured in, so an
    // all-EUR set still reads on one scale.
    expect(displayCurrency([euro], null)).toBe("EUR");
    expect(displayCurrency([euro], RATES)).toBe("USD");
    expect(priceReading(euro, null, "EUR")).toMatchObject({ entry: 100, approx: false });
  });

  test("a one-time price has no monthly equivalent, so it reads off-axis", () => {
    const oneOff = planned("o", "O", [{ name: "Licence", price: 499, billingPeriod: "one_time" }]);
    expect(priceReading(oneOff, null)).toMatchObject({ kind: "one_time", entry: 499 });
    expect(priceScale([oneOff]).hasData).toBe(false);
  });

  test("quote-only and nothing-captured are their own readings", () => {
    expect(priceReading(priced("c", "C", null, null), null)).toEqual({ kind: "quote" });
    expect(priceReading(col({ id: "n", name: "N" }), null)).toEqual({ kind: "none" });
  });

  test("a column whose plan rows never came back still stands on its own band", () => {
    expect(priceReading(priced("c", "C", 19, 89), null)).toMatchObject({
      kind: "band",
      entry: 19,
      top: 89,
    });
  });

  test("the scale holds every convertible column and names what it derived", () => {
    const s = priceScale([monthlyAndYearly, yearlyOnly, euro], { rates: RATES, to: "USD" });
    expect(s.currency).toBe("USD");
    expect(s.period).toBe("mo");
    // 29 (monthly), 50 (annual ÷12), 125 (converted) — one axis, three units captured.
    expect(s.medianEntry).toBe(50);
    expect(s.max).toBe(200);
    expect(s.converted).toEqual(["EUR"]);
    expect(s.annualised).toBe(true);
  });
});

describe("techDiff", () => {
  const cols = [
    col({ id: "a", name: "A", tech: ["Stripe", "Neon"] }),
    col({
      id: "b",
      name: "B",
      tech: ["stripe", "Salesforce"],
      platform: { framework: "Next.js", cms: null, ats: null, hosting: null },
    }),
    col({ id: "c", name: "C", tech: ["Stripe"] }),
  ];

  test("techOf merges the platform values and dedupes case-insensitively", () => {
    expect(
      techOf(
        col({
          id: "x",
          name: "X",
          tech: ["Vercel"],
          platform: { framework: "Next.js", cms: null, ats: null, hosting: "vercel" },
        }),
      ),
    ).toEqual(["Vercel", "Next.js"]);
  });

  test("what everyone runs is stated once and dropped from the rows", () => {
    const d = techDiff(cols);
    expect(d.shared).toEqual(["Stripe"]);
    expect(d.byId.get("a")).toEqual([{ name: "Neon", only: true }]);
    expect(d.byId.get("c")).toEqual([]);
  });

  test("only-one-runs-it is flagged, shared-by-some is not", () => {
    const d = techDiff([
      col({ id: "a", name: "A", tech: ["Segment", "Neon"] }),
      col({ id: "b", name: "B", tech: ["Segment", "Snowflake"] }),
    ]);
    expect(d.shared).toEqual(["Segment"]);
    expect(d.byId.get("b")).toEqual([{ name: "Snowflake", only: true }]);
  });

  test("a single column has nothing to share", () => {
    expect(techDiff([col({ id: "a", name: "A", tech: ["Neon"] })]).shared).toEqual([]);
  });
});

describe("buildVerdict", () => {
  const leadText = (v: ReturnType<typeof buildVerdict>) => v.lead.map((s) => s.v).join("");

  test("names the one competitor that undercuts you", () => {
    const you = priced("you", "Sentinel", 29, 149);
    const v = buildVerdict(you, [priced("b", "Beacon", 19, 89), priced("k", "Klarity", 49, 399)], NOW);
    expect(leadText(v)).toContain("Sentinel is mid-table on price.");
    expect(leadText(v)).toContain("Beacon is the only one cheaper at the door, by $10.");
  });

  test("reads best rated and cheapest in one sentence", () => {
    const you = col({
      id: "you",
      name: "Sentinel",
      pricing: { entry: 19, top: 99, currency: "USD", billingPeriod: "monthly", plans: [], capturedAt: null },
      reviews: [{ source: "g2", score: 4.8, reviewCount: 20, sub: null, recordedAt: null }],
    });
    const rival = col({
      id: "k",
      name: "Klarity",
      pricing: { entry: 49, top: 399, currency: "USD", billingPeriod: "monthly", plans: [], capturedAt: null },
      reviews: [{ source: "g2", score: 4.1, reviewCount: 20, sub: null, recordedAt: null }],
    });
    const v = buildVerdict(you, [rival], NOW);
    expect(leadText(v)).toBe("Sentinel is the best rated of the two and the cheapest way in. ");
    // Both readings are good news, so the stable sort keeps them in reading order.
    expect(v.facts.map((f) => f.key)).toEqual(["rating", "price"]);
  });

  test("collapses a double mid-table into one clause", () => {
    const you = col({
      id: "you",
      name: "Sentinel",
      pricing: { entry: 29, top: 99, currency: "USD", billingPeriod: "monthly", plans: [], capturedAt: null },
      reviews: [{ source: "g2", score: 4.2, reviewCount: 5, sub: null, recordedAt: null }],
    });
    const cheapWorse = col({
      id: "b",
      name: "Beacon",
      pricing: { entry: 19, top: 59, currency: "USD", billingPeriod: "monthly", plans: [], capturedAt: null },
      reviews: [{ source: "g2", score: 3.9, reviewCount: 5, sub: null, recordedAt: null }],
    });
    const dearBetter = col({
      id: "k",
      name: "Klarity",
      pricing: { entry: 99, top: 399, currency: "USD", billingPeriod: "monthly", plans: [], capturedAt: null },
      reviews: [{ source: "g2", score: 4.6, reviewCount: 5, sub: null, recordedAt: null }],
    });
    expect(leadText(buildVerdict(you, [cheapWorse, dearBetter], NOW))).toContain(
      "Sentinel is mid-table on both reviews and price.",
    );
  });

  test("ranks price on the lens's axis, not on the unit each product publishes", () => {
    const you = priced("you", "Sentinel", 49, 199);
    // $480 a year is $40 a month: cheaper at the door, though the captured number
    // is ten times yours. Read raw, this named the wrong product cheapest.
    const annual = col({
      id: "b",
      name: "Beacon",
      pricing: {
        entry: 480,
        top: 480,
        currency: "USD",
        billingPeriod: "yearly",
        plans: [{ name: "Team", price: 480, billingPeriod: "yearly" }],
        capturedAt: null,
      },
    });
    const v = buildVerdict(you, [annual], NOW);
    expect(leadText(v)).toContain("Beacon is the only one cheaper at the door, by $9.");
    expect(v.facts.find((f) => f.key === "price")?.value).toBe("$49 vs $40");
  });

  test("calls out the engineering gap only past the multiple", () => {
    const you = hiring("you", "Sentinel", 6, 3);
    const wide = buildVerdict(you, [hiring("a", "Aperture", 31, 19)], NOW);
    expect(leadText(wide)).toContain("Aperture has 19 engineering roles open against your 3.");
    expect(wide.facts.find((f) => f.key === "hiring")?.tone).toBe("bad");

    const narrow = buildVerdict(you, [hiring("a", "Aperture", 8, 5)], NOW);
    expect(leadText(narrow)).not.toContain("engineering roles open");
    expect(narrow.facts.find((f) => f.key === "hiring")?.tone).toBe("flat");
  });

  test("surfaces a fresh high-severity move and drops a stale one", () => {
    const you = col({ id: "you", name: "Sentinel" });
    const mover = col({
      id: "k",
      name: "Klarity",
      latestSignal: {
        id: "sig-1",
        severity: "critical",
        category: "pricing",
        insight: "Cut the entry plan from $79 to $49, removing the seat minimum.",
        createdAt: ago(2),
      },
    });
    const fresh = buildVerdict(you, [mover], NOW);
    const fact = fresh.facts.find((f) => f.key === "moves");
    expect(fact?.lead).toBe("Klarity just moved");
    expect(fact?.rest).toBe("cut the entry plan from $79 to $49");
    expect(fact?.value).toBe("2d");

    const stale = buildVerdict(
      you,
      [col({ id: "k", name: "Klarity", latestSignal: { ...mover.latestSignal!, createdAt: ago(40) } })],
      NOW,
    );
    expect(stale.facts.find((f) => f.key === "moves")).toBeUndefined();
  });

  test("says nothing at all when nothing was captured", () => {
    const v = buildVerdict(col({ id: "you", name: "Sentinel" }), [col({ id: "b", name: "Beacon" })], NOW);
    expect(v.lead).toEqual([]);
    expect(v.facts).toEqual([]);
  });
});

// --- Phase 3: a usage-based competitor on the price axis --------------------

/** A competitor that publishes only a rate, plus what it costs at two volumes. */
function metered(
  id: string,
  name: string,
  meters: Array<{ unit: string; qty: number; cost: number; currency?: string }>,
): CompareColumn {
  return col({
    id,
    name,
    pricing: {
      entry: null,
      top: null,
      currency: "USD",
      billingPeriod: "usage",
      plans: [{ name: "Pay as you go", price: 0.1, billingPeriod: "usage", unit: "API call" }],
      capturedAt: null,
      model: "usage",
      meters: meters.map((m) => ({
        unit: m.unit,
        qty: m.qty,
        cost: m.cost,
        currency: m.currency ?? "USD",
        planName: "Pay as you go",
      })),
    },
  });
}

const REQ_10K = { unit: "request", qty: 10_000 };

describe("priceReading — the metered branch", () => {
  const usage = metered("u", "Meter", [
    { unit: "request", qty: 10_000, cost: 800 },
    { unit: "request", qty: 100_000, cost: 6_700 },
  ]);

  test("with no volume selected it reads exactly as it did before P3", () => {
    expect(priceReading(usage, null)).toEqual({ kind: "quote" });
  });

  test("a named volume puts it on the axis at what it costs there", () => {
    const r = priceReading(usage, null, "USD", REQ_10K);
    expect(r.kind).toBe("band");
    if (r.kind !== "band") throw new Error("expected a band");
    expect(r.entry).toBe(800);
    expect(r.top).toBe(800);
    // Marked: a computed cost and a published price are not the same claim.
    expect(r.approx).toBe(true);
    expect(r.meter).toEqual(REQ_10K);
  });

  test("a volume it has no cost for leaves it off the axis rather than guessing", () => {
    expect(priceReading(usage, null, "USD", { unit: "request", qty: 42 })).toEqual({
      kind: "quote",
    });
    expect(priceReading(usage, null, "USD", { unit: "gb", qty: 10_000 })).toEqual({
      kind: "quote",
    });
  });

  test("a metered cost is converted onto the axis currency like any other", () => {
    const eur = metered("e", "Euro", [{ unit: "request", qty: 10_000, cost: 100, currency: "EUR" }]);
    const r = priceReading(eur, { USD: 1, EUR: 0.5 }, "USD", REQ_10K);
    if (r.kind !== "band") throw new Error("expected a band");
    expect(r.entry).toBe(200);
    expect(r.from).toBe("EUR");
  });

  test("a currency no rate reaches still says so", () => {
    const exotic = metered("x", "Exotic", [
      { unit: "request", qty: 10_000, cost: 100, currency: "XYZ" },
    ]);
    expect(priceReading(exotic, { USD: 1 }, "USD", REQ_10K)).toEqual({
      kind: "foreign",
      currency: "XYZ",
    });
  });
});

describe("priceScale — no regression for subscription-only sets", () => {
  const set = [priced("a", "Alpha", 29, 99), priced("b", "Beta", 49, 149)];

  test("a selected volume changes nothing when nobody meters anything", () => {
    expect(priceScale(set, { rates: null, to: "USD", meter: REQ_10K })).toEqual(
      priceScale(set, { rates: null, to: "USD" }),
    );
  });

  test("a subscription band is never replaced by a metered cost", () => {
    // Same column, priced AND metered: the published band wins, because that is
    // what the competitor actually asks at the door.
    const both = col({
      id: "h",
      name: "Hybrid",
      pricing: {
        entry: 99,
        top: 99,
        currency: "USD",
        billingPeriod: "monthly",
        plans: [{ name: "Business", price: 99, billingPeriod: "monthly", unit: null }],
        capturedAt: null,
        model: "hybrid",
        meters: [
          { unit: "request", qty: 10_000, cost: 599, currency: "USD", planName: "Business" },
        ],
      },
    });
    const r = priceReading(both, null, "USD", REQ_10K);
    if (r.kind !== "band") throw new Error("expected a band");
    expect(r.entry).toBe(99);
    expect(r.meter).toBeUndefined();
  });

  test("a metered column joins the same axis as the subscriptions", () => {
    const mixed = [...set, metered("u", "Meter", [{ unit: "request", qty: 10_000, cost: 800 }])];
    const scale = priceScale(mixed, { rates: null, to: "USD", meter: REQ_10K });
    expect(scale.hasData).toBe(true);
    // 800 is on the axis, and the median entry now counts three columns.
    expect(scale.fullMax).toBeGreaterThanOrEqual(800);
    expect(scale.medianEntry).toBe(49);
  });
});

describe("availableMeters", () => {
  test("dedupes across columns and sorts by meter then volume", () => {
    const a = metered("a", "A", [
      { unit: "request", qty: 100_000, cost: 1 },
      { unit: "request", qty: 1_000, cost: 1 },
    ]);
    const b = metered("b", "B", [
      { unit: "request", qty: 1_000, cost: 1 },
      { unit: "gb", qty: 500, cost: 1 },
    ]);
    expect(availableMeters([a, b])).toEqual([
      { unit: "gb", qty: 500 },
      { unit: "request", qty: 1_000 },
      { unit: "request", qty: 100_000 },
    ]);
  });

  test("a set that meters nothing offers no volumes", () => {
    expect(availableMeters([priced("a", "Alpha", 29, 99)])).toEqual([]);
  });
});

// ── Shipping velocity (Content Intelligence v2 P5) ──────────────────────────

function shipping(
  id: string,
  perMonth: number,
  previousPerMonth: number | null,
  months: Array<{ month: string; count: number }> = [],
): CompareColumn {
  return col({
    id,
    name: id,
    shipping: { perMonth, previousPerMonth, months, monthsObserved: Math.max(2, months.length) },
  });
}

describe("shipping velocity", () => {
  test("a competitor with no reading is absent from the lens, not a zero", () => {
    // The API returns null under two complete months; the lens must not draw that
    // as "0 releases a month", which would claim they stopped shipping.
    const cols = [col({ id: "a", name: "a" }), shipping("b", 6, null)];
    expect(releasesPerMonth(cols[0]!)).toBeNull();
    expect(releasesPerMonth(cols[1]!)).toBe(6);
  });

  test("the lens hides entirely when nobody has a reading", () => {
    const scale = shippingScale([col({ id: "a", name: "a" }), col({ id: "b", name: "b" })]);
    expect(scale.hasData).toBe(false);
  });

  test("the bar scale is the fastest shipper, the month scale the biggest month", () => {
    const scale = shippingScale([
      shipping("a", 4, null, [
        { month: "2026-05", count: 2 },
        { month: "2026-06", count: 6 },
      ]),
      shipping("b", 9, null, [{ month: "2026-06", count: 11 }]),
    ]);
    expect(scale.max).toBe(9);
    expect(scale.monthMax).toBe(11);
    expect(scale.clipped).toBe(false);
  });

  test("a competitor shipping ten times the field is trimmed off the lane", () => {
    const cols = [
      shipping("a", 3, null),
      shipping("b", 4, null),
      shipping("c", 6, null),
      shipping("runaway", 60, null),
    ];
    const scale = shippingScale(cols);
    expect(scale.max).toBe(6);
    expect(scale.fullMax).toBe(60);
    expect(scale.clipped).toBe(true);
    expect(shippingScale(cols, { full: true }).max).toBe(60);
  });

  test("no previous window means no arrow", () => {
    expect(releaseTrend(shipping("a", 6, null))).toBeNull();
  });

  test("a move under 15% is arithmetic, not a change of pace", () => {
    expect(releaseTrend(shipping("a", 6.4, 6))).toBeNull();
    expect(releaseTrend(shipping("a", 5.6, 6))).toBeNull();
  });

  test("a real move points", () => {
    expect(releaseTrend(shipping("a", 12, 6))).toBe("up");
    expect(releaseTrend(shipping("a", 2, 6))).toBe("down");
  });

  test("shipping again after a silent window is a direction; still silent is not", () => {
    expect(releaseTrend(shipping("a", 3, 0))).toBe("up");
    expect(releaseTrend(shipping("a", 0, 0))).toBeNull();
  });
});
