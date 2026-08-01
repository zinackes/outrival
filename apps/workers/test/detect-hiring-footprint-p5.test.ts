import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { isoWeekStart, weeksBack } from "@outrival/scrapers/jobs-hiring";
import { makeTestDb, schema, type TestDb } from "./db-harness";

// Hiring Intelligence v2 P5 — `remote_policy_changed` and `leadership_hire`, end to
// end against a real (in-process) Postgres.
//
// The arithmetic is owned by packages/shared/src/hiring-momentum.test.ts. What is
// worth asserting HERE is every guard, because each one only ever shows itself as a
// signal that did NOT fire: a single loud week, a competitor still in cooldown, a
// board we have only captured once, and a board that changed ATS under us.
//
// mock.module is PROCESS-GLOBAL in Bun. This file re-points @outrival/db at its own
// PGlite in beforeAll, exactly as detect-salary-shifts.test.ts does; files run in
// sequence, so each installs its own before its tests.

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

/** Four ISO weeks ending on the current one: two of one posture, two of the other. */
const WEEKS = weeksBack(isoWeekStart(new Date()), 4);
const week = (i: number) => new Date(`${WEEKS[i] as string}T00:00:00.000Z`);
const DAY = 86_400_000;

beforeAll(async () => {
  const realQueue = await import("@outrival/queue");
  const realShared = await import("@outrival/shared");
  const harness = await makeTestDb();
  testDb = harness.db;
  closeDb = harness.close;

  mock.module("@outrival/db", () => ({ ...schema, db: harness.db }));
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
  // The anchor writes its body to R2 before the DB row; there is no bucket here.
  mock.module("@outrival/shared", () => ({ ...realShared, uploadToR2: async () => {} }));

  ({ runDetectHiringFootprint: runDetect } = await import("../src/core/detect-hiring-footprint"));
});

afterAll(() => closeDb());
beforeEach(() => {
  enqueued = [];
});

let seq = 0;
async function seedCompetitor(): Promise<string> {
  const n = ++seq;
  const orgId = `org-p5-${n}`;
  const competitorId = `cmp-p5-${n}`;
  await testDb
    .insert(schema.organizations)
    .values({ id: orgId, name: `Org ${n}`, slug: `org-p5-${n}` });
  await testDb.insert(schema.competitors).values({
    id: competitorId,
    orgId,
    name: `Competitor ${n}`,
    type: "competitor",
    url: "https://acme.test",
  });
  return competitorId;
}

async function seedPostings(
  competitorId: string,
  rows: Array<{
    title?: string;
    remoteMode?: string;
    detectedAt: Date;
    closedAt?: Date | null;
    seniority?: string;
  }>,
) {
  await testDb.insert(schema.jobPostings).values(
    rows.map((r, i) => ({
      competitorId,
      title: r.title ?? `Backend Engineer ${i}`,
      department: "Engineering",
      isActive: r.closedAt == null,
      remoteMode: r.remoteMode ?? null,
      seniority: r.seniority ?? null,
      detectedAt: r.detectedAt,
      closedAt: r.closedAt ?? null,
    })),
  );
}

