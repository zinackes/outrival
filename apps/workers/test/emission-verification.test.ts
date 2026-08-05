import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";
import { buildDeltaProof } from "@outrival/shared";
import { makeTestDb, schema, type TestDb } from "./db-harness";

// The emission frontier (Véracité Intelligence v2 P2), against a real in-process
// Postgres: same migrations, same unique index on signal_verifications.change_id.
//
// What matters here is the set of signals that are NOT delayed. A verification gate
// is a place where a customer's signal can go missing, so every exemption is asserted
// explicitly rather than left to hold by accident.

let testDb: TestDb;
let closeDb: () => Promise<void>;
let intercept: typeof import("../src/lib/emission-verification").interceptEmission;
let recordEmission: typeof import("../src/lib/emission-verification").recordEmission;

interface EnqueuedVerify {
  changeId: string;
  pass: string;
  classification?: unknown;
}
let verifyEnqueued: EnqueuedVerify[] = [];

beforeAll(async () => {
  const realQueue = await import("@outrival/queue");
  const harness = await makeTestDb();
  testDb = harness.db;
  closeDb = harness.close;

  mock.module("@outrival/queue", () => ({
    ...realQueue,
    NonRetriable: realQueue.NonRetriable,
    verifySignalDelta: {
      queue: "verify-signal-delta",
      enqueue: async (payload: EnqueuedVerify) => {
        verifyEnqueued.push(payload);
        return "job-id";
      },
    },
  }));

  ({ interceptEmission: intercept, recordEmission } = await import(
    "../src/lib/emission-verification"
  ));
});

afterAll(() => closeDb());
beforeEach(() => {
  verifyEnqueued = [];
});

const DIFF = ["- Starter plan is $79 per month", "+ Starter plan is $99 per month"].join("\n");
const INVERSE_DIFF = ["- Starter plan is $99 per month", "+ Starter plan is $79 per month"].join("\n");

let seq = 0;

async function seedChange(opts: {
  sourceType?: string;
  captureMethod?: string | null;
  snapshotStatus?: "success" | "partial";
  diffText?: string;
  url?: string | null;
} = {}) {
  const n = ++seq;
  const orgId = `org-${n}`;
  const competitorId = `cmp-${n}`;
  await testDb.insert(schema.organizations).values({ id: orgId, name: `Org ${n}`, slug: `org-${n}` });
  await testDb.insert(schema.competitors).values({
    id: competitorId,
    orgId,
    name: `Competitor ${n}`,
    url: opts.url === undefined ? "https://acme.test" : opts.url,
  });
  const [monitor] = await testDb
    .insert(schema.monitors)
    .values({
      competitorId,
      sourceType: (opts.sourceType ?? "pricing") as "pricing",
      frequency: "daily",
      config: { url: "https://acme.test/pricing" },
    })
    .returning();
  const [snapshot] = await testDb
    .insert(schema.snapshots)
    .values({
      monitorId: monitor!.id,
      r2Key: `snapshots/${competitorId}/pricing/${n}`,
      contentHash: `hash-${n}`,
      status: opts.snapshotStatus ?? "success",
      captureMethod: opts.captureMethod === undefined ? "rendered" : opts.captureMethod,
      contentSize: 4000,
    })
    .returning();
  const [change] = await testDb
    .insert(schema.changes)
    .values({
      monitorId: monitor!.id,
      snapshotAfterId: snapshot!.id,
      diffText: opts.diffText ?? DIFF,
      diffType: "text",
    })
    .returning();
  return { orgId, competitorId, monitor: monitor!, change: change! };
}

function args(seed: Awaited<ReturnType<typeof seedChange>>, over: Record<string, unknown> = {}) {
  return {
    change: {
      id: seed.change.id,
      monitorId: seed.change.monitorId,
      snapshotAfterId: seed.change.snapshotAfterId,
      diffText: seed.change.diffText,
    },
    monitor: {
      id: seed.monitor.id,
      sourceType: seed.monitor.sourceType,
      config: seed.monitor.config,
    },
    competitorId: seed.competitorId,
    competitorUrl: "https://acme.test",
    severity: "critical" as const,
    humanChangeBefore: null,
    humanChangeAfter: null,
    payload: { classification: { category: "pricing", severity: "critical" } },
    ...over,
  };
}

