import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { clearQueueOverrides, recordEnqueues, setQueueOverrides } from "./queue-mock";
import { and, eq } from "drizzle-orm";
import { buildDeltaProof } from "@outrival/shared";
import { makeTestDb, schema, type TestDb } from "./db-harness";
import { clearSharedOverrides, setSharedOverrides } from "./shared-mock";

// ab_test_suspected (Véracité Intelligence v2 P2) — the one signal this phase ADDS,
// built entirely out of signals it withheld.
//
// The clock is injected on every call: the windows are the whole behaviour, and a
// test that had to sleep through them would be a test nobody runs.

let testDb: TestDb;
let closeDb: () => Promise<void>;
let maybeEmit: typeof import("../src/lib/ab-test-signal").maybeEmitAbTestSignal;

interface Enqueued {
  changeId: string;
  classification: { category: string; severity: string; humanChangeBefore: string; humanChangeAfter: string };
  skipVerification?: boolean;
}
let enqueued: Enqueued[] = [];

const NOW = new Date("2026-08-05T12:00:00Z");
const DIFF = ["- Starter plan is $79 per month", "+ Starter plan is $99 per month"].join("\n");
const INVERSE = ["- Starter plan is $99 per month", "+ Starter plan is $79 per month"].join("\n");
const PROOF = buildDeltaProof({ diffText: DIFF });

beforeAll(async () => {
  const harness = await makeTestDb();
  testDb = harness.db;
  closeDb = harness.close;

  setQueueOverrides({ generateSignal: recordEnqueues(() => enqueued) });

  ({ maybeEmitAbTestSignal: maybeEmit } = await import("../src/lib/ab-test-signal"));
});

afterAll(() => {
  clearSharedOverrides();
  clearQueueOverrides();
  return closeDb();
});

beforeEach(() => {
  enqueued = [];
  setSharedOverrides({ uploadToR2: async () => {} });
});

let seq = 0;

async function seedMonitor(sourceType = "pricing") {
  const n = ++seq;
  const orgId = `org-ab${n}`;
  const competitorId = `cmp-ab${n}`;
  await testDb.insert(schema.organizations).values({ id: orgId, name: `Org ${n}`, slug: `org-ab${n}` });
  await testDb
    .insert(schema.competitors)
    .values({ id: competitorId, orgId, name: `Competitor ${n}`, url: "https://acme.test" });
  const [monitor] = await testDb
    .insert(schema.monitors)
    .values({
      competitorId,
      sourceType: sourceType as "pricing",
      frequency: "daily",
      config: { url: "https://acme.test/pricing" },
    })
    .returning();
  const [snapshot] = await testDb
    .insert(schema.snapshots)
    .values({
      monitorId: monitor!.id,
      r2Key: `snapshots/${competitorId}/${sourceType}/${n}`,
      contentHash: `hash-ab${n}`,
      status: "success",
      captureMethod: "rendered",
    })
    .returning();
  return { orgId, competitorId, monitorId: monitor!.id, snapshotId: snapshot!.id };
}

/** One not_reproduced observation, carrying `diffText`'s delta, `daysAgo` in the past. */
async function seedFlap(
  seed: Awaited<ReturnType<typeof seedMonitor>>,
  diffText: string,
  daysAgo = 0,
) {
  const at = new Date(NOW.getTime() - daysAgo * 86_400_000);
  const [change] = await testDb
    .insert(schema.changes)
    .values({
      monitorId: seed.monitorId,
      snapshotAfterId: seed.snapshotId,
      diffText,
      diffType: "text",
      detectedAt: at,
    })
    .returning();
  await testDb.insert(schema.signalVerifications).values({
    changeId: change!.id,
    competitorId: seed.competitorId,
    monitorId: seed.monitorId,
    deltaFingerprint: buildDeltaProof({ diffText }).fingerprint,
    firstExcerpt: "",
    outcome: "not_reproduced",
    recordedAt: at,
  });
  return change!.id;
}

const emit = (seed: Awaited<ReturnType<typeof seedMonitor>>, sourceType = "pricing", now = NOW) =>
  maybeEmit({
    monitorId: seed.monitorId,
    competitorId: seed.competitorId,
    competitorUrl: "https://acme.test",
    sourceType,
    proof: PROOF,
    now,
  });