/** Captures of the jobs board, which is what says whether a role is new or just seen. */
async function seedJobsCaptures(competitorId: string, captures: Array<{ at: Date; host: string }>) {
  const [monitor] = await testDb
    .insert(schema.monitors)
    .values({ competitorId, sourceType: "jobs", frequency: "weekly", isActive: true, config: {} })
    .returning();
  await testDb.insert(schema.snapshots).values(
    captures.map((c, i) => ({
      monitorId: monitor!.id,
      r2Key: `snapshots/${competitorId}/jobs/${i}`,
      contentHash: `hash-${competitorId}-${i}`,
      status: "success" as const,
      scrapedAt: c.at,
      resolvedUrl: `https://${c.host}/jobs`,
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
        eq(schema.monitors.sourceType, "hiring_footprint"),
      ),
    );
}

/**
 * A board that was remote-first for two weeks and office-first for the two after,
 * the second of which is the current week. Reconstructed from `detected_at` /
 * `closed_at` exactly as the detector does it, so nothing is stored up front.
 */
async function seedRemoteFlip(competitorId: string) {
  await seedPostings(competitorId, [
    // Open through weeks 0 and 1, closed on the Monday of week 2.
    ...Array.from({ length: 10 }, (_, i) => ({
      title: `Remote Engineer ${i}`,
      remoteMode: "remote",
      detectedAt: new Date(week(0).getTime() - 30 * DAY),
      closedAt: week(2),
    })),
    // Opened on that same Monday, still open: weeks 2 and 3 are office-first.
    ...Array.from({ length: 10 }, (_, i) => ({
      title: `Onsite Engineer ${i}`,
      remoteMode: "onsite",
      detectedAt: week(2),
    })),
  ]);
}

describe("remote_policy_changed", () => {
  test("a posture that held two weeks against one that held two emits a medium signal", async () => {
    const id = await seedCompetitor();
    await seedRemoteFlip(id);

    const res = await runDetect({ competitorId: id });
    expect(res.emitted).toEqual(["remote"]);

    expect(enqueued).toHaveLength(1);
    const c = enqueued[0]!.classification;
    expect(c.category).toBe("hiring");
    // A posture read off a board is an aggregate: never the channel that bypasses
    // moderation and mails someone within minutes.
    expect(c.severity).toBe("medium");
    expect(c.humanChangeBefore).toBe("Remote-first, 100% remote");
    expect(c.humanChangeAfter).toBe("Office-first, 0% remote (n=10)");

    const rows = await anchorChanges(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rawDiff).toMatchObject({
      kind: "remote_policy_changed",
      from: "remote_first",
      to: "office_first",
      n: 10,
    });
  });

  test("a second run inside the cooldown does not re-announce the same move", async () => {
    const id = await seedCompetitor();
    await seedRemoteFlip(id);

    await runDetect({ competitorId: id });
    enqueued = [];

    const again = await runDetect({ competitorId: id });
    expect(again.emitted).toEqual([]);
    expect(enqueued).toHaveLength(0);
    expect(await anchorChanges(id)).toHaveLength(1);
  });

  test("one loud week is arithmetic, not a policy", async () => {
    const id = await seedCompetitor();
    await seedPostings(id, [
      // Office-first for three weeks...
      ...Array.from({ length: 10 }, (_, i) => ({
        title: `Onsite Engineer ${i}`,
        remoteMode: "onsite",
        detectedAt: new Date(week(0).getTime() - 30 * DAY),
        closedAt: week(3),
      })),
      // ...and a single remote week, the current one.
      ...Array.from({ length: 10 }, (_, i) => ({
        title: `Remote Engineer ${i}`,
        remoteMode: "remote",
        detectedAt: week(3),
      })),
    ]);

    const res = await runDetect({ competitorId: id });
    expect(res.emitted).toEqual([]);
    expect(await anchorChanges(id)).toHaveLength(0);
  });

  test("a board too small to be in a state says nothing", async () => {
    const id = await seedCompetitor();
    await seedPostings(id, [
      ...Array.from({ length: 4 }, (_, i) => ({
        title: `Remote Engineer ${i}`,
        remoteMode: "remote",
        detectedAt: new Date(week(0).getTime() - 30 * DAY),
        closedAt: week(2),
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        title: `Onsite Engineer ${i}`,
        remoteMode: "onsite",
        detectedAt: week(2),
      })),
    ]);

    const res = await runDetect({ competitorId: id });
    expect(res.emitted).toEqual([]);
  });
});

describe("leadership_hire", () => {
  const tenDaysAgo = () => new Date(Date.now() - 10 * DAY);
  const oneDayAgo = () => new Date(Date.now() - DAY);
  const twelveHoursAgo = () => new Date(Date.now() - DAY / 2);

  test("never on the first capture of a board", async () => {
    const id = await seedCompetitor();
    await seedJobsCaptures(id, [{ at: tenDaysAgo(), host: "boards.acme.test" }]);
    await seedPostings(id, [
      { title: "Chief Revenue Officer", detectedAt: new Date(tenDaysAgo().getTime() + 1000) },
      { title: "VP of Sales", detectedAt: new Date(tenDaysAgo().getTime() + 1000) },
    ]);

    const res = await runDetect({ competitorId: id });
    expect(res.emitted).toEqual([]);
    expect(enqueued).toHaveLength(0);
  });

  test("groups the roles into one signal, high when one of them is C-level", async () => {
    const id = await seedCompetitor();
    await seedJobsCaptures(id, [
      { at: tenDaysAgo(), host: "boards.acme.test" },
      { at: oneDayAgo(), host: "boards.acme.test" },
    ]);
    await seedPostings(id, [
      // Ingested with the first capture: seen, not new.
      { title: "Head of Support", detectedAt: new Date(tenDaysAgo().getTime() + 1000) },
      // Genuinely new since the previous capture.
      { title: "Chief Revenue Officer", detectedAt: twelveHoursAgo() },
      { title: "VP of Sales", detectedAt: twelveHoursAgo() },
      { title: "Director of Engineering", detectedAt: twelveHoursAgo() },
      { title: "Senior Backend Engineer", detectedAt: twelveHoursAgo() },
    ]);

    const res = await runDetect({ competitorId: id });
    expect(res.emitted).toEqual(["leadership"]);
    expect(enqueued).toHaveLength(1);

    const c = enqueued[0]!.classification;
    expect(c.category).toBe("leadership");
    expect(c.severity).toBe("high");
    // Director and the IC role are not the org chart, and the already-seen Head of
    // Support is not news.
    expect(c.humanChangeAfter).toBe("Chief Revenue Officer, VP of Sales");

    const rows = await anchorChanges(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rawDiff).toMatchObject({ kind: "leadership_hire" });
  });

  test("a VP with no C-level beside it is one band down", async () => {
    const id = await seedCompetitor();
    await seedJobsCaptures(id, [
      { at: tenDaysAgo(), host: "boards.acme.test" },
      { at: oneDayAgo(), host: "boards.acme.test" },
    ]);
    await seedPostings(id, [{ title: "VP of Marketing", detectedAt: twelveHoursAgo() }]);

    await runDetect({ competitorId: id });
    expect(enqueued[0]!.classification.severity).toBe("medium");
  });

  test("an ATS migration re-keys the whole board and announces nothing", async () => {
    const id = await seedCompetitor();
    await seedJobsCaptures(id, [
      { at: new Date(Date.now() - 20 * DAY), host: "old.acme.test" },
      // The migration: every posting is inserted again under the new board.
      { at: tenDaysAgo(), host: "jobs.acme.test" },
      { at: oneDayAgo(), host: "jobs.acme.test" },
    ]);
    await seedPostings(id, [
      { title: "Chief Revenue Officer", detectedAt: new Date(tenDaysAgo().getTime() + 1000) },
      { title: "VP of Sales", detectedAt: new Date(tenDaysAgo().getTime() + 1000) },
    ]);

    const res = await runDetect({ competitorId: id });
    expect(res.emitted).toEqual([]);
    expect(enqueued).toHaveLength(0);
  });
});
