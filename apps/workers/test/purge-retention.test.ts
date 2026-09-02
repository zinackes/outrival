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

describe("purge-retention — everything else the tier window carries", () => {
  // Six tables the job clears alongside the signal chain. They are the reason the
  // job is irreversible: notifications and the analytics series are user-facing
  // history with no other copy, and the analytics ones are org-scoped through
  // `competitor_id`, not through an `org_id` of their own — get that join wrong and
  // a free org's purge takes a pro org's charts with it.
  test("notifications, the feed and the analytics series follow the org's plan", async () => {
    const free = await seedOrg("free");
    const pro = await seedOrg("pro");
    const at = daysAgo(30);

    for (const org of [free, pro]) {
      await testDb.insert(schema.notifications).values({
        id: `ntf-${org.orgId}`,
        orgId: org.orgId,
        type: "signal",
        title: "t",
        createdAt: at,
      });
      await testDb.insert(schema.signalFeed).values({
        orgId: org.orgId,
        competitorId: org.competitorId,
        category: "product",
        severity: "low",
        recordedAt: at,
      });
      await testDb.insert(schema.pricingHistory).values({
        competitorId: org.competitorId,
        planName: "Pro",
        price: 79,
        currency: "USD",
        billingPeriod: "monthly",
        recordedAt: at,
      });
      await testDb.insert(schema.jobCounts).values({
        competitorId: org.competitorId,
        department: "eng",
        count: 3,
        recordedAt: at,
      });
      await testDb.insert(schema.numericClaims).values({
        competitorId: org.competitorId,
        monitorId: org.monitorId,
        pattern: "user_count",
        unit: "users",
        context: "hero",
        value: 10_000,
        rawText: "10,000 users",
        // Not `recorded_at` like the other four — the job spells this one out, and
        // a rename that broke it would delete nothing and say nothing.
        observedAt: at,
      });
    }

    await runPurgeRetention();

    const orgsLeft = async (table: "notifications" | "signalFeed") =>
      (await testDb.select({ orgId: schema[table].orgId }).from(schema[table])).map((r) => r.orgId);
    const competitorsLeft = async (table: "pricingHistory" | "jobCounts" | "numericClaims") =>
      (await testDb.select({ id: schema[table].competitorId }).from(schema[table])).map((r) => r.id);

    expect(await orgsLeft("notifications")).toEqual([pro.orgId]);
    expect(await orgsLeft("signalFeed")).toEqual([pro.orgId]);
    expect(await competitorsLeft("pricingHistory")).toEqual([pro.competitorId]);
    expect(await competitorsLeft("jobCounts")).toEqual([pro.competitorId]);
    expect(await competitorsLeft("numericClaims")).toEqual([pro.competitorId]);
  });

  test("an alert goes with the signal it announced", async () => {
    const free = await seedOrg("free");
    const expired = await seedChange({ ...free, age: 30 });
    await testDb
      .insert(schema.alerts)
      .values({ id: "alr-1", signalId: expired.signalId, orgId: free.orgId, channel: "email" });

    await runPurgeRetention();

    // Delete order is the whole point here: alerts.signal_id is a NOT NULL FK, so
    // deleting signals first would abort the transaction instead of purging.
    expect(await testDb.select({ id: schema.alerts.id }).from(schema.alerts)).toEqual([]);
  });

  test("a batch still pointed at by a signal outlives its own window", async () => {
    const free = await seedOrg("free");
    const pro = await seedOrg("pro");
    for (const [org, id] of [
      [free, "bat-loose"],
      [pro, "bat-pinned"],
    ] as const) {
      await testDb.insert(schema.signalBatches).values({
        id,
        orgId: org.orgId,
        competitorId: org.competitorId,
        signalIds: [],
        category: "product",
        count: 1,
        highestSeverity: "low",
        windowStart: daysAgo(31),
        windowEnd: daysAgo(30),
      });
    }
    // A recent signal on the FREE org, pointing at the free org's own old batch:
    // the batch is past free's window and must still survive, because the row that
    // references it does.
    const recent = await seedChange({ ...free, age: 1 });
    await testDb
      .update(schema.signals)
      .set({ batchedIntoId: "bat-loose" })
      .where(inArray(schema.signals.id, [recent.signalId]));
    // And an unreferenced one on free, to prove the window still bites.
    await testDb.insert(schema.signalBatches).values({
      id: "bat-orphan",
      orgId: free.orgId,
      competitorId: free.competitorId,
      signalIds: [],
      category: "product",
      count: 1,
      highestSeverity: "low",
      windowStart: daysAgo(31),
      windowEnd: daysAgo(30),
    });

    await runPurgeRetention();

    const left = (
      await testDb.select({ id: schema.signalBatches.id }).from(schema.signalBatches)
    ).map((r) => r.id);
    expect(left.sort()).toEqual(["bat-loose", "bat-pinned"]);
  });
});

describe("purge-retention — operator data is not org history", () => {
  // scrape_runs / ai_runs / audit_log are deliberately outside the tier window: they
  // are how an outage or a cost spike is reconstructed months later, and no plan
  // buys their retention. The risk is a future contributor adding a table to the
  // per-plan loop because it "also has a timestamp".
  test("ops tables keep rows far older than any plan's window", async () => {
    const free = await seedOrg("free");
    const ancient = daysAgo(4000);
    await testDb.insert(schema.scrapeRuns).values({
      monitorId: free.monitorId,
      competitorId: free.competitorId,
      sourceType: "homepage",
      status: "success",
      durationMs: 10,
      recordedAt: ancient,
    });
    await testDb.insert(schema.aiRuns).values({
      task: "classify_change",
      provider: "groq",
      model: "m",
      status: "success",
      orgId: free.orgId,
      competitorId: free.competitorId,
      recordedAt: ancient,
    });
    await testDb.insert(schema.auditLog).values({
      id: "aud-1",
      actorEmail: "ops@example.com",
      action: "force_scrape",
      createdAt: ancient,
    });

    await runPurgeRetention();

    expect(await testDb.select({ id: schema.scrapeRuns.id }).from(schema.scrapeRuns)).toHaveLength(1);
    expect(await testDb.select({ id: schema.aiRuns.id }).from(schema.aiRuns)).toHaveLength(1);
    expect(await testDb.select({ id: schema.auditLog.id }).from(schema.auditLog)).toHaveLength(1);
  });
});

describe("purge-retention — R2 is best-effort", () => {
  // The rows are gone before R2 is touched, so a bucket failure can only leave
  // orphaned objects (storage cost). It must never take the job down: a throw here
  // would fail every subsequent plan's pass and stall retention for the whole fleet.
  test("a failing bucket does not undo the delete or fail the run", async () => {
    setSharedOverrides({
      deleteManyFromR2: async () => {
        throw new Error("R2 unreachable");
      },
    });
    const free = await seedOrg("free");
    const older = await seedSnapshot(free.monitorId, 40);
    await seedSnapshot(free.monitorId, 30);

    const result = await runPurgeRetention();

    expect(await alive("snapshots", [older.snapshotId])).toEqual([]);
    // Nothing was confirmed deleted, so nothing is counted.
    expect(result.r2Deleted).toBe(0);
    expect(result.purgedOrgs).toBe(1);
  });
});
