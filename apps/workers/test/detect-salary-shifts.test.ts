import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { isoWeekStart, weeksBack } from "@outrival/scrapers/jobs-hiring";
import { makeTestDb, schema, type TestDb } from "./db-harness";
import { clearSharedOverrides, setSharedOverrides } from "./shared-mock";

// Hiring Intelligence v2 P3 — the two salary signals, end to end against a real
// (in-process) Postgres: the same migrations, the same enum, the same unique
// indexes as production.
//
// What is worth asserting here is not the arithmetic (salary.test.ts owns that) but
// the GUARDS, because each one only shows itself as a signal that did NOT fire:
// a thin band, a competitor in cooldown, a board with no history behind it, and a
// disclosure that has already been announced once.
//
// mock.module is PROCESS-GLOBAL in Bun. This file re-points @outrival/db at its own
// PGlite in beforeAll, exactly as backfill-pricing-history.test.ts does; files run
// in sequence, so each installs its own before its tests.

let testDb: TestDb;
let closeDb: () => Promise<void>;
let runDetect: (payload: { competitorId: string }) => Promise<{
  emitted?: string[];
  skipped?: boolean;
  reason?: string;
}>;

interface Enqueued {
  changeId: string;
  classification: {
    category: string;
    severity: string;
    reason: string;
    humanChangeBefore: string;
    humanChangeAfter: string;
  };
}
let enqueued: Enqueued[] = [];

const WEEKS = weeksBack(isoWeekStart(new Date()), 5);
const CURRENT_WEEK = WEEKS[4] as string;

beforeAll(async () => {
  const realQueue = await import("@outrival/queue");
  const harness = await makeTestDb();
  testDb = harness.db;
  closeDb = harness.close;

  mock.module("@outrival/queue", () => ({
    ...realQueue,
    NonRetriable: realQueue.NonRetriable,
    generateSignal: {
      queue: "generate-signal",
      enqueue: async (payload: Enqueued) => {
        enqueued.push(payload);
        return "job-id";
      },
    },
  }));

  ({ runDetectSalaryShifts: runDetect } = await import("../src/core/detect-salary-shifts"));
});

afterAll(() => {
  clearSharedOverrides();
  return closeDb();
});
beforeEach(() => {
  enqueued = [];
  // The anchor writes its body to R2 before the DB row; there is no bucket here.
  setSharedOverrides({ uploadToR2: async () => {} });
});

let seq = 0;
async function seedCompetitor(type: "competitor" | "self" = "competitor"): Promise<string> {
  const n = ++seq;
  const orgId = `org-${n}`;
  const competitorId = `cmp-${n}`;
  await testDb.insert(schema.organizations).values({ id: orgId, name: `Org ${n}`, slug: `org-${n}` });
  await testDb
    .insert(schema.competitors)
    .values({ id: competitorId, orgId, name: `Competitor ${n}`, type, url: "https://acme.test" });
  return competitorId;
}

/** One weekly band row per (bucket, currency, week). */
async function seedBands(
  competitorId: string,
  rows: Array<{ week: string; p50: number; n: number; currency?: string; bucket?: string }>,
) {
  await testDb.insert(schema.hiringSalaryBands).values(
    rows.map((r) => ({
      competitorId,
      departmentBucket: r.bucket ?? "engineering",
      currency: r.currency ?? "EUR",
      p25: Math.round(r.p50 * 0.9),
      p50: r.p50,
      p75: Math.round(r.p50 * 1.1),
      n: r.n,
      weekStart: r.week,
      recordedAt: new Date(),
    })),
  );
}

async function seedPostings(
  competitorId: string,
  count: number,
  opts: { withSalary: number; currency?: string; department?: string },
) {
  const rows = Array.from({ length: count }, (_, i) => ({
    competitorId,
    title: `Backend Engineer ${i}`,
    department: opts.department ?? "Engineering",
    isActive: true,
    detectedAt: new Date(Date.now() - 60 * 86_400_000),
    ...(i < opts.withSalary
      ? {
          salaryMin: 60_000,
          salaryMax: 80_000,
          salaryCurrency: opts.currency ?? "EUR",
          salaryPeriod: "yearly",
        }
      : {}),
  }));
  await testDb.insert(schema.jobPostings).values(rows);
}

