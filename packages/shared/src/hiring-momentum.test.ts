import { test, expect, describe } from "bun:test";
import {
  classifyLeadershipRole,
  detectRemotePolicyShift,
  leadershipSeverity,
  momentumFacts,
  momentumLines,
  remoteShare,
  remoteState,
  timeToFillByBucket,
  type RemoteWeekPoint,
} from "./hiring-momentum";

// P5 turns four accumulated tables into a state, a median and four sentences, and
// every one of them is stated as fact somewhere a reader can act on it. The bands,
// the hysteresis and the fallbacks are locked here.

describe("remoteShare", () => {
  test("counts hybrid at half and keeps unresolved roles out of the denominator", () => {
    const r = remoteShare([
      { remoteMode: "remote" },
      { remoteMode: "remote" },
      { remoteMode: "hybrid" },
      { remoteMode: "onsite" },
      { remoteMode: null },
    ]);
    expect(r.known).toBe(4);
    expect(r.unknown).toBe(1);
    expect(r.share).toBeCloseTo(2.5 / 4, 6);
    expect(r.unknownShare).toBeCloseTo(0.2, 6);
  });

  test("an all-hybrid board sits in the middle, not at the office end", () => {
    const r = remoteShare(Array.from({ length: 6 }, () => ({ remoteMode: "hybrid" })));
    expect(r.share).toBe(0.5);
    expect(remoteState(r.share, r.known)).toBe("hybrid_mix");
  });

  test("nothing resolved is a null share, never a zero one", () => {
    const r = remoteShare([{ remoteMode: null }, { remoteMode: null }]);
    expect(r.share).toBeNull();
    expect(r.unknownShare).toBe(1);
    expect(remoteState(r.share, r.known)).toBeNull();
  });
});

describe("remoteState", () => {
  test("the band edges", () => {
    expect(remoteState(0.299, 10)).toBe("office_first");
    // 0.30 belongs to hybrid, 0.70 belongs to remote-first.
    expect(remoteState(0.3, 10)).toBe("hybrid_mix");
    expect(remoteState(0.699, 10)).toBe("hybrid_mix");
    expect(remoteState(0.7, 10)).toBe("remote_first");
    expect(remoteState(1, 10)).toBe("remote_first");
  });

  test("under five resolved roles there is no state at all", () => {
    expect(remoteState(0.9, 4)).toBeNull();
    expect(remoteState(0.9, 5)).toBe("remote_first");
  });
});

describe("detectRemotePolicyShift", () => {
  const week = (weekStart: string, state: RemoteWeekPoint["state"], share: number): RemoteWeekPoint => ({
    weekStart,
    state,
    share,
    n: 18,
    unknownShare: 0.1,
  });

  test("fires on a transition that held two weeks against a state that held two", () => {
    const shift = detectRemotePolicyShift(
      [
        week("2026-06-29", "remote_first", 0.78),
        week("2026-07-06", "remote_first", 0.74),
        week("2026-07-13", "office_first", 0.24),
        week("2026-07-20", "office_first", 0.22),
      ],
      "2026-07-20",
    );
    expect(shift?.from).toBe("remote_first");
    expect(shift?.to).toBe("office_first");
    expect(shift?.toShare).toBeCloseTo(0.22, 6);
    expect(shift?.heldWeeks).toEqual(["2026-07-13", "2026-07-20"]);
  });

  test("a single week at the other end of the scale is noise, not a policy", () => {
    expect(
      detectRemotePolicyShift(
        [
          week("2026-06-29", "office_first", 0.2),
          week("2026-07-06", "office_first", 0.22),
          week("2026-07-13", "office_first", 0.24),
          week("2026-07-20", "remote_first", 0.75),
        ],
        "2026-07-20",
      ),
    ).toBeNull();
  });

  test("a state that never held two weeks before the move is not a baseline", () => {
    expect(
      detectRemotePolicyShift(
        [
          week("2026-06-29", "hybrid_mix", 0.5),
          week("2026-07-06", "remote_first", 0.8),
          week("2026-07-13", "office_first", 0.2),
          week("2026-07-20", "office_first", 0.2),
        ],
        "2026-07-20",
      ),
    ).toBeNull();
  });

  test("a board that stopped being scraped never fires against stale weeks", () => {
    const points = [
      week("2026-06-29", "remote_first", 0.78),
      week("2026-07-06", "remote_first", 0.74),
      week("2026-07-13", "office_first", 0.24),
      week("2026-07-20", "office_first", 0.22),
    ];
    expect(detectRemotePolicyShift(points, "2026-07-27")).toBeNull();
  });

  test("weeks with too few resolved roles break the run rather than being skipped", () => {
    expect(
      detectRemotePolicyShift(
        [
          week("2026-06-29", "remote_first", 0.78),
          week("2026-07-06", "remote_first", 0.74),
          { weekStart: "2026-07-13", state: null, share: null, n: 2, unknownShare: 0.8 },
          week("2026-07-20", "office_first", 0.22),
        ],
        "2026-07-20",
      ),
    ).toBeNull();
  });

  test("holding the same state forever is not news", () => {
    expect(
      detectRemotePolicyShift(
        [
          week("2026-06-29", "office_first", 0.2),
          week("2026-07-06", "office_first", 0.21),
          week("2026-07-13", "office_first", 0.19),
          week("2026-07-20", "office_first", 0.2),
        ],
        "2026-07-20",
      ),
    ).toBeNull();
  });
});

