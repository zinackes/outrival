import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";
import { makeTestDb, schema, type TestDb } from "./db-harness";

// The semantic gate's WIRING, against a real (in-process) Postgres: the decision
// predicate is unit-tested in @outrival/ai, but the consequences of that decision
// — the change row is stamped `suppression_reason='cosmetic'`, the classifier is
// never called, and no signal is ever created — live in the job and were only
// verified by reading it. A suppression is invisible to the customer by
// construction, so "no signal was created" is exactly the assertion that must be
// mechanical rather than trusted.
//
// This is the first job-level test in @outrival/workers. It mocks the Trigger SDK
// so `task({ run })` hands back its own config and `run` becomes directly
// callable. Bun's mock.module is PROCESS-GLOBAL: no other file in test/ imports a
// *.job.ts or the Trigger SDK today, which is what keeps that contained — check
// that still holds before adding a second job test.

let testDb: TestDb;
let closeDb: () => Promise<void>;
let runJob: (payload: { changeId: string }) => Promise<unknown>;

// Controlled by each test; read by the mocked @outrival/ai.
let gateVerdict: { substantive: boolean; reason: string } | null = null;
let classifyCalls = 0;
let triggered: Array<{ id: string; payload: unknown }> = [];

let seq = 0;

/** org → competitor → monitor → snapshot → change, the FK chain a change needs. */
async function seedChange(sourceType: string, diffText: string): Promise<string> {
  const n = ++seq;
  const orgId = `org-${n}`;
  const competitorId = `cmp-${n}`;
  const monitorId = `mon-${n}`;
  const snapshotId = `snp-${n}`;
  const changeId = `chg-${n}`;
  await testDb.insert(schema.organizations).values({ id: orgId, name: `Org ${n}`, slug: `org-${n}` });
  await testDb.insert(schema.competitors).values({ id: competitorId, orgId, name: `Competitor ${n}` });
  await testDb.insert(schema.monitors).values({ id: monitorId, competitorId, sourceType });
  await testDb
    .insert(schema.snapshots)
    .values({ id: snapshotId, monitorId, r2Key: `k-${n}`, contentHash: `h-${n}` });
  await testDb
    .insert(schema.changes)
    .values({ id: changeId, monitorId, snapshotAfterId: snapshotId, diffText, diffType: "text" });
  return changeId;
}

beforeAll(async () => {
  // Capture the REAL @outrival/ai before mocking it — mock.module is global, so a
  // later `import` would hand back the mock and the real gateAppliesTo /
  // suppressesAsCosmetic (which we deliberately keep live) would be lost.
  const realAi = await import("@outrival/ai");
  // Same reason, for the queue: NonRetriable must stay the REAL class or the
  // pg-boss `work` wrapper's `instanceof` check silently stops recognising a
  // terminal failure and retries it three times instead.
  const realQueue = await import("@outrival/queue");

  const harness = await makeTestDb();
  testDb = harness.db;
  closeDb = harness.close;

  mock.module("@outrival/db", () => ({ ...schema, db: harness.db }));

  // The job body fans out through the typed pg-boss registry, so the capture lives
  // here. Without a started queue `enqueue` would throw
  // "Queue not started" and every substantive-path assertion would fail on the
  // fan-out instead of on what it means to test.
  mock.module("@outrival/queue", () => ({
    ...realQueue,
    generateSignal: {
      ...realQueue.generateSignal,
      enqueue: async (payload: unknown) => {
        triggered.push({ id: "generate-signal", payload });
        return "job-stub";
      },
    },
  }));

  // lib/analytics is deliberately NOT mocked. Replacing it wholesale broke
  // digest-counts.test.ts (mock.module is process-global and the replacement
  // dropped every other export) — and it isn't needed: the real `loggedAi` just
  // wraps the call and best-effort-writes an ai_runs row, which lands in this
  // PGlite instance like any other insert.

  // Keep everything real except the two calls that would hit a provider.
  mock.module("@outrival/ai", () => ({
    ...realAi,
    isSubstantiveChange: async () => gateVerdict,
    classifyChange: async () => {
      classifyCalls++;
      return {
        category: "content" as const,
        severity: "medium" as const,
        is_significant: true,
        reason: "stubbed classification",
        humanChangeBefore: null,
        humanChangeAfter: null,
        materiality: { decision_impact: 1, urgency: 1, corroboration: 1 },
      };
    },
  }));

  // The core handler IS the job now: pg-boss calls it directly, and the Trigger
  // wrapper that used to sit in front of it is gone (Phase 7). Imported late so it
  // resolves the mocks installed above.
  const core = await import("../src/core/classify-change");
  runJob = core.runClassifyChange as (p: { changeId: string }) => Promise<unknown>;
});

