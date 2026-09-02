import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { inArray } from "drizzle-orm";
import { makeTestDb, schema, type TestDb } from "./db-harness";
import { clearSharedOverrides, setSharedOverrides } from "./shared-mock";

/**
 * `purge-retention` — PLAN_LIMITS.historyRetentionDays, and the set-based rewrite
 * from `code:PER-44`.
 *
 * The job used to loop over every organization and fire ~15 statements per tenant
 * for a cutoff that only ever depends on the plan. It now runs one pass per plan
 * with the org set inlined — so the thing worth locking is that the collapse did
 * not lose the per-org distinction: two orgs on two tiers, purged in ONE run, must
 * still get two different windows.
 *
 * The two survival rules the FK chain rests on are pinned here too: the latest
 * snapshot of a monitor is the next scrape's diff baseline, and a change still
 * carrying a signal is what the "Why this insight?" panel reads.
 */

let testDb: TestDb;
let closeDb: () => Promise<void>;
let resetDb: () => Promise<void>;
let runPurgeRetention: typeof import("../src/core/purge-retention").runPurgeRetention;

const DAY = 24 * 3600_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
let seq = 0;

/** Keys handed to R2, captured instead of sent. */
let r2Purged: string[];

beforeAll(async () => {
  const harness = await makeTestDb();
  testDb = harness.db;
  closeDb = harness.close;
  resetDb = harness.reset;
  ({ runPurgeRetention } = await import("../src/core/purge-retention"));
});

// The job is platform-wide: it walks every organization in the database, and its
// return value counts them. So each test needs the table to hold only its own orgs.
beforeEach(async () => {
  await resetDb();
  r2Purged = [];
  setSharedOverrides({
    deleteManyFromR2: async (keys: string[]) => void r2Purged.push(...keys),
  });
});

afterAll(async () => {
  clearSharedOverrides();
  await closeDb();
});

/** An org on a plan, with one competitor and one monitor to hang history off. */
async function seedOrg(plan: "free" | "pro") {
  const n = ++seq;
  const orgId = `org-${n}`;
  await testDb
    .insert(schema.organizations)
    .values({ id: orgId, name: orgId, slug: orgId, plan });
  const competitorId = `cmp-${n}`;
  await testDb.insert(schema.competitors).values({ id: competitorId, orgId, name: `c-${n}` });
  const monitorId = `mon-${n}`;
  await testDb
    .insert(schema.monitors)
    .values({ id: monitorId, competitorId, sourceType: "homepage" });
  return { orgId, competitorId, monitorId };
}

/** A snapshot nothing points at, so age is the only thing deciding its fate. */
async function seedSnapshot(monitorId: string, age: number) {
  const n = ++seq;
  const r2Key = `snap/${n}.html`;
  await testDb.insert(schema.snapshots).values({
    id: `snp-${n}`,
    monitorId,
    r2Key,
    contentHash: `h-${n}`,
    scrapedAt: daysAgo(age),
  });
  return { snapshotId: `snp-${n}`, r2Key };
}

/** A change over its own snapshot, plus the signal behind it unless `signalAge` is null. */
async function seedChange(opts: {
  orgId: string;
  competitorId: string;
  monitorId: string;
  age: number;
  /** Signals age independently of the change: that is how a change gets pinned. */
  signalAge?: number | null;
}) {
  const n = ++seq;
  const { snapshotId } = await seedSnapshot(opts.monitorId, opts.age);
  await testDb.insert(schema.changes).values({
    id: `chg-${n}`,
    monitorId: opts.monitorId,
    snapshotAfterId: snapshotId,
    diffText: "diff",
    diffType: "text",
    detectedAt: daysAgo(opts.age),
  });
  if (opts.signalAge !== null) {
    await testDb.insert(schema.signals).values({
      id: `sig-${n}`,
      orgId: opts.orgId,
      competitorId: opts.competitorId,
      changeId: `chg-${n}`,
      category: "product",
      severity: "low",
      insight: `insight ${n}`,
      createdAt: daysAgo(opts.signalAge ?? opts.age),
    });
  }
  return { snapshotId, changeId: `chg-${n}`, signalId: `sig-${n}` };
}

const alive = async (table: "signals" | "changes" | "snapshots", ids: string[]) => {
  const rows = await testDb
    .select({ id: schema[table].id })
    .from(schema[table])
    .where(inArray(schema[table].id, ids));
  return rows.map((r) => r.id).sort();
};

describe("purge-retention — the window is the plan's, not the org's", () => {
  test("one run, two tiers: 30 days is past free's window and inside pro's", async () => {
    const free = await seedOrg("free");
    const pro = await seedOrg("pro");
    const expired = await seedChange({ ...free, age: 30 });
    const kept = await seedChange({ ...pro, age: 30 });

    await runPurgeRetention();

    expect(await alive("signals", [expired.signalId, kept.signalId])).toEqual([kept.signalId]);
    expect(await alive("changes", [expired.changeId, kept.changeId])).toEqual([kept.changeId]);
  });

  test("every org on a tier is counted, not just the one that had rows", async () => {
    await seedOrg("free");
    await seedOrg("free");
    await seedOrg("pro");

    const { purgedOrgs } = await runPurgeRetention();

    expect(purgedOrgs).toBe(3);
  });
});

describe("purge-retention — what survives its own age", () => {
  test("the latest snapshot of a monitor stays, and only the rest reach R2", async () => {
    const free = await seedOrg("free");
    // Bare snapshots: no change points at either, so nothing but age and the
    // baseline rule is in play.
    const older = await seedSnapshot(free.monitorId, 40);
    const latest = await seedSnapshot(free.monitorId, 30);

    await runPurgeRetention();

    expect(await alive("snapshots", [older.snapshotId, latest.snapshotId])).toEqual([
      latest.snapshotId,
    ]);
    expect(r2Purged).toEqual([older.r2Key]);
  });

  test("a change still carrying a signal outlives the cutoff", async () => {
    const free = await seedOrg("free");
    // Same age, one difference: this change's signal is recent, so the signal
    // survives and its NOT NULL FK holds the change up with it.
    const pinned = await seedChange({ ...free, age: 30, signalAge: 1 });
    const loose = await seedChange({ ...free, age: 30, signalAge: null });

    await runPurgeRetention();

    expect(await alive("changes", [pinned.changeId, loose.changeId])).toEqual([pinned.changeId]);
    expect(await alive("signals", [pinned.signalId])).toEqual([pinned.signalId]);
  });
});
