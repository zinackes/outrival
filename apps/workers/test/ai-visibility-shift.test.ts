import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { VISIBILITY_MIN_RUNS } from "@outrival/shared";
import { makeTestDb, schema, type TestDb } from "./db-harness";

/**
 * `ai_visibility_shift` — Positioning Intelligence v2 P5.
 *
 * The phase 3 signal compared the last sweep to the one before it. An answer engine
 * asked the same buyer question twice does not answer it the same way, so most of
 * what fired was the engine, not the market. These tests hold the three rules that
 * replaced it: average over a window, require enough runs on BOTH sides, and one
 * signal per subject per four weeks.
 *
 * The self product is a subject like any other. A collapse in the reader's OWN
 * visibility is the most important thing this feature can report, and it must fire
 * on exactly the same evidence as a rival's.
 *
 * Nothing here imports a model.
 */

let testDb: TestDb;
let closeDb: () => Promise<void>;
let computeVisibilityShifts: typeof import("../src/lib/ai-visibility/shift").computeVisibilityShifts;
let subjectsInCooldown: typeof import("../src/lib/ai-visibility/shift").subjectsInCooldown;
let shiftRawDiff: typeof import("../src/lib/ai-visibility/shift").shiftRawDiff;

const DAY = 86_400_000;
const NOW = new Date("2026-08-04T12:00:00Z");
const daysBefore = (n: number) => new Date(NOW.getTime() - n * DAY);

beforeAll(async () => {
  const harness = await makeTestDb();
  testDb = harness.db;
  closeDb = harness.close;
  ({ computeVisibilityShifts, subjectsInCooldown, shiftRawDiff } = await import(
    "../src/lib/ai-visibility/shift"
  ));
});

afterAll(() => closeDb());

let seq = 0;
let orgId: string;
let productId: string;
let selfId: string;
let rivalId: string;

beforeEach(async () => {
  const n = ++seq;
  orgId = `org-${n}`;
  productId = `prd-${n}`;
  selfId = `self-${n}`;
  rivalId = `rival-${n}`;
  await testDb.insert(schema.organizations).values({ id: orgId, name: `Org ${n}`, slug: orgId });
  await testDb
    .insert(schema.competitors)
    .values({ id: selfId, orgId, name: "Our Product", type: "self" });
  await testDb.insert(schema.competitors).values({ id: rivalId, orgId, name: "Acme CRM" });
  await testDb
    .insert(schema.products)
    .values({ id: productId, orgId, name: "Main", selfCompetitorId: selfId, isPrimary: true });
});

/**
 * `runs` runs on consecutive days starting `startDaysBefore` back, each answering
 * one prompt. `mentioned` is how many of them named the subject — stated as a count
 * rather than a cadence so a fixture's rate is the number the assertion reads.
 */
async function seedRuns(opts: {
  competitorId: string;
  runs: number;
  startDaysBefore: number;
  mentioned: number;
  rank?: number;
  engine?: string;
  tag: string;
  promptNamed?: boolean;
}) {
  for (let i = 0; i < opts.runs; i++) {
    const mentioned = i < opts.mentioned;
    await testDb.insert(schema.aiVisibilityResults).values({
      orgId,
      productId,
      promptId: `prm-${seq}`,
      competitorId: opts.competitorId,
      engine: opts.engine ?? "gemini",
      mentioned: mentioned ? 1 : 0,
      promptNamed: opts.promptNamed ? 1 : 0,
      rank: mentioned ? (opts.rank ?? 2) : null,
      cited: mentioned ? 1 : null,
      sentimentScore: mentioned ? 70 : null,
      runId: `${opts.tag}-${i}`,
      recordedAt: daysBefore(opts.startDaysBefore + i),
    });
  }
}

const shiftsFor = (rosterIds: string[] = [selfId, rivalId]) =>
  computeVisibilityShifts({ orgId, productId, rosterIds, selfId, now: NOW });

describe("computeVisibilityShifts — the run minimum", () => {
  test("a move of 100 points on ONE run either side signals nothing", async () => {
    await seedRuns({ competitorId: rivalId, runs: 1, startDaysBefore: 1, mentioned: 1, tag: "c" });
    await seedRuns({
      competitorId: rivalId,
      runs: 1,
      startDaysBefore: 30,
      mentioned: 0, // never named
      tag: "p",
    });
    expect(await shiftsFor()).toEqual([]);
  });

  test("one run under the minimum, on EITHER side, still signals nothing", async () => {
    // Current window is fat, previous is one run short.
    await seedRuns({ competitorId: rivalId, runs: 12, startDaysBefore: 1, mentioned: 12, tag: "c" });
    await seedRuns({
      competitorId: rivalId,
      runs: VISIBILITY_MIN_RUNS - 1,
      startDaysBefore: 30,
      mentioned: 0,
      tag: "p",
    });
    expect(await shiftsFor()).toEqual([]);
  });

  test("no previous window at all → nothing (a first window is a baseline)", async () => {
    await seedRuns({ competitorId: rivalId, runs: 12, startDaysBefore: 1, mentioned: 12, tag: "c" });
    expect(await shiftsFor()).toEqual([]);
  });
});