describe("timeToFillByBucket", () => {
  const day = (n: number) => new Date(Date.UTC(2026, 5, n));

  test("medians on postedAt when the board states one", () => {
    const out = timeToFillByBucket([
      { department: "Engineering", title: "Backend", postedAt: day(1), detectedAt: day(1), closedAt: day(11) },
      { department: "Engineering", title: "Frontend", postedAt: day(1), detectedAt: day(1), closedAt: day(21) },
      { department: "Engineering", title: "SRE", postedAt: day(1), detectedAt: day(1), closedAt: day(31) },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.bucket).toBe("engineering");
    expect(out[0]?.medianDays).toBe(20);
    expect(out[0]?.n).toBe(3);
    expect(out[0]?.approx).toBe(false);
  });

  test("falls back to detectedAt and says so once a third of the points do", () => {
    const out = timeToFillByBucket([
      { department: "Sales", title: "AE", postedAt: null, detectedAt: day(1), closedAt: day(11) },
      { department: "Sales", title: "SDR", postedAt: day(1), detectedAt: day(3), closedAt: day(11) },
      { department: "Sales", title: "AM", postedAt: day(1), detectedAt: day(3), closedAt: day(11) },
    ]);
    expect(out[0]?.approx).toBe(true);
    // The fallback point starts later, so the median is a floor on the real one.
    expect(out[0]?.medianDays).toBe(10);
  });

  test("under three closed roles a bucket has no median, and unknown never has one", () => {
    const out = timeToFillByBucket([
      { department: "Design", title: "Product Designer", postedAt: day(1), detectedAt: day(1), closedAt: day(9) },
      { department: "Design", title: "Brand Designer", postedAt: day(1), detectedAt: day(1), closedAt: day(9) },
      { department: "Zzz", title: "Zzz", postedAt: day(1), detectedAt: day(1), closedAt: day(9) },
      { department: "Zzz", title: "Zzz2", postedAt: day(1), detectedAt: day(1), closedAt: day(9) },
      { department: "Zzz", title: "Zzz3", postedAt: day(1), detectedAt: day(1), closedAt: day(9) },
    ]);
    expect(out).toEqual([]);
  });

  test("a closure dated before the opening is skew, not an instant hire", () => {
    const out = timeToFillByBucket([
      { department: "Engineering", title: "A", postedAt: day(11), detectedAt: day(11), closedAt: day(1) },
      { department: "Engineering", title: "B", postedAt: day(1), detectedAt: day(1), closedAt: day(11) },
      { department: "Engineering", title: "C", postedAt: day(1), detectedAt: day(1), closedAt: day(11) },
    ]);
    expect(out).toEqual([]);
  });
});

describe("classifyLeadershipRole", () => {
  test("C-level by title, spelled out or as an acronym", () => {
    expect(classifyLeadershipRole("Chief Revenue Officer")).toBe("c_level");
    expect(classifyLeadershipRole("Chief Product & Technology Officer")).toBe("c_level");
    expect(classifyLeadershipRole("CTO (EU)")).toBe("c_level");
  });

  test("VP and Head of are one band down", () => {
    expect(classifyLeadershipRole("VP of Sales")).toBe("vp_head");
    expect(classifyLeadershipRole("Head of Growth")).toBe("vp_head");
    expect(classifyLeadershipRole("Vice-président Marketing")).toBe("vp_head");
  });

  test("the ambiguous titles stay out", () => {
    expect(classifyLeadershipRole("Director of Engineering")).toBeNull();
    expect(classifyLeadershipRole("Directeur général adjoint")).toBeNull();
    expect(classifyLeadershipRole("Responsable comptabilité")).toBeNull();
    // Not a C-level acronym, and "officer" alone must never qualify.
    expect(classifyLeadershipRole("Security Officer")).toBeNull();
    expect(classifyLeadershipRole("Senior Backend Engineer")).toBeNull();
  });

  test("the ATS seniority promotes a title we missed, but never to C-level", () => {
    expect(classifyLeadershipRole("General Manager, DACH", "executive")).toBe("vp_head");
    expect(classifyLeadershipRole("Chief Financial Officer", "executive")).toBe("c_level");
  });

  test("severity is the max of the roles in the group", () => {
    expect(leadershipSeverity(["vp_head", "vp_head"])).toBe("medium");
    expect(leadershipSeverity(["vp_head", "c_level"])).toBe("high");
  });
});

describe("momentumFacts", () => {
  const NOW = new Date(Date.UTC(2026, 7, 1));
  const weeks = (counts: number[]) =>
    counts.map((openCount, i) => ({
      weekStart: new Date(Date.UTC(2026, 5, 1) + i * 7 * 86_400_000).toISOString().slice(0, 10),
      openCount,
    }));

  test("reads the trend over four weeks against the four before", () => {
    const facts = momentumFacts({
      weeklyTotals: weeks([3, 3, 3, 3, 5, 5, 4, 5]),
      countries: [],
      leadership: [],
      salary: null,
      now: NOW,
    });
    expect(facts.velocityTrend).toEqual({ direction: "up", recent: 19, prior: 12, weeks: 4 });
  });

  test("a move inside the flat band is flat, not a trend", () => {
    const facts = momentumFacts({
      weeklyTotals: weeks([5, 5, 5, 5, 5, 5, 5, 5]),
      countries: [],
      leadership: [],
      salary: null,
      now: NOW,
    });
    expect(facts.velocityTrend?.direction).toBe("flat");
  });

  test("under eight weeks, and against an empty baseline, there is no trend", () => {
    const short = momentumFacts({
      weeklyTotals: weeks([1, 2, 3, 4, 5, 6, 7]),
      countries: [],
      leadership: [],
      salary: null,
      now: NOW,
    });
    expect(short.velocityTrend).toBeNull();

    const fromNothing = momentumFacts({
      weeklyTotals: weeks([0, 0, 0, 0, 3, 4, 5, 6]),
      countries: [],
      leadership: [],
      salary: null,
      now: NOW,
    });
    expect(fromNothing.velocityTrend).toBeNull();
  });

  test("only countries and hires inside the window count", () => {
    const facts = momentumFacts({
      weeklyTotals: [],
      countries: [
        { code: "DE", firstWeek: "2026-07-06", openCount: 4 },
        { code: "ES", firstWeek: "2026-06-29", openCount: 1 },
        { code: "FR", firstWeek: "2024-01-01", openCount: 20 },
        // First seen recently but nothing open now: not a market they are in.
        { code: "IT", firstWeek: "2026-07-20", openCount: 0 },
      ],
      leadership: [
        { title: "Chief Revenue Officer", detectedAt: new Date(Date.UTC(2026, 6, 20)), rank: "c_level" },
        { title: "VP Sales", detectedAt: new Date(Date.UTC(2026, 6, 1)), rank: "vp_head" },
        { title: "Head of Ops", detectedAt: new Date(Date.UTC(2025, 1, 1)), rank: "vp_head" },
      ],
      salary: null,
      now: NOW,
    });
    expect(facts.newCountries).toEqual(["DE", "ES"]);
    expect(facts.leadershipHires.map((l) => l.title)).toEqual(["Chief Revenue Officer", "VP Sales"]);
  });
});

describe("momentumLines", () => {
  test("renders one line per fact, and a null fact renders none", () => {
    const lines = momentumLines({
      velocityTrend: { direction: "up", recent: 19, prior: 12, weeks: 4 },
      newCountries: ["DE", "ES"],
      leadershipHires: [{ title: "CRO", rank: "c_level" }],
      salaryPosture: { verdict: "yes", engP50: 72000, currency: "EUR", n: 6 },
    });
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("19 open roles");
    expect(lines[1]).toContain("Germany");
    expect(lines[2]).toContain("CRO");
    expect(lines[3]).toBe("Salaries: published, engineering median 72,000 EUR (n=6).");
  });

  test("no facts at all is an empty section, never a hedged one", () => {
    expect(
      momentumLines({
        velocityTrend: null,
        newCountries: [],
        leadershipHires: [],
        salaryPosture: null,
      }),
    ).toEqual([]);
  });

  test("a salary posture with no engineering band still states the posture", () => {
    const lines = momentumLines({
      velocityTrend: null,
      newCountries: [],
      leadershipHires: [],
      salaryPosture: { verdict: "no", engP50: null, currency: null, n: 0 },
    });
    expect(lines).toEqual(["Salaries: not published."]);
  });
});