/** Weeks of board history, which is what makes "they STARTED publishing" a claim. */
async function seedBoardHistory(competitorId: string, weeks: number, openCount = 8) {
  await testDb.insert(schema.hiringMetrics).values(
    weeksBack(CURRENT_WEEK, weeks).map((week) => ({
      competitorId,
      departmentBucket: "engineering",
      openCount,
      weekStart: week,
      recordedAt: new Date(),
    })),
  );
}

async function anchorChanges(competitorId: string) {
  return testDb
    .select({ rawDiff: schema.changes.rawDiff, diffText: schema.changes.diffText })
    .from(schema.changes)
    .innerJoin(schema.monitors, eq(schema.monitors.id, schema.changes.monitorId))
    .where(
      and(
        eq(schema.monitors.competitorId, competitorId),
        eq(schema.monitors.sourceType, "hiring_salary"),
      ),
    );
}

describe("salary_band_shift", () => {
  test("a p50 past the threshold emits one grounded medium signal", async () => {
    const id = await seedCompetitor();
    await seedBands(id, [
      { week: WEEKS[0] as string, p50: 68_000, n: 6 },
      { week: WEEKS[1] as string, p50: 68_000, n: 6 },
      { week: WEEKS[2] as string, p50: 68_000, n: 6 },
      { week: WEEKS[3] as string, p50: 68_000, n: 6 },
      { week: CURRENT_WEEK, p50: 79_000, n: 6 },
    ]);
    await seedPostings(id, 6, { withSalary: 6 });

    const res = await runDetect({ competitorId: id });
    expect(res.emitted).toEqual(["band:engineering:EUR"]);

    expect(enqueued).toHaveLength(1);
    const c = enqueued[0]!.classification;
    expect(c.category).toBe("hiring");
    // A pay band is an aggregate read off a page: never the channel that bypasses
    // moderation and mails someone within minutes.
    expect(c.severity).toBe("medium");
    expect(c.humanChangeBefore).toBe("Engineering (EUR) — p50 68,000 EUR");
    expect(c.humanChangeAfter).toBe("Engineering (EUR) — p50 79,000 EUR (n=6)");

    const rows = await anchorChanges(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rawDiff).toMatchObject({
      kind: "salary_band_shift",
      bucket: "engineering",
      currency: "EUR",
      p50Before: 68_000,
      p50After: 79_000,
      n: 6,
    });
    // The insight is grounded on this text, so the currency has to be in it.
    expect(rows[0]!.diffText).toContain("EUR");
    expect(rows[0]!.diffText).toContain("nothing is converted between currencies");
  });

  test("a band under the posting floor cannot move the needle", async () => {
    const id = await seedCompetitor();
    await seedBands(id, [
      { week: WEEKS[1] as string, p50: 68_000, n: 6 },
      { week: WEEKS[2] as string, p50: 68_000, n: 6 },
      { week: WEEKS[3] as string, p50: 68_000, n: 6 },
      { week: CURRENT_WEEK, p50: 95_000, n: 2 },
    ]);

    expect((await runDetect({ competitorId: id })).emitted).toEqual([]);
    expect(enqueued).toHaveLength(0);
  });

  test("a band already signalled inside the cooldown stays quiet", async () => {
    const id = await seedCompetitor();
    await seedBands(id, [
      { week: WEEKS[1] as string, p50: 68_000, n: 6 },
      { week: WEEKS[2] as string, p50: 68_000, n: 6 },
      { week: WEEKS[3] as string, p50: 68_000, n: 6 },
      { week: CURRENT_WEEK, p50: 84_000, n: 6 },
    ]);
    // A prior firing of the SAME (bucket, currency), a few days ago.
    const [monitor] = await testDb
      .insert(schema.monitors)
      .values({ competitorId: id, sourceType: "hiring_salary", isActive: false, config: {} })
      .returning();
    const [snap] = await testDb
      .insert(schema.snapshots)
      .values({
        monitorId: monitor!.id,
        r2Key: "k",
        contentHash: "prior",
        status: "success",
        scrapedAt: new Date(),
      })
      .returning();
    await testDb.insert(schema.changes).values({
      monitorId: monitor!.id,
      snapshotAfterId: snap!.id,
      diffText: "prior",
      diffType: "text",
      rawDiff: { kind: "salary_band_shift", bucket: "engineering", currency: "EUR" },
      detectedAt: new Date(Date.now() - 3 * 86_400_000),
    });

    expect((await runDetect({ competitorId: id })).emitted).toEqual([]);
    expect(enqueued).toHaveLength(0);
  });

  test("what our own product pays is not intelligence", async () => {
    const id = await seedCompetitor("self");
    await seedBands(id, [
      { week: WEEKS[1] as string, p50: 68_000, n: 6 },
      { week: WEEKS[2] as string, p50: 68_000, n: 6 },
      { week: WEEKS[3] as string, p50: 68_000, n: 6 },
      { week: CURRENT_WEEK, p50: 90_000, n: 6 },
    ]);

    expect(await runDetect({ competitorId: id })).toMatchObject({ skipped: true, reason: "self" });
    expect(enqueued).toHaveLength(0);
  });
});