describe("the window", () => {
  test("one observation is a fluke, not a test", async () => {
    const seed = await seedMonitor();
    await seedFlap(seed, DIFF);

    const result = await emit(seed);

    expect(result).toMatchObject({ emitted: false, reason: "below_threshold", observations: 1 });
    expect(enqueued).toHaveLength(0);
  });

  test("two flips inside the window emit exactly one signal", async () => {
    const seed = await seedMonitor();
    await seedFlap(seed, DIFF, 3);
    await seedFlap(seed, INVERSE, 1);

    const result = await emit(seed);

    expect(result.emitted).toBe(true);
    expect(result.observations).toBe(2);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.classification.category).toBe("pricing");
    expect(enqueued[0]!.classification.severity).toBe("medium");
    expect(enqueued[0]!.classification.humanChangeBefore).toBe("starter plan is $79 per month");
    expect(enqueued[0]!.classification.humanChangeAfter).toBe("starter plan is $99 per month");
    // The finding IS the conclusion of a verification: it must never be re-verified.
    expect(enqueued[0]!.skipVerification).toBe(true);
  });

  test("a third flip inside the cooldown says nothing at all", async () => {
    const seed = await seedMonitor();
    await seedFlap(seed, DIFF, 3);
    await seedFlap(seed, INVERSE, 1);
    await emit(seed);
    enqueued = [];

    await seedFlap(seed, DIFF, 0);
    const result = await emit(seed, "pricing", new Date(NOW.getTime() + 2 * 86_400_000));

    expect(result).toMatchObject({ emitted: false, reason: "cooldown" });
    expect(enqueued).toHaveLength(0);
  });

  test("observations outside the window do not count", async () => {
    const seed = await seedMonitor();
    await seedFlap(seed, DIFF, 20);
    await seedFlap(seed, INVERSE, 1);

    const result = await emit(seed);

    expect(result).toMatchObject({ emitted: false, observations: 1 });
  });

  test("an unrelated delta on the same page does not count", async () => {
    const seed = await seedMonitor();
    await seedFlap(seed, DIFF, 2);
    await seedFlap(seed, ["- we support single sign on", "+ we support scim provisioning"].join("\n"), 1);

    const result = await emit(seed);

    expect(result).toMatchObject({ emitted: false, observations: 1 });
  });

  test("a confirmed verification is not an observation", async () => {
    const seed = await seedMonitor();
    await seedFlap(seed, DIFF, 2);
    const confirmedChangeId = await seedFlap(seed, INVERSE, 1);
    await testDb
      .update(schema.signalVerifications)
      .set({ outcome: "confirmed" })
      .where(eq(schema.signalVerifications.changeId, confirmedChangeId));

    const result = await emit(seed);

    expect(result).toMatchObject({ emitted: false, observations: 1 });
  });
});

describe("the anchor", () => {
  test("hangs off its own page_variance monitor, never the flapping one", async () => {
    const seed = await seedMonitor();
    await seedFlap(seed, DIFF, 3);
    await seedFlap(seed, INVERSE, 1);

    await emit(seed);

    const [anchor] = await testDb
      .select()
      .from(schema.monitors)
      .where(
        and(
          eq(schema.monitors.competitorId, seed.competitorId),
          eq(schema.monitors.sourceType, "page_variance"),
        ),
      );
    expect(anchor).toBeDefined();
    expect(anchor!.isActive).toBe(false);
    expect(enqueued[0]!.changeId).not.toBe(seed.monitorId);

    const [change] = await testDb
      .select()
      .from(schema.changes)
      .where(eq(schema.changes.id, enqueued[0]!.changeId));
    expect(change!.monitorId).toBe(anchor!.id);
    expect(change!.diffText).toContain("A/B test suspected");
    expect(change!.diffText).toContain("Variant A: starter plan is $79 per month");
    expect((change!.rawDiff as { monitorId: string }).monitorId).toBe(seed.monitorId);
    expect((change!.rawDiff as { observations: number }).observations).toBe(2);
  });
});

describe("severity and category", () => {
  test("a non-pricing page is a low-severity content finding", async () => {
    const seed = await seedMonitor("homepage");
    await seedFlap(seed, DIFF, 3);
    await seedFlap(seed, INVERSE, 1);

    await emit(seed, "homepage");

    expect(enqueued[0]!.classification.severity).toBe("low");
    expect(enqueued[0]!.classification.category).toBe("content");
  });
});