afterAll(async () => {
  // Guarded: if beforeAll failed, closeDb is undefined and an unguarded call
  // replaces the real setup error with a useless TypeError.
  await closeDb?.();
});

function reset() {
  classifyCalls = 0;
  triggered = [];
}

describe("classify-change — cosmetic gate wiring", () => {
  test("a pure rewording is suppressed: stamped, unclassified, no signal", async () => {
    reset();
    gateVerdict = { substantive: false, reason: "same claim, reworded" };
    const changeId = await seedChange(
      "blog",
      "- Ship faster with less overhead\n+ Move faster, with less overhead",
    );

    const result = await runJob({ changeId });
    expect(result).toEqual({ suppressed: "cosmetic", reason: "same claim, reworded" });

    // (1) the change is stamped for audit, not deleted — a silent drop would be
    // undetectable, which is the whole reason the column exists.
    const [row] = await testDb
      .select()
      .from(schema.changes)
      .where(eq(schema.changes.id, changeId));
    expect(row?.suppressionReason).toBe("cosmetic");
    expect(row?.summary).toBe("same claim, reworded");

    // (2) the classifier was never paid for.
    expect(classifyCalls).toBe(0);

    // (3) nothing downstream was triggered, and no signal exists for this change.
    expect(triggered).toEqual([]);
    const sigs = await testDb
      .select()
      .from(schema.signals)
      .where(eq(schema.signals.changeId, changeId));
    expect(sigs).toHaveLength(0);
  });

  test("FAIL OPEN: a null gate classifies exactly as before the gate existed", async () => {
    reset();
    gateVerdict = null; // parse miss / provider down / breaker open
    const changeId = await seedChange("blog", "Introducing our new SOC 2 Type II certification");

    await runJob({ changeId });

    expect(classifyCalls).toBe(1);
    expect(triggered.map((t) => t.id)).toEqual(["generate-signal"]);
    const [row] = await testDb
      .select()
      .from(schema.changes)
      .where(eq(schema.changes.id, changeId));
    expect(row?.suppressionReason).toBeNull();
  });

  test("a substantive verdict classifies and leaves no suppression mark", async () => {
    reset();
    gateVerdict = { substantive: true, reason: "entry price moved" };
    const changeId = await seedChange("pricing", "- Starter $29/mo\n+ Starter $39/mo");

    await runJob({ changeId });

    expect(classifyCalls).toBe(1);
    expect(triggered.map((t) => t.id)).toEqual(["generate-signal"]);
    const [row] = await testDb
      .select()
      .from(schema.changes)
      .where(eq(schema.changes.id, changeId));
    expect(row?.suppressionReason).toBeNull();
  });

  test("a list-shaped source is never gated, even on a cosmetic verdict", async () => {
    reset();
    // The gate would say "cosmetic" here; gateAppliesTo must stop it being asked.
    gateVerdict = { substantive: false, reason: "same urls, reordered" };
    const changeId = await seedChange("sitemap", "+ https://acme.com/vs/outrival");

    await runJob({ changeId });

    expect(classifyCalls).toBe(1);
    const [row] = await testDb
      .select()
      .from(schema.changes)
      .where(eq(schema.changes.id, changeId));
    expect(row?.suppressionReason).toBeNull();
  });
});