describe("computeVisibilityShifts — thresholds", () => {
  test("a mention-rate collapse over the bar fires, medium by construction", async () => {
    // Previous: named in 8 of 8. Current: named in 2 of 8 → 100% → 25%.
    await seedRuns({ competitorId: rivalId, runs: 8, startDaysBefore: 30, mentioned: 8, tag: "p" });
    await seedRuns({ competitorId: rivalId, runs: 8, startDaysBefore: 1, mentioned: 2, tag: "c" });

    const shifts = await shiftsFor();
    expect(shifts).toHaveLength(1);
    expect(shifts[0]!.competitorId).toBe(rivalId);
    expect(shifts[0]!.isSelf).toBe(false);
    expect(shifts[0]!.shift.driver).toBe("mention_rate");
    expect(shifts[0]!.shift.direction).toBe("down");
    expect(shifts[0]!.shift.previous.mentionRate).toBe(1);
    expect(shifts[0]!.shift.current.mentionRate).toBe(0.25);
    expect(shifts[0]!.shift.current.nRuns).toBe(8);
  });

  test("a move under the bar fires nothing", async () => {
    // 8/8 → 7/8 is 12.5 points, under the 15-point bar. Rank holds at 2 on both
    // sides, so the second trigger cannot rescue it either.
    await seedRuns({ competitorId: rivalId, runs: 8, startDaysBefore: 30, mentioned: 8, tag: "p" });
    await seedRuns({ competitorId: rivalId, runs: 8, startDaysBefore: 1, mentioned: 7, tag: "c" });
    expect(await shiftsFor()).toEqual([]);
  });

  test("rank alone fires when the mention rate held still", async () => {
    await seedRuns({
      competitorId: rivalId,
      runs: 8,
      startDaysBefore: 30,
      mentioned: 8,
      rank: 1,
      tag: "p",
    });
    await seedRuns({
      competitorId: rivalId,
      runs: 8,
      startDaysBefore: 1,
      mentioned: 8,
      rank: 4,
      tag: "c",
    });
    const shifts = await shiftsFor();
    expect(shifts).toHaveLength(1);
    expect(shifts[0]!.shift.driver).toBe("avg_rank");
    // Position 1 → 4 is a LOSS, even though the number rose.
    expect(shifts[0]!.shift.direction).toBe("down");
  });

  test("prompt-named answers never make a rate", async () => {
    // Every answer is seeded (the prompt names them), so there is no organic
    // evidence at all and no window to compare.
    await seedRuns({
      competitorId: rivalId,
      runs: 12,
      startDaysBefore: 30,
      mentioned: 12,
      tag: "p",
      promptNamed: true,
    });
    await seedRuns({
      competitorId: rivalId,
      runs: 12,
      startDaysBefore: 1,
      mentioned: 0,
      tag: "c",
      promptNamed: true,
    });
    expect(await shiftsFor()).toEqual([]);
  });
});

describe("computeVisibilityShifts — the self is a subject", () => {
  test("YOUR OWN collapse fires, flagged isSelf", async () => {
    await seedRuns({ competitorId: selfId, runs: 10, startDaysBefore: 30, mentioned: 10, tag: "p" });
    await seedRuns({ competitorId: selfId, runs: 10, startDaysBefore: 1, mentioned: 2, tag: "c" });

    const shifts = await shiftsFor();
    expect(shifts).toHaveLength(1);
    expect(shifts[0]!.competitorId).toBe(selfId);
    expect(shifts[0]!.isSelf).toBe(true);
    expect(shifts[0]!.shift.direction).toBe("down");
  });

  test("the self and a rival can both move, and both are reported", async () => {
    await seedRuns({ competitorId: selfId, runs: 10, startDaysBefore: 30, mentioned: 10, tag: "ps" });
    await seedRuns({ competitorId: selfId, runs: 10, startDaysBefore: 1, mentioned: 2, tag: "cs" });
    await seedRuns({ competitorId: rivalId, runs: 10, startDaysBefore: 30, mentioned: 2, tag: "pr" });
    await seedRuns({ competitorId: rivalId, runs: 10, startDaysBefore: 1, mentioned: 10, tag: "cr" });

    const shifts = await shiftsFor();
    expect(shifts).toHaveLength(2);
    expect(shifts.find((s) => s.isSelf)!.shift.direction).toBe("down");
    expect(shifts.find((s) => !s.isSelf)!.shift.direction).toBe("up");
  });
});

