import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { makeTestDb, schema, type TestDb } from "./db-harness";
import { clearSharedOverrides, setSharedOverrides } from "./shared-mock";

/**
 * `detect-structural-changes` — the batching from `code:PER-45`.
 *
 * The weekly cron asked three questions per competitor (homepage monitor, newest
 * snapshots, open detection) inside the loop, so it paid 3N sequential round trips
 * platform-wide. They are three batched reads now, and the "newest MIN_SCRAPES per
 * monitor" one had to become a window function — which is the part that can quietly
 * go wrong: a wrong partition hands one competitor another's snapshots.
 *
 * Every test here stops at stage 1. `getFromR2` returns the same page for every key,
 * so `detectStructuralSignal` sees no difference and returns null, and no model is
 * ever called — `analysed` is exactly "passed all four filters", which is the
 * selection this rewrite moved into SQL.
 */

let testDb: TestDb;
let closeDb: () => Promise<void>;
let resetDb: () => Promise<void>;
let runDetectStructuralChanges: typeof import("../src/core/detect-structural-changes").runDetectStructuralChanges;

const PAGE = "<html><body><h1>Same page</h1><p>Same copy, every capture.</p></body></html>";
const DAY = 24 * 3600_000;
let seq = 0;

/** Every key stage 1 asked R2 for, in order. */
let fetched: string[];

beforeAll(async () => {
  const harness = await makeTestDb();
  testDb = harness.db;
  closeDb = harness.close;
  resetDb = harness.reset;
  ({ runDetectStructuralChanges } = await import("../src/core/detect-structural-changes"));
});

// The job walks every competitor in the database, so each test needs the table to
// hold only its own.
beforeEach(async () => {
  await resetDb();
  fetched = [];
  setSharedOverrides({
    getFromR2: async (key: string) => {
      fetched.push(key);
      return PAGE;
    },
  });
});

afterAll(async () => {
  clearSharedOverrides();
  await closeDb();
});

async function seedOrg() {
  const orgId = `org-${++seq}`;
  await testDb.insert(schema.organizations).values({ id: orgId, name: orgId, slug: orgId });
  return orgId;
}

/**
 * A competitor, optionally with a homepage monitor and N successful snapshots
 * (newest first: `daysAgo` counts up as the loop goes back in time).
 */
async function seedCompetitor(opts: {
  orgId: string;
  type?: "competitor" | "self";
  homepage?: boolean;
  snapshots?: number;
  failedSnapshots?: number;
}) {
  const n = ++seq;
  const competitorId = `cmp-${n}`;
  await testDb.insert(schema.competitors).values({
    id: competitorId,
    orgId: opts.orgId,
    name: `Competitor ${n}`,
    type: opts.type ?? "competitor",
  });
  if (opts.homepage === false) return { competitorId, keys: [] as string[] };

  const monitorId = `mon-${n}`;
  await testDb
    .insert(schema.monitors)
    .values({ id: monitorId, competitorId, sourceType: "homepage" });

  const keys: string[] = [];
  for (let i = 0; i < (opts.snapshots ?? 0); i++) {
    const key = `snap/${competitorId}/${i}`;
    keys.push(key);
    await testDb.insert(schema.snapshots).values({
      id: `snp-${competitorId}-${i}`,
      monitorId,
      r2Key: key,
      contentHash: `h-${i}`,
      status: "success",
      scrapedAt: new Date(Date.now() - i * DAY),
    });
  }
  // Failures are older than every success, so a job that ignores `status` would
  // still take them and a job that respects it never sees them.
  for (let i = 0; i < (opts.failedSnapshots ?? 0); i++) {
    await testDb.insert(schema.snapshots).values({
      id: `snp-${competitorId}-f${i}`,
      monitorId,
      r2Key: `snap/${competitorId}/f${i}`,
      contentHash: `hf-${i}`,
      status: "failed",
      scrapedAt: new Date(Date.now() - (100 + i) * DAY),
    });
  }
  return { competitorId, keys };
}

describe("detect-structural-changes — who gets analysed", () => {
  test("a competitor with enough successful homepage captures is analysed", async () => {
    const orgId = await seedOrg();
    await seedCompetitor({ orgId, snapshots: 3 });

    expect(await runDetectStructuralChanges()).toEqual({ analysed: 1, detected: 0 });
  });

  test("the user's own product is never a pivot candidate", async () => {
    const orgId = await seedOrg();
    await seedCompetitor({ orgId, type: "self", snapshots: 3 });

    expect((await runDetectStructuralChanges()).analysed).toBe(0);
  });

  test("no homepage monitor, nothing to compare", async () => {
    const orgId = await seedOrg();
    await seedCompetitor({ orgId, homepage: false });

    expect((await runDetectStructuralChanges()).analysed).toBe(0);
  });

  test("failed captures do not count toward the minimum", async () => {
    const orgId = await seedOrg();
    await seedCompetitor({ orgId, snapshots: 2, failedSnapshots: 3 });

    expect((await runDetectStructuralChanges()).analysed).toBe(0);
    expect(fetched).toEqual([]);
  });

  test("a competitor already carrying an open detection is left alone", async () => {
    const orgId = await seedOrg();
    const { competitorId } = await seedCompetitor({ orgId, snapshots: 3 });
    await testDb.insert(schema.structuralChanges).values({
      id: "sc-1",
      competitorId,
      type: "pivot",
      confidence: "high",
      evidence: {},
      status: "detected",
    });

    expect((await runDetectStructuralChanges()).analysed).toBe(0);
  });
});

describe("detect-structural-changes — the window is per monitor", () => {
  test("each competitor gets its own newest 3 captures, newest first", async () => {
    const orgId = await seedOrg();
    const a = await seedCompetitor({ orgId, snapshots: 5 });
    const b = await seedCompetitor({ orgId, snapshots: 4 });

    expect((await runDetectStructuralChanges()).analysed).toBe(2);

    // Three per competitor, never four, and never one competitor's captures under
    // the other's — which is what a missing PARTITION BY would produce.
    const keysOf = (id: string) => fetched.filter((k) => k.includes(`/${id}/`));
    expect(fetched).toHaveLength(6);
    expect(keysOf(a.competitorId)).toEqual(a.keys.slice(0, 3).map((k) => `${k}.html`));
    expect(keysOf(b.competitorId)).toEqual(b.keys.slice(0, 3).map((k) => `${k}.html`));
  });
});
