import { describe, expect, it } from "bun:test";
import {
  EMPTY_SUBJECT_METRICS,
  VISIBILITY_MIN_RUNS,
  VISIBILITY_WINDOW_DAYS,
  detectVisibilityShift,
  extractMentionSentence,
  extractMentionSentences,
  shareOfModel,
  subjectMetrics,
  visibilityEngineLabel,
  visibilityHumanChange,
  visibilityTrend,
  visibilityWindowSeries,
  visibilityWindows,
  windowIndexOf,
  type StoredAnswer,
  type SubjectMetrics,
  type VisibilityAnswer,
} from "./visibility-metrics";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let seq = 0;
function answer(over: Partial<VisibilityAnswer> = {}): VisibilityAnswer {
  seq++;
  return {
    competitorId: "c1",
    runId: `run-${seq}`,
    promptId: `p-${seq}`,
    engine: "gemini",
    recordedAt: new Date("2026-08-01T00:00:00Z"),
    mentioned: false,
    promptNamed: false,
    rank: null,
    cited: null,
    sentiment: null,
    ...over,
  };
}

function metrics(over: Partial<SubjectMetrics> = {}): SubjectMetrics {
  return { ...EMPTY_SUBJECT_METRICS, ...over };
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

describe("visibilityWindows", () => {
  it("ends at the UTC midnight after now, so today counts", () => {
    const { current } = visibilityWindows(new Date("2026-08-04T13:22:41.512Z"));
    expect(current.end.toISOString()).toBe("2026-08-05T00:00:00.000Z");
    expect(current.start.toISOString()).toBe("2026-07-08T00:00:00.000Z");
  });

  it("is stable across a day — two instants of the same UTC day agree", () => {
    const a = visibilityWindows(new Date("2026-08-04T00:00:01Z"));
    const b = visibilityWindows(new Date("2026-08-04T23:59:59Z"));
    expect(a.current.start.toISOString()).toBe(b.current.start.toISOString());
    expect(a.current.end.toISOString()).toBe(b.current.end.toISOString());
  });

  it("holds across a month edge, in UTC and not the server's zone", () => {
    // 00:30 UTC on the 1st is still the previous day in every zone west of
    // Greenwich; snapping locally would date this run to February.
    const { current, previous } = visibilityWindows(new Date("2026-03-01T00:30:00Z"));
    expect(current.end.toISOString()).toBe("2026-03-02T00:00:00.000Z");
    expect(current.start.toISOString()).toBe("2026-02-02T00:00:00.000Z");
    expect(previous.start.toISOString()).toBe("2026-01-05T00:00:00.000Z");
    expect(previous.end.toISOString()).toBe("2026-02-02T00:00:00.000Z");
  });

  it("holds across a leap-day February", () => {
    const { current, previous } = visibilityWindows(new Date("2028-03-01T12:00:00Z"));
    expect(current.end.toISOString()).toBe("2028-03-02T00:00:00.000Z");
    // 2028 is a leap year: 28 days back from 2028-03-02 crosses Feb 29.
    expect(current.start.toISOString()).toBe("2028-02-03T00:00:00.000Z");
    expect(previous.start.toISOString()).toBe("2028-01-06T00:00:00.000Z");
  });

  it("windows are contiguous and half-open — previous.end === current.start", () => {
    const { current, previous } = visibilityWindows(new Date("2026-08-04T10:00:00Z"));
    expect(previous.end.getTime()).toBe(current.start.getTime());
    const span = VISIBILITY_WINDOW_DAYS * 86_400_000;
    expect(current.end.getTime() - current.start.getTime()).toBe(span);
    expect(previous.end.getTime() - previous.start.getTime()).toBe(span);
  });
});

describe("visibilityWindowSeries", () => {
  it("returns `count` contiguous windows, oldest first, ending on the current one", () => {
    const now = new Date("2026-08-04T10:00:00Z");
    const series = visibilityWindowSeries(now, 4);
    expect(series).toHaveLength(4);
    expect(series[3]!.start.toISOString()).toBe(
      visibilityWindows(now).current.start.toISOString(),
    );
    for (let i = 1; i < series.length; i++) {
      expect(series[i]!.start.getTime()).toBe(series[i - 1]!.end.getTime());
    }
  });

  it("indexes an instant into its bucket, and -1 outside the series", () => {
    const series = visibilityWindowSeries(new Date("2026-08-04T10:00:00Z"), 3);
    expect(windowIndexOf(series, new Date("2026-08-04T09:00:00Z"))).toBe(2);
    expect(windowIndexOf(series, series[0]!.start)).toBe(0);
    // The end edge belongs to the NEXT window, never to this one.
    expect(windowIndexOf(series, series[0]!.end)).toBe(1);
    expect(windowIndexOf(series, new Date("2020-01-01T00:00:00Z"))).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

describe("subjectMetrics", () => {
  it("has no rows to speak from → every metric empty", () => {
    expect(subjectMetrics([])).toEqual(EMPTY_SUBJECT_METRICS);
  });

  it("divides mentions by ORGANIC answers only", () => {
    const m = subjectMetrics([
      answer({ mentioned: true }),
      answer({ mentioned: false }),
      // Named by the prompt: excluded from both sides, not counted as a win.
      answer({ mentioned: true, promptNamed: true }),
    ]);
    expect(m.answers).toBe(2);
    expect(m.mentions).toBe(1);
    expect(m.mentionRate).toBe(0.5);
  });

  it("scores 0, not 100%, for a subject every prompt named", () => {
    const m = subjectMetrics([
      answer({ mentioned: true, promptNamed: true }),
      answer({ mentioned: true, promptNamed: true }),
    ]);
    expect(m).toEqual(EMPTY_SUBJECT_METRICS);
  });

  it("averages rank, cited and sentiment over the MENTIONED answers only", () => {
    const m = subjectMetrics([
      answer({ mentioned: true, rank: 1, cited: true, sentiment: 80 }),
      answer({ mentioned: true, rank: 3, cited: false, sentiment: 60 }),
      answer({ mentioned: false, rank: null, cited: null, sentiment: null }),
      answer({ mentioned: false }),
    ]);
    expect(m.answers).toBe(4);
    expect(m.mentions).toBe(2);
    expect(m.mentionRate).toBe(0.5);
    expect(m.avgRank).toBe(2);
    expect(m.citedRate).toBe(0.5);
    expect(m.avgSentiment).toBe(70);
  });

  it("leaves a conditional metric null when no mentioned answer carried it", () => {
    const m = subjectMetrics([answer({ mentioned: true, rank: null, cited: null })]);
    expect(m.mentionRate).toBe(1);
    expect(m.avgRank).toBeNull();
    expect(m.citedRate).toBeNull();
    expect(m.avgSentiment).toBeNull();
  });

  it("counts DISTINCT runs and engines, not rows", () => {
    const m = subjectMetrics([
      answer({ runId: "r1", engine: "gemini" }),
      answer({ runId: "r1", engine: "perplexity" }),
      answer({ runId: "r2", engine: "gemini" }),
    ]);
    expect(m.nRuns).toBe(2);
    expect(m.engines).toEqual(["gemini", "perplexity"]);
  });

  it("does not count a run that only ever named the subject in the prompt", () => {
    const m = subjectMetrics([
      answer({ runId: "r1", promptNamed: true }),
      answer({ runId: "r2", mentioned: true }),
    ]);
    expect(m.nRuns).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Share of Model
// ---------------------------------------------------------------------------

describe("shareOfModel", () => {
  const subjects = [
    { id: "self", name: "Us", isSelf: true },
    { id: "a", name: "Acme", isSelf: false },
    { id: "b", name: "Beta", isSelf: false },
  ];

  it("ranks by mention rate and reports #n of tracked", () => {
    const rows = [
      answer({ competitorId: "self", mentioned: true }),
      answer({ competitorId: "self", mentioned: false }),
      answer({ competitorId: "a", mentioned: true }),
      answer({ competitorId: "a", mentioned: true }),
      answer({ competitorId: "b", mentioned: false }),
      answer({ competitorId: "b", mentioned: false }),
    ];
    const out = shareOfModel(rows, subjects);
    expect(out.tracked).toBe(3);
    expect(out.subjects.map((s) => s.id)).toEqual(["a", "self", "b"]);
    expect(out.subjects.map((s) => s.position)).toEqual([1, 2, 3]);
    expect(out.subjects[1]!.metrics.mentionRate).toBe(0.5);
  });

  it("gives a subject with no rows a row and a position", () => {
    const out = shareOfModel([answer({ competitorId: "a", mentioned: true })], subjects);
    expect(out.subjects).toHaveLength(3);
    const self = out.subjects.find((s) => s.id === "self")!;
    expect(self.metrics).toEqual(EMPTY_SUBJECT_METRICS);
    expect(self.position).toBeGreaterThan(1);
  });

  it("breaks a mention-rate tie on the earlier average rank", () => {
    const rows = [
      answer({ competitorId: "a", mentioned: true, rank: 4 }),
      answer({ competitorId: "b", mentioned: true, rank: 1 }),
    ];
    const out = shareOfModel(rows, [
      { id: "a", name: "Acme", isSelf: false },
      { id: "b", name: "Beta", isSelf: false },
    ]);
    expect(out.subjects.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("is stable — identical subjects do not swap between two calls", () => {
    const rows = [
      answer({ competitorId: "b", mentioned: true }),
      answer({ competitorId: "a", mentioned: true }),
    ];
    const first = shareOfModel(rows, subjects).subjects.map((s) => s.id);
    const second = shareOfModel([...rows].reverse(), subjects).subjects.map((s) => s.id);
    expect(first).toEqual(second);
  });
});

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

describe("visibilityTrend", () => {
  it("signs each metric from previous to current", () => {
    const t = visibilityTrend(
      metrics({ answers: 10, mentionRate: 0.3, avgRank: 2, citedRate: 0.5, avgSentiment: 70 }),
      metrics({ answers: 10, mentionRate: 0.6, avgRank: 4, citedRate: 0.2, avgSentiment: 60 }),
    );
    expect(t.mentionRate).toBeCloseTo(-0.3, 10);
    // A lower rank number is a better position: -2 means "moved up two".
    expect(t.avgRank).toBe(-2);
    expect(t.citedRate).toBeCloseTo(0.3, 10);
    expect(t.avgSentiment).toBe(10);
  });

  it("yields null rather than a delta against an assumed zero", () => {
    const t = visibilityTrend(
      metrics({ answers: 10, mentionRate: 0.4, avgRank: 2 }),
      metrics({ answers: 0, mentionRate: 0, avgRank: null }),
    );
    expect(t.mentionRate).toBeNull();
    expect(t.avgRank).toBeNull();
    expect(t.citedRate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Shift
// ---------------------------------------------------------------------------

describe("detectVisibilityShift", () => {
  const wide = (over: Partial<SubjectMetrics>) =>
    metrics({ nRuns: VISIBILITY_MIN_RUNS, answers: 24, engines: ["gemini"], ...over });

  it("never fires below the run minimum, however violent the move", () => {
    const shift = detectVisibilityShift(
      wide({ nRuns: VISIBILITY_MIN_RUNS - 1, mentionRate: 0 }),
      wide({ mentionRate: 1 }),
    );
    expect(shift).toBeNull();
  });

  it("never fires when only the PREVIOUS window is thin", () => {
    const shift = detectVisibilityShift(
      wide({ mentionRate: 0 }),
      wide({ nRuns: 1, mentionRate: 1 }),
    );
    expect(shift).toBeNull();
  });

  it("never fires on a single run either side", () => {
    expect(detectVisibilityShift(wide({ nRuns: 1 }), wide({ nRuns: 1, mentionRate: 1 }))).toBeNull();
  });

  it("ignores a move under the mention-rate threshold", () => {
    // 14 points — one under the bar.
    expect(detectVisibilityShift(wide({ mentionRate: 0.44 }), wide({ mentionRate: 0.58 }))).toBeNull();
  });

  it("fires at exactly the mention-rate threshold", () => {
    const shift = detectVisibilityShift(wide({ mentionRate: 0.43 }), wide({ mentionRate: 0.58 }));
    expect(shift).not.toBeNull();
    expect(shift!.driver).toBe("mention_rate");
    expect(shift!.direction).toBe("down");
    expect(shift!.mentionPointsDelta).toBeCloseTo(-15, 6);
  });

  it("fires on rank alone when the mention rate held still", () => {
    const shift = detectVisibilityShift(
      wide({ mentionRate: 0.5, avgRank: 5 }),
      wide({ mentionRate: 0.5, avgRank: 2 }),
    );
    expect(shift!.driver).toBe("avg_rank");
    // Rank 2 → 5 is a LOSS of position, even though the number went up.
    expect(shift!.direction).toBe("down");
    expect(shift!.rankDelta).toBe(3);
  });

  it("reads a rank climb as an improvement", () => {
    const shift = detectVisibilityShift(
      wide({ mentionRate: 0.5, avgRank: 1 }),
      wide({ mentionRate: 0.5, avgRank: 4 }),
    );
    expect(shift!.direction).toBe("up");
  });

  it("cannot fire on rank when one side never had a rank", () => {
    expect(
      detectVisibilityShift(
        wide({ mentionRate: 0.5, avgRank: 1 }),
        wide({ mentionRate: 0.5, avgRank: null }),
      ),
    ).toBeNull();
  });

  it("prefers the mention rate as the driver when both moved", () => {
    const shift = detectVisibilityShift(
      wide({ mentionRate: 0.2, avgRank: 6 }),
      wide({ mentionRate: 0.6, avgRank: 2 }),
    );
    expect(shift!.driver).toBe("mention_rate");
  });
});

describe("visibilityHumanChange", () => {
  it("prints the locked wording", () => {
    const shift = detectVisibilityShift(
      metrics({
        nRuns: 12,
        answers: 12,
        mentionRate: 0.31,
        engines: ["gemini", "perplexity"],
      }),
      metrics({ nRuns: 12, answers: 12, mentionRate: 0.58, engines: ["gemini", "perplexity"] }),
    )!;
    expect(visibilityHumanChange(shift)).toBe(
      "AI visibility — mention rate 58% → 31% (Gemini+Perplexity, 12 answers)",
    );
  });

  it("prints ranks when rank is the driver, and singularises one answer", () => {
    const shift = detectVisibilityShift(
      metrics({ nRuns: 8, answers: 1, mentionRate: 0.5, avgRank: 4.5, engines: ["gemini"] }),
      metrics({ nRuns: 8, answers: 9, mentionRate: 0.5, avgRank: 1.5, engines: ["gemini"] }),
    )!;
    expect(visibilityHumanChange(shift)).toBe(
      "AI visibility — average rank 1.5 → 4.5 (Gemini, 1 answer)",
    );
  });

  it("names engines by their product names", () => {
    expect(visibilityEngineLabel(["gemini", "perplexity"])).toBe("Gemini+Perplexity");
    expect(visibilityEngineLabel(["google_aio"])).toBe("Google AI Overviews");
    // An engine we never labelled prints its own key rather than nothing.
    expect(visibilityEngineLabel(["mistral"])).toBe("mistral");
  });
});

// ---------------------------------------------------------------------------
// Extracts
// ---------------------------------------------------------------------------

describe("extractMentionSentence", () => {
  const ANSWER =
    "There are several options. Acme CRM is the best pick for small teams because it is cheap. Beta is heavier.";

  it("returns an EXACT substring of the answer", () => {
    const text = extractMentionSentence(ANSWER, "Acme CRM")!;
    expect(text).toBe("Acme CRM is the best pick for small teams because it is cheap.");
    expect(ANSWER.includes(text)).toBe(true);
  });

  it("stops at the sentence before and after, never bleeding into neighbours", () => {
    const text = extractMentionSentence(ANSWER, "Beta")!;
    expect(text).toBe("Beta is heavier.");
  });

  it("matches case-insensitively but returns the answer's own casing", () => {
    const text = extractMentionSentence(ANSWER, "acme crm")!;
    expect(text.startsWith("Acme CRM")).toBe(true);
  });

  it("treats a newline as a boundary and strips list chrome", () => {
    const listy = "Top tools:\n- Acme CRM — great for startups\n- Beta — enterprise";
    const text = extractMentionSentence(listy, "Acme CRM")!;
    expect(text).toBe("Acme CRM — great for startups");
    expect(listy.includes(text)).toBe(true);
  });

  it("returns null when the subject is absent", () => {
    expect(extractMentionSentence(ANSWER, "Gamma")).toBeNull();
  });

  it("returns null rather than truncating an over-long sentence", () => {
    const long = `Acme CRM ${"is very good ".repeat(40)}.`;
    expect(extractMentionSentence(long, "Acme CRM")).toBeNull();
  });

  it("refuses a name too short to bound", () => {
    expect(extractMentionSentence(ANSWER, "A")).toBeNull();
  });
});

describe("extractMentionSentences", () => {
  const stored = (over: Partial<StoredAnswer>): StoredAnswer => ({
    engine: "gemini",
    recordedAt: new Date("2026-08-01T00:00:00Z"),
    answerExcerpt: null,
    ...over,
  });

  it("takes the most recent first, capped, with engine and date", () => {
    const out = extractMentionSentences(
      [
        stored({
          recordedAt: new Date("2026-07-01T00:00:00Z"),
          answerExcerpt: "Acme is old news.",
        }),
        stored({
          recordedAt: new Date("2026-08-01T00:00:00Z"),
          engine: "perplexity",
          answerExcerpt: "Acme leads the pack.",
        }),
      ],
      "Acme",
      3,
    );
    expect(out.map((e) => e.text)).toEqual(["Acme leads the pack.", "Acme is old news."]);
    expect(out[0]!.engine).toBe("perplexity");
    expect(out[0]!.recordedAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("de-duplicates a phrasing the engine repeated all month", () => {
    const rows = [1, 2, 3, 4].map((d) =>
      stored({
        recordedAt: new Date(`2026-08-0${d}T00:00:00Z`),
        answerExcerpt: "Acme is a solid CRM.",
      }),
    );
    expect(extractMentionSentences(rows, "Acme")).toHaveLength(1);
  });

  it("caps at the requested maximum", () => {
    const rows = [1, 2, 3, 4].map((d) =>
      stored({
        recordedAt: new Date(`2026-08-0${d}T00:00:00Z`),
        answerExcerpt: `Acme scored ${d} this week.`,
      }),
    );
    expect(extractMentionSentences(rows, "Acme", 3)).toHaveLength(3);
  });

  it("yields NOTHING when the answers were never persisted", () => {
    // The whole sub-section rests on this: no stored answer, no extract, and the
    // caller renders no sub-section rather than inventing a description.
    const rows = [stored({ answerExcerpt: null }), stored({ answerExcerpt: null })];
    expect(extractMentionSentences(rows, "Acme")).toEqual([]);
  });
});
