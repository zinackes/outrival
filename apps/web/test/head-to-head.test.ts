import { test, expect, describe } from "bun:test";
import type { CompareColumn } from "../src/lib/api";
import { buildHeadToHead } from "../src/components/dashboard/compare/head-to-head";

// The profile states these two sections as fact and dates every one of them, so the
// arithmetic and the provenance are locked together here: a line that loses its
// source is as wrong as a line that names the wrong winner.

const NOW = Date.UTC(2026, 7, 16, 12, 0, 0);
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

function col(over: Partial<CompareColumn> & { id: string; name: string }): CompareColumn {
  return {
    url: null,
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

function pricing(
  entry: number,
  capturedAt: string | null = null,
): NonNullable<CompareColumn["pricing"]> {
  return {
    entry,
    top: entry * 3,
    currency: "USD",
    billingPeriod: "monthly",
    plans: [],
    capturedAt,
    model: null,
    meters: [],
    curves: [],
    curveMarks: [],
  };
}

function hiring(
  totalOpen: number,
  engineeringOpen: number | null = null,
  capturedAt: string | null = null,
): NonNullable<CompareColumn["hiring"]> {
  return {
    totalOpen,
    topDepartment: "Engineering",
    departments: [{ department: "Engineering", count: totalOpen }],
    engineeringOpen,
    engineeringMedianSalary: null,
    capturedAt,
  };
}

function shipping(perMonth: number): NonNullable<CompareColumn["shipping"]> {
  return { perMonth, previousPerMonth: null, months: [], monthsObserved: 3 };
}

function review(
  source: string,
  score: number,
  reviewCount: number,
  sub: { ease: number; support: number; features: number; value: number } | null = null,
  recordedAt: string | null = null,
) {
  return { source, score, reviewCount, sub, recordedAt };
}

const you = (over: Partial<CompareColumn> = {}) => col({ id: "you", name: "Ours", ...over });
const them = (over: Partial<CompareColumn> = {}) => col({ id: "them", name: "Acme", ...over });

const read = (c: CompareColumn, t: CompareColumn) => buildHeadToHead(c, t, NOW, null);
const line = (r: ReturnType<typeof read>, key: string) => r.compare.find((l) => l.key === key);
const move = (r: ReturnType<typeof read>, key: string) =>
  r.differentiate.find((m) => m.key === key);

describe("entry price", () => {
  test("names the cheaper side and the gap, dated off their pricing page", () => {
    const r = read(you({ pricing: pricing(20) }), them({ pricing: pricing(50, ago(3)) }));
    const l = line(r, "price");
    expect(l?.lead).toBe("You open cheaper");
    expect(l?.rest).toBe("by $30 a month");
    expect(l?.value).toBe("$20 vs $50");
    expect(l?.tone).toBe("good");
    expect(l?.provenance).toEqual({ source: "their pricing page", at: ago(3) });
    expect(move(r, "price")?.action).toBe("Lead with the entry price");
  });

  test("being dearer turns the move into an objection to answer", () => {
    const r = read(you({ pricing: pricing(60) }), them({ pricing: pricing(50) }));
    expect(line(r, "price")?.lead).toBe("You open dearer");
    expect(line(r, "price")?.tone).toBe("bad");
    expect(move(r, "price")?.action).toBe("Answer the price objection first");
  });

  test("a gap under the tie ratio is not a finding", () => {
    const r = read(you({ pricing: pricing(50) }), them({ pricing: pricing(51) }));
    expect(line(r, "price")?.lead).toBe("Level at the door");
    expect(line(r, "price")?.tone).toBe("flat");
    expect(move(r, "price")).toBeUndefined();
  });

  test("a price held on one side only produces no comparison", () => {
    expect(line(read(you({ pricing: pricing(20) }), them()), "price")).toBeUndefined();
    expect(line(read(you(), them({ pricing: pricing(50) })), "price")).toBeUndefined();
  });

  test("an undated capture still names the surface", () => {
    const r = read(you({ pricing: pricing(20) }), them({ pricing: pricing(50) }));
    expect(line(r, "price")?.provenance).toEqual({ source: "their pricing page", at: null });
  });
});

describe("review standing", () => {
  const themRated = (score: number) =>
    them({ reviews: [review("G2", score, 900, null, ago(9))] });

  test("the rating gap is dated off their loudest source", () => {
    const r = read(you({ reviews: [review("G2", 4.6, 40)] }), themRated(4.1));
    const l = line(r, "rating");
    expect(l?.lead).toBe("You are rated higher");
    expect(l?.rest).toBe("by 0.5 of a point");
    expect(l?.value).toBe("4.6 vs 4.1");
    expect(l?.provenance).toEqual({ source: "G2", at: ago(9) });
    expect(move(r, "rating")?.action).toBe("Put the ratings side by side");
  });

  test("trailing them states it and offers no move", () => {
    const r = read(you({ reviews: [review("G2", 3.9, 40)] }), themRated(4.4));
    expect(line(r, "rating")?.lead).toBe("They are rated higher");
    expect(line(r, "rating")?.tone).toBe("bad");
    expect(move(r, "rating")).toBeUndefined();
  });

  test("a tenth of a point apart is level", () => {
    const r = read(you({ reviews: [review("G2", 4.15, 40)] }), themRated(4.1));
    expect(line(r, "rating")?.lead).toBe("Rated level");
    expect(line(r, "rating")?.tone).toBe("flat");
  });

  test("the loudest source is the most-reviewed one, not the first", () => {
    const r = read(
      you({ reviews: [review("G2", 4.6, 40)] }),
      them({
        reviews: [
          review("Capterra", 4.1, 12, null, ago(2)),
          review("G2", 4.1, 900, null, ago(30)),
        ],
      }),
    );
    expect(line(r, "rating")?.provenance).toEqual({ source: "G2", at: ago(30) });
  });
});

describe("their soft spot", () => {
  test("the dimension their own reviewers rate lowest becomes a move", () => {
    const r = read(
      you(),
      them({
        reviews: [
          review("G2", 4.2, 900, { ease: 4.5, support: 3.6, features: 4.4, value: 4.3 }, ago(4)),
        ],
      }),
    );
    const m = move(r, "soft-spot");
    expect(m?.action).toBe("Lead on support");
    expect(m?.because).toBe("Acme scores 3.6 there on G2, its weakest mark");
    expect(m?.provenance).toEqual({ source: "G2", at: ago(4) });
  });

  test("an evenly rated competitor has no soft spot to lead on", () => {
    const r = read(
      you(),
      them({
        reviews: [review("G2", 4.4, 900, { ease: 4.4, support: 4.3, features: 4.5, value: 4.4 })],
      }),
    );
    expect(move(r, "soft-spot")).toBeUndefined();
  });

  test("a source with fewer than two rated dimensions is not read as weak", () => {
    const r = read(
      you(),
      them({
        reviews: [review("G2", 4.4, 900, { ease: 4.4, support: 0, features: 0, value: 0 })],
      }),
    );
    expect(move(r, "soft-spot")).toBeUndefined();
  });
});

describe("hiring", () => {
  test("hiring harder than you is a warning, and names their engineering count", () => {
    const r = read(you({ hiring: hiring(4) }), them({ hiring: hiring(12, 7, ago(1)) }));
    const l = line(r, "hiring");
    expect(l?.lead).toBe("They are hiring harder");
    expect(l?.rest).toBe("open roles, 7 of theirs in engineering");
    expect(l?.value).toBe("4 vs 12");
    expect(l?.tone).toBe("warn");
    expect(l?.provenance).toEqual({ source: "their jobs board", at: ago(1) });
  });

  test("two boards both at zero say nothing", () => {
    const r = read(you({ hiring: hiring(0) }), them({ hiring: hiring(0) }));
    expect(line(r, "hiring")).toBeUndefined();
  });
});

describe("release cadence", () => {
  test("shipping more often is a move", () => {
    const r = read(you({ shipping: shipping(6) }), them({ shipping: shipping(3) }));
    const l = line(r, "shipping");
    expect(l?.lead).toBe("You ship more often");
    expect(l?.value).toBe("6.0 vs 3.0 /mo");
    expect(l?.tone).toBe("good");
    // The changelog rows behind the rate carry no single capture instant.
    expect(l?.provenance).toEqual({ source: "their changelog", at: null });
    expect(move(r, "shipping")?.action).toBe("Lead with release pace");
  });

  test("a cadence within the tie ratio is the same pace", () => {
    const r = read(you({ shipping: shipping(4) }), them({ shipping: shipping(4.4) }));
    expect(line(r, "shipping")?.lead).toBe("Shipping at the same pace");
    expect(move(r, "shipping")).toBeUndefined();
  });

  test("shipping behind them warns without pretending it is a move", () => {
    const r = read(you({ shipping: shipping(2) }), them({ shipping: shipping(8) }));
    expect(line(r, "shipping")?.lead).toBe("They ship more often");
    expect(line(r, "shipping")?.tone).toBe("warn");
    expect(move(r, "shipping")).toBeUndefined();
  });
});

describe("their latest move", () => {
  test("the signal is dated and toned by severity", () => {
    const r = read(
      you(),
      them({
        latestSignal: {
          id: "s1",
          severity: "critical",
          category: "pricing",
          insight: "Cut its entry plan to $49, then raised the top tier",
          createdAt: ago(2),
        },
      }),
    );
    const l = line(r, "moves");
    expect(l?.lead).toBe("Acme just moved");
    expect(l?.rest).toBe("cut its entry plan to $49");
    expect(l?.value).toBe("2d");
    expect(l?.tone).toBe("bad");
    expect(l?.provenance).toEqual({ source: "the signal feed", at: ago(2) });
  });

  test("a low-severity move is stated flat", () => {
    const r = read(
      you(),
      them({
        latestSignal: {
          id: "s2",
          severity: "low",
          category: "content",
          insight: "Published a customer story",
          createdAt: ago(20),
        },
      }),
    );
    expect(line(r, "moves")?.tone).toBe("flat");
  });
});

describe("the reading as a whole", () => {
  test("what needs attention leads", () => {
    const r = read(
      you({ pricing: pricing(20), hiring: hiring(4), shipping: shipping(6) }),
      them({
        pricing: pricing(50, ago(3)),
        hiring: hiring(12, 7, ago(1)),
        shipping: shipping(3),
        latestSignal: {
          id: "s1",
          severity: "critical",
          category: "pricing",
          insight: "Cut its entry plan",
          createdAt: ago(2),
        },
      }),
    );
    const order = { bad: 0, warn: 1, good: 2, flat: 3 } as const;
    const ranks = r.compare.map((l) => order[l.tone]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(r.compare[0]?.key).toBe("moves");
  });

  test("two columns with nothing captured produce no sections", () => {
    const r = read(you(), them());
    expect(r.compare).toEqual([]);
    expect(r.differentiate).toEqual([]);
  });

  test("every line names a surface", () => {
    const r = read(
      you({ pricing: pricing(20), hiring: hiring(4), shipping: shipping(6) }),
      them({
        pricing: pricing(50, ago(3)),
        hiring: hiring(12, 7, ago(1)),
        shipping: shipping(3),
        reviews: [
          review("G2", 4.1, 900, { ease: 4.5, support: 3.6, features: 4.4, value: 4.3 }, ago(9)),
        ],
      }),
    );
    for (const l of [...r.compare, ...r.differentiate]) {
      expect(l.provenance.source.length).toBeGreaterThan(0);
    }
  });
});
