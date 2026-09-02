import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";
import { makeTestDb, schema, type TestDb } from "./db-harness";

/**
 * `signal-batching` — patch-26 layer 5, and the selection rewrite from `code:PER-14`.
 *
 * The job used to pull EVERY unbatched signal on the platform into the worker and
 * group them in memory. It now aggregates the groups in SQL, oldest first, capped —
 * which means the rules that decide what gets batched moved from a JS loop into a
 * `GROUP BY … HAVING`, on a job that had no test at all. These lock them there:
 * the minimum, the severity floor, the window, the per-org opt-out and the cap.
 *
 * Nothing here calls a model: `generateBatchSummary` is the one stub.
 */

let testDb: TestDb;
let closeDb: () => Promise<void>;
let runSignalBatching: typeof import("../src/core/signal-batching").runSignalBatching;

const HOUR = 3600_000;
let seq = 0;

beforeAll(async () => {
  // Captured before the mock lands: mock.module is process-global and mutates the
  // live namespace, so a later import would hand back the stub itself.
  const realAi = await import("@outrival/ai");

  const harness = await makeTestDb();
  testDb = harness.db;
  closeDb = harness.close;

  mock.module("@outrival/ai", () => ({
    ...realAi,
    generateBatchSummary: async () => "stubbed summary",
  }));

  ({ runSignalBatching } = await import("../src/core/signal-batching"));
});

afterAll(() => closeDb());

let orgId: string;

beforeEach(async () => {
  orgId = `org-${++seq}`;
  await testDb.insert(schema.organizations).values({ id: orgId, name: orgId, slug: orgId });
  delete process.env.BATCHING_MAX_GROUPS;
});

/** A competitor and the monitor every signal of it will hang a change off. */
async function seedCompetitor(name: string, org = orgId) {
  const n = ++seq;
  const competitorId = `cmp-${n}`;
  await testDb.insert(schema.competitors).values({ id: competitorId, orgId: org, name });
  await testDb
    .insert(schema.monitors)
    .values({ id: `mon-${n}`, competitorId, sourceType: "homepage" });
  return { competitorId, monitorId: `mon-${n}` };
}

/** One snapshot + one change per signal: `signals_change_id_uq` is one signal per change. */
async function seedSignals(opts: {
  competitorId: string;
  monitorId: string;
  count: number;
  category?: "product" | "pricing";
  severity?: "low" | "medium" | "high" | "critical";
  hoursAgo?: number;
}) {
  const at = new Date(Date.now() - (opts.hoursAgo ?? 1) * HOUR);
  for (let i = 0; i < opts.count; i++) {
    const n = ++seq;
    await testDb.insert(schema.snapshots).values({
      id: `snp-${n}`,
      monitorId: opts.monitorId,
      r2Key: `k-${n}`,
      contentHash: `h-${n}`,
    });
    await testDb.insert(schema.changes).values({
      id: `chg-${n}`,
      monitorId: opts.monitorId,
      snapshotAfterId: `snp-${n}`,
      diffText: "diff",
      diffType: "text",
    });
    await testDb.insert(schema.signals).values({
      id: `sig-${n}`,
      orgId,
      competitorId: opts.competitorId,
      changeId: `chg-${n}`,
      category: opts.category ?? "product",
      severity: opts.severity ?? "low",
      insight: `insight ${n}`,
      createdAt: at,
    });
  }
}

const batchesOf = (org: string) =>
  testDb.query.signalBatches.findMany({ where: eq(schema.signalBatches.orgId, org) });

describe("signal-batching — what qualifies", () => {
  test("3 similar signals → one batch, and the signals point at it", async () => {
    const { competitorId, monitorId } = await seedCompetitor("Acme");
    await seedSignals({ competitorId, monitorId, count: 3 });

    const { batchesCreated } = await runSignalBatching();

    expect(batchesCreated).toBe(1);
    const [batch] = await batchesOf(orgId);
    expect(batch?.count).toBe(3);
    expect(batch?.summary).toBe("stubbed summary");
    const rows = await testDb.query.signals.findMany({
      where: eq(schema.signals.orgId, orgId),
    });
    expect(rows.every((r) => r.batchedIntoId === batch?.id)).toBe(true);
  });

  test("2 similar signals stay loose", async () => {
    const { competitorId, monitorId } = await seedCompetitor("Acme");
    await seedSignals({ competitorId, monitorId, count: 2 });

    expect((await runSignalBatching()).batchesCreated).toBe(0);
    expect(await batchesOf(orgId)).toHaveLength(0);
  });

  test("high and critical are never folded behind a chevron", async () => {
    const { competitorId, monitorId } = await seedCompetitor("Acme");
    await seedSignals({ competitorId, monitorId, count: 3, severity: "high" });
    await seedSignals({ competitorId, monitorId, count: 3, severity: "critical" });

    expect((await runSignalBatching()).batchesCreated).toBe(0);
  });

  test("signals older than the window are out of the group", async () => {
    const { competitorId, monitorId } = await seedCompetitor("Acme");
    await seedSignals({ competitorId, monitorId, count: 2 });
    await seedSignals({ competitorId, monitorId, count: 2, hoursAgo: 48 });

    expect((await runSignalBatching()).batchesCreated).toBe(0);
  });

  test("two categories of one competitor are two groups, not one", async () => {
    const { competitorId, monitorId } = await seedCompetitor("Acme");
    await seedSignals({ competitorId, monitorId, count: 2, category: "product" });
    await seedSignals({ competitorId, monitorId, count: 2, category: "pricing" });

    expect((await runSignalBatching()).batchesCreated).toBe(0);
  });

  test("an org that turned batching off is excluded", async () => {
    const { competitorId, monitorId } = await seedCompetitor("Acme");
    await seedSignals({ competitorId, monitorId, count: 3 });
    await testDb
      .insert(schema.orgNotificationPreferences)
      .values({ orgId, batchingEnabled: false });

    expect((await runSignalBatching()).batchesCreated).toBe(0);
  });
});

describe("signal-batching — the run is bounded", () => {
  test("the cap defers the newer group, and the next run picks it up", async () => {
    const older = await seedCompetitor("Older");
    const newer = await seedCompetitor("Newer");
    await seedSignals({ ...older, count: 3, hoursAgo: 10 });
    await seedSignals({ ...newer, count: 3, hoursAgo: 2 });

    process.env.BATCHING_MAX_GROUPS = "1";
    expect((await runSignalBatching()).batchesCreated).toBe(1);

    // Oldest first, so the cap is a deferral rather than starvation: the group that
    // waited longest is the one that went.
    const [first] = await batchesOf(orgId);
    expect(first?.competitorId).toBe(older.competitorId);

    expect((await runSignalBatching()).batchesCreated).toBe(1);
    const both = await batchesOf(orgId);
    expect(both.map((b) => b.competitorId).sort()).toEqual(
      [older.competitorId, newer.competitorId].sort(),
    );
  });
});