describe("computeVisibilityShifts — engines", () => {
  test("one engine → no per-engine split (it would restate the headline)", async () => {
    await seedRuns({ competitorId: rivalId, runs: 8, startDaysBefore: 30, mentioned: 8, tag: "p" });
    await seedRuns({ competitorId: rivalId, runs: 8, startDaysBefore: 1, mentioned: 2, tag: "c" });
    const shifts = await shiftsFor();
    expect(shifts[0]!.byEngine).toEqual([]);
    expect(shifts[0]!.shift.current.engines).toEqual(["gemini"]);
  });

  test("two engines → both windows split per engine for the fact block", async () => {
    for (const engine of ["gemini", "perplexity"]) {
      await seedRuns({
        competitorId: rivalId,
        runs: 8,
        startDaysBefore: 30,
        mentioned: 8,
        engine,
        tag: `p-${engine}`,
      });
      // Perplexity keeps naming them; gemini stops.
      await seedRuns({
        competitorId: rivalId,
        runs: 8,
        startDaysBefore: 1,
        mentioned: engine === "gemini" ? 0 : 8,
        engine,
        tag: `c-${engine}`,
      });
    }
    const shifts = await shiftsFor();
    expect(shifts).toHaveLength(1);
    expect(shifts[0]!.shift.current.engines).toEqual(["gemini", "perplexity"]);
    const byEngine = shifts[0]!.byEngine;
    expect(byEngine.map((e) => e.engine)).toEqual(["gemini", "perplexity"]);
    expect(byEngine.find((e) => e.engine === "gemini")!.current.mentionRate).toBe(0);
    expect(byEngine.find((e) => e.engine === "perplexity")!.current.mentionRate).toBe(1);
  });
});

describe("subjectsInCooldown", () => {
  async function seedAnchorChange(competitorId: string, daysAgo: number) {
    const n = ++seq;
    await testDb
      .insert(schema.monitors)
      .values({ id: `mon-${n}`, competitorId, sourceType: "ai_visibility", isActive: false });
    await testDb
      .insert(schema.snapshots)
      .values({ id: `snap-${n}`, monitorId: `mon-${n}`, r2Key: `k-${n}`, contentHash: `h-${n}` });
    await testDb.insert(schema.changes).values({
      id: `chg-${n}`,
      monitorId: `mon-${n}`,
      snapshotAfterId: `snap-${n}`,
      diffText: "AI visibility — mention rate 58% → 31%",
      diffType: "text",
      detectedAt: daysBefore(daysAgo),
    });
  }

  test("a subject that signalled 10 days ago is still cooling", async () => {
    await seedAnchorChange(rivalId, 10);
    const cooling = await subjectsInCooldown([selfId, rivalId], NOW);
    expect(cooling.has(rivalId)).toBe(true);
    expect(cooling.has(selfId)).toBe(false);
  });

  test("a subject that signalled 29 days ago may signal again", async () => {
    await seedAnchorChange(rivalId, 29);
    const cooling = await subjectsInCooldown([rivalId], NOW);
    expect(cooling.has(rivalId)).toBe(false);
  });

  test("a change on ANOTHER source never cools an ai_visibility shift", async () => {
    const n = ++seq;
    await testDb
      .insert(schema.monitors)
      .values({ id: `mon-${n}`, competitorId: rivalId, sourceType: "homepage" });
    await testDb
      .insert(schema.snapshots)
      .values({ id: `snap-${n}`, monitorId: `mon-${n}`, r2Key: `k-${n}`, contentHash: `h-${n}` });
    await testDb.insert(schema.changes).values({
      id: `chg-${n}`,
      monitorId: `mon-${n}`,
      snapshotAfterId: `snap-${n}`,
      diffText: "They rewrote the hero",
      diffType: "text",
      detectedAt: daysBefore(1),
    });
    const cooling = await subjectsInCooldown([rivalId], NOW);
    expect(cooling.has(rivalId)).toBe(false);
  });
});

describe("shiftRawDiff — what the fact block reads", () => {
  test("carries BOTH windows, their run counts and the engines", async () => {
    await seedRuns({ competitorId: rivalId, runs: 8, startDaysBefore: 30, mentioned: 8, tag: "p" });
    await seedRuns({ competitorId: rivalId, runs: 8, startDaysBefore: 1, mentioned: 2, tag: "c" });
    const raw = shiftRawDiff((await shiftsFor())[0]!) as {
      kind: string;
      driver: string;
      isSelf: boolean;
      current: { mentionRate: number; nRuns: number; answers: number; engines: string[] };
      previous: { mentionRate: number; nRuns: number };
    };
    expect(raw.kind).toBe("ai_visibility_shift");
    expect(raw.driver).toBe("mention_rate");
    expect(raw.isSelf).toBe(false);
    expect(raw.current.mentionRate).toBe(0.25);
    expect(raw.current.nRuns).toBe(8);
    expect(raw.current.answers).toBe(8);
    expect(raw.current.engines).toEqual(["gemini"]);
    expect(raw.previous.mentionRate).toBe(1);
    expect(raw.previous.nRuns).toBe(8);
  });
});