describe("salary_disclosure_started", () => {
  test("a board that published nothing and now does emits once", async () => {
    const id = await seedCompetitor();
    await seedPostings(id, 21, { withSalary: 8 });
    await seedBoardHistory(id, 6);

    const res = await runDetect({ competitorId: id });
    expect(res.emitted).toEqual(["disclosure"]);

    const c = enqueued[0]!.classification;
    // 8 of 21 is 38% — a start, not yet a policy across the board.
    expect(c.severity).toBe("low");
    expect(c.humanChangeBefore).toBe("No salaries published");
    expect(c.humanChangeAfter).toBe("Now publishing salaries — 8 of 21 open roles (EUR)");

    const rows = await anchorChanges(id);
    expect(rows[0]!.rawDiff).toMatchObject({
      kind: "salary_disclosure_started",
      disclosed: 8,
      total: 21,
      currency: "EUR",
    });

    // Announced once, for the competitor's lifetime.
    enqueued = [];
    expect((await runDetect({ competitorId: id })).emitted).toEqual([]);
    expect(enqueued).toHaveLength(0);
  });

  test("most of the board carrying pay reads as a policy, not a start", async () => {
    const id = await seedCompetitor();
    await seedPostings(id, 10, { withSalary: 7 });
    await seedBoardHistory(id, 6);

    await runDetect({ competitorId: id });
    expect(enqueued[0]!.classification.severity).toBe("medium");
  });

  test("without weeks of board behind it, 'started' is a claim about us", async () => {
    const id = await seedCompetitor();
    await seedPostings(id, 21, { withSalary: 8 });
    // Onboarded this week: two weeks of history, and one of them is empty.
    await seedBoardHistory(id, 2);

    expect((await runDetect({ competitorId: id })).emitted).toEqual([]);
    expect(enqueued).toHaveLength(0);
  });

  test("a board too thin to read is not evidence of a policy either", async () => {
    const id = await seedCompetitor();
    await seedPostings(id, 21, { withSalary: 8 });
    // Six weeks of history, but never more than four roles open at a time.
    await seedBoardHistory(id, 6, 4);

    expect((await runDetect({ competitorId: id })).emitted).toEqual([]);
  });

  test("a third of a board is the floor — two roles out of twenty is not", async () => {
    const id = await seedCompetitor();
    await seedPostings(id, 20, { withSalary: 2 });
    await seedBoardHistory(id, 6);

    expect((await runDetect({ competitorId: id })).emitted).toEqual([]);
  });
});
