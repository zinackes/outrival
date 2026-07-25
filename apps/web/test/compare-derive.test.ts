import { test, expect, describe } from "bun:test";
import type { CompareColumn } from "../src/lib/api";
import {
  agePhrase,
  avgReview,
  axisTicks,
  bandOf,
  basisLabel,
  buildVerdict,
  countWord,
  median,
  nameList,
  niceMax,
  priceBases,
  priceScale,
  hiringScale,
  ratingScale,
  robustCeiling,
  shortAge,
  techDiff,
  techOf,
} from "../src/components/dashboard/compare/derive";

// The compare page states its verdict as fact, so the arithmetic behind it is locked
// here: the shared scales, the tech diff, and every branch of the reading.

const NOW = Date.UTC(2026, 6, 25, 12, 0, 0);
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

function col(over: Partial<CompareColumn> & { id: string; name: string }): CompareColumn {
  return {
    url: `https://${over.name.toLowerCase()}.example`,
    positioning: { category: null, summary: null },
    pricing: null,
    hiring: null,
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
      hasData: true,
      hasEngineering: true,
    });
    expect(hiringScale([hiring("b", "B", 31, null)]).hasEngineering).toBe(false);
  });

  test("ratingScale marks the winner only when there is something to win", () => {
    const many = ratingScale([rated("a", "A", 4.6), rated("b", "B", 4.2)]);
    expect([...many.best]).toEqual(["a"]);
    expect(many.median).toBe(4.4);
    // A single scored column has no comparison to win.
    expect([...ratingScale([rated("a", "A", 4.6)]).best]).toEqual([]);
  });
});

describe("price basis", () => {
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

  const monthlyAndYearly = planned("a", "A", [
    { name: "Starter", price: 29, billingPeriod: "monthly" },
    { name: "Pro", price: 99, billingPeriod: "monthly" },
    { name: "Starter", price: 290, billingPeriod: "yearly" },
    { name: "Pro", price: 990, billingPeriod: "yearly" },
    { name: "Enterprise", price: null, billingPeriod: "custom" },
  ]);
  const monthlyOnly = planned("b", "B", [
    { name: "Team", price: 49, billingPeriod: "monthly" },
  ]);

  test("lists every captured basis, most represented first", () => {
    expect(priceBases([monthlyAndYearly, monthlyOnly]).map((b) => b.key)).toEqual([
      "USD:monthly",
      "USD:yearly",
    ]);
    expect(basisLabel({ currency: "USD", period: "yearly" })).toBe("USD / yr");
  });

  test("a band is read from the plans on that basis, never converted", () => {
    expect(bandOf(monthlyAndYearly, { currency: "USD", period: "monthly" })).toEqual({
      entry: 29,
      top: 99,
    });
    expect(bandOf(monthlyAndYearly, { currency: "USD", period: "yearly" })).toEqual({
      entry: 290,
      top: 990,
    });
    // Priced, but not on the basis on screen — the row says so rather than borrowing
    // the monthly number and calling it annual.
    expect(bandOf(monthlyOnly, { currency: "USD", period: "yearly" })).toBeNull();
    // Another currency is another scale entirely.
    expect(bandOf(monthlyOnly, { currency: "EUR", period: "monthly" })).toBeNull();
  });

  test("a column whose plan rows never came back still stands on its own basis", () => {
    const bandOnly = priced("c", "C", 19, 89);
    expect(priceBases([bandOnly]).map((b) => b.key)).toEqual(["USD:monthly"]);
    expect(bandOf(bandOnly, { currency: "USD", period: "monthly" })).toEqual({
      entry: 19,
      top: 89,
    });
    expect(bandOf(bandOnly, { currency: "USD", period: "yearly" })).toBeNull();
  });

  test("the scale follows the chosen basis", () => {
    const yearly = priceScale([monthlyAndYearly, monthlyOnly], {
      basis: { currency: "USD", period: "yearly" },
    });
    expect(yearly.max).toBe(1000);
    expect(yearly.period).toBe("yr");
    // Only the column that publishes annually is on this axis.
    expect(yearly.medianEntry).toBe(290);
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