describe("interceptEmission — the perimeter", () => {
  test("defers a critical on a live page capture and opens exactly one verification", async () => {
    const seed = await seedChange();
    const result = await intercept(args(seed));

    expect(result).toEqual({ deferred: true, reason: "critical" });
    expect(verifyEnqueued).toHaveLength(1);
    expect(verifyEnqueued[0]!.pass).toBe("quick");
    expect(verifyEnqueued[0]!.classification).toEqual({ category: "pricing", severity: "critical" });

    const rows = await testDb
      .select()
      .from(schema.signalVerifications)
      .where(eq(schema.signalVerifications.changeId, seed.change.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe("pending");
    expect(rows[0]!.emitted).toBe(0);
    expect(rows[0]!.firstExcerpt).toContain("starter plan is $99 per month");
  });

  test("never defers a medium", async () => {
    const seed = await seedChange();
    const result = await intercept(args(seed, { severity: "medium" }));
    expect(result.deferred).toBe(false);
    expect(result.reason).toBe("out_of_scope");
    expect(verifyEnqueued).toHaveLength(0);
  });

  test("never defers a high on a non-volatile source", async () => {
    const seed = await seedChange({ sourceType: "blog" });
    const result = await intercept(args(seed, { severity: "high" }));
    expect(result.deferred).toBe(false);
    expect(verifyEnqueued).toHaveLength(0);
  });

  test("defers a high on pricing", async () => {
    const seed = await seedChange();
    const result = await intercept(args(seed, { severity: "high" }));
    expect(result).toEqual({ deferred: true, reason: "volatile_high" });
  });

  test("never verifies a signal anchored on a synthetic snapshot", async () => {
    const seed = await seedChange({ captureMethod: null });
    const result = await intercept(args(seed));
    expect(result).toEqual({ deferred: false, reason: "not_replayable" });
    expect(verifyEnqueued).toHaveLength(0);
  });

  test("never verifies a partial capture", async () => {
    const seed = await seedChange({ snapshotStatus: "partial" });
    const result = await intercept(args(seed));
    expect(result).toEqual({ deferred: false, reason: "partial_capture" });
  });

  test("emits immediately when the delta carries nothing distinctive to look for", async () => {
    const seed = await seedChange({ diffText: "- $79\n+ $99" });
    const result = await intercept(args(seed));
    expect(result).toEqual({ deferred: false, reason: "no_evidence" });
  });
});

describe("interceptEmission — idempotence", () => {
  test("a second run on a pending verification defers without a second fetch", async () => {
    const seed = await seedChange();
    await intercept(args(seed));
    verifyEnqueued = [];

    const again = await intercept(args(seed));
    expect(again).toEqual({ deferred: true, reason: "awaiting_verification" });
    expect(verifyEnqueued).toHaveLength(0);

    const rows = await testDb
      .select()
      .from(schema.signalVerifications)
      .where(eq(schema.signalVerifications.changeId, seed.change.id));
    expect(rows).toHaveLength(1);
  });

  test("lets the run through once the verification confirmed", async () => {
    const seed = await seedChange();
    await intercept(args(seed));
    await testDb
      .update(schema.signalVerifications)
      .set({ outcome: "confirmed" })
      .where(eq(schema.signalVerifications.changeId, seed.change.id));

    const result = await intercept(args(seed));
    expect(result).toEqual({ deferred: false, reason: "verification_confirmed" });
  });

  test("lets the run through when the verification was skipped — an infra failure never withholds", async () => {
    const seed = await seedChange();
    await intercept(args(seed));
    await testDb
      .update(schema.signalVerifications)
      .set({ outcome: "skipped" })
      .where(eq(schema.signalVerifications.changeId, seed.change.id));

    const result = await intercept(args(seed));
    expect(result).toEqual({ deferred: false, reason: "verification_skipped" });
  });

  test("keeps withholding a delta that did not reproduce, silently and for good", async () => {
    const seed = await seedChange();
    await intercept(args(seed));
    await testDb
      .update(schema.signalVerifications)
      .set({ outcome: "not_reproduced" })
      .where(eq(schema.signalVerifications.changeId, seed.change.id));
    verifyEnqueued = [];

    const result = await intercept(args(seed));
    expect(result).toEqual({ deferred: true, reason: "not_reproduced" });
    expect(verifyEnqueued).toHaveLength(0);
  });
});

describe("interceptEmission — anti-flap routing", () => {
  test("routes a medium into verification when the SAME delta recently failed to reproduce", async () => {
    const first = await seedChange();
    await testDb.insert(schema.signalVerifications).values({
      changeId: first.change.id,
      competitorId: first.competitorId,
      monitorId: first.monitor.id,
      deltaFingerprint: buildDeltaProof({ diffText: DIFF }).fingerprint,
      firstExcerpt: "",
      outcome: "not_reproduced",
      recordedAt: new Date(),
    });

    const [next] = await testDb
      .insert(schema.changes)
      .values({
        monitorId: first.monitor.id,
        snapshotAfterId: first.change.snapshotAfterId,
        diffText: DIFF,
        diffType: "text",
      })
      .returning();

    const result = await intercept({
      ...args(first, { severity: "medium" }),
      change: {
        id: next!.id,
        monitorId: next!.monitorId,
        snapshotAfterId: next!.snapshotAfterId,
        diffText: next!.diffText,
      },
    });
    expect(result).toEqual({ deferred: true, reason: "flap" });
  });

  test("routes on the INVERSE delta too — the page flipping back is the whole tell", async () => {
    const first = await seedChange();
    await testDb.insert(schema.signalVerifications).values({
      changeId: first.change.id,
      competitorId: first.competitorId,
      monitorId: first.monitor.id,
      deltaFingerprint: buildDeltaProof({ diffText: DIFF }).fingerprint,
      firstExcerpt: "",
      outcome: "not_reproduced",
      recordedAt: new Date(),
    });

    const [flipped] = await testDb
      .insert(schema.changes)
      .values({
        monitorId: first.monitor.id,
        snapshotAfterId: first.change.snapshotAfterId,
        diffText: INVERSE_DIFF,
        diffType: "text",
      })
      .returning();

    const result = await intercept({
      ...args(first, { severity: "low" }),
      change: {
        id: flipped!.id,
        monitorId: flipped!.monitorId,
        snapshotAfterId: flipped!.snapshotAfterId,
        diffText: flipped!.diffText,
      },
    });
    expect(result).toEqual({ deferred: true, reason: "flap" });
  });

  test("ignores a not_reproduced older than the flap window", async () => {
    const first = await seedChange();
    await testDb.insert(schema.signalVerifications).values({
      changeId: first.change.id,
      competitorId: first.competitorId,
      monitorId: first.monitor.id,
      deltaFingerprint: buildDeltaProof({ diffText: DIFF }).fingerprint,
      firstExcerpt: "",
      outcome: "not_reproduced",
      recordedAt: new Date(Date.now() - 20 * 86_400_000),
    });

    const [next] = await testDb
      .insert(schema.changes)
      .values({
        monitorId: first.monitor.id,
        snapshotAfterId: first.change.snapshotAfterId,
        diffText: DIFF,
        diffType: "text",
      })
      .returning();

    const result = await intercept({
      ...args(first, { severity: "medium" }),
      change: {
        id: next!.id,
        monitorId: next!.monitorId,
        snapshotAfterId: next!.snapshotAfterId,
        diffText: next!.diffText,
      },
    });
    expect(result.deferred).toBe(false);
  });

  test("ignores a flap recorded on a DIFFERENT page", async () => {
    const other = await seedChange();
    const seed = await seedChange();
    await testDb.insert(schema.signalVerifications).values({
      changeId: other.change.id,
      competitorId: other.competitorId,
      monitorId: other.monitor.id,
      deltaFingerprint: buildDeltaProof({ diffText: DIFF }).fingerprint,
      firstExcerpt: "",
      outcome: "not_reproduced",
      recordedAt: new Date(),
    });

    const result = await intercept(args(seed, { severity: "medium" }));
    expect(result.deferred).toBe(false);
  });
});

describe("recordEmission", () => {
  test("stamps the signal onto the verification once it exists", async () => {
    const seed = await seedChange();
    await intercept(args(seed));
    const [signal] = await testDb
      .insert(schema.signals)
      .values({
        changeId: seed.change.id,
        orgId: seed.orgId,
        competitorId: seed.competitorId,
        severity: "critical",
        category: "pricing",
        insight: "i",
        soWhat: "s",
        recommendedAction: "a",
      })
      .returning();

    await recordEmission(seed.change.id, signal!.id);

    const [row] = await testDb
      .select()
      .from(schema.signalVerifications)
      .where(eq(schema.signalVerifications.changeId, seed.change.id));
    expect(row!.emitted).toBe(1);
    expect(row!.signalId).toBe(signal!.id);
  });

  test("is a no-op for a change that was never verified", async () => {
    const seed = await seedChange({ captureMethod: null });
    await expect(recordEmission(seed.change.id, "no-such-signal")).resolves.toBeUndefined();
  });
});
