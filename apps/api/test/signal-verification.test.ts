import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import {
  competitors,
  monitors,
  snapshots,
  changes,
  signals,
  signalVerifications,
  jobPostings,
} from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

// What the double capture (Véracité Intelligence v2 P2) leaves on the read side.
//
// Two things are asserted here, and the second is the one that could break quietly:
// a verified signal is now INSERTED half an hour after its change was detected, and
// every window join hanging off that signal has to be anchored on the change, not on
// the signal's own timestamp. A fact block that empties out 32 minutes later would be
// a regression nobody sees until a customer opens a pricing signal and finds nothing.

let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let org: { orgId: string; userId: string; email: string };

let seq = 0;
const T = (h: number, min = 0) => new Date(Date.UTC(2026, 0, 1, h, min, 0));

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  const { signalsRouter } = await import("../src/routes/signals");
  app = mountApp("/api/signals", signalsRouter);
  org = await seedOrg(testDb);
});

async function seedSignal(opts: {
  sourceType?: "pricing" | "jobs";
  detectedAt: Date;
  /** When the signal row itself was written. A verified signal lands 32 min later. */
  createdAt: Date;
}) {
  const n = ++seq;
  const competitorId = `cmpv-${n}`;
  const monitorId = `monv-${n}`;
  const snapshotId = `snpv-${n}`;
  await testDb.insert(competitors).values({ id: competitorId, orgId: org.orgId, name: `C${n}` });
  await testDb
    .insert(monitors)
    .values({ id: monitorId, competitorId, sourceType: opts.sourceType ?? "pricing" });
  await testDb.insert(snapshots).values({
    id: snapshotId,
    monitorId,
    r2Key: `kv-${n}`,
    contentHash: `hv-${n}`,
    captureMethod: "rendered",
  });
  await testDb.insert(changes).values({
    id: `chgv-${n}`,
    monitorId,
    snapshotAfterId: snapshotId,
    diffText: "- Starter plan is $79 per month\n+ Starter plan is $99 per month",
    detectedAt: opts.detectedAt,
  });
  await testDb.insert(signals).values({
    id: `sigv-${n}`,
    changeId: `chgv-${n}`,
    orgId: org.orgId,
    competitorId,
    severity: "critical",
    category: "pricing",
    insight: `insight ${n}`,
    createdAt: opts.createdAt,
  });
  return { signalId: `sigv-${n}`, changeId: `chgv-${n}`, competitorId, monitorId };
}

async function detail(signalId: string) {
  const res = await app.request(`/api/signals/${signalId}/detail`, asUser(org.userId));
  expect(res.status).toBe(200);
  return (await res.json()).signal;
}

describe("verification on the signal detail", () => {
  test("reports the outcome, both capture times, and the interval between them", async () => {
    const seeded = await seedSignal({ detectedAt: T(10), createdAt: T(10, 32) });
    await testDb.insert(signalVerifications).values({
      changeId: seeded.changeId,
      competitorId: seeded.competitorId,
      monitorId: seeded.monitorId,
      deltaFingerprint: "fp-1",
      firstExcerpt: "+ starter plan is $99 per month",
      secondExcerpt: "+ starter plan is $99 per month",
      quickCheckAt: T(10, 2),
      independentCheckAt: T(10, 30),
      outcome: "confirmed",
      emitted: 1,
      signalId: seeded.signalId,
    });

    const signal = await detail(seeded.signalId);

    expect(signal.verification).toMatchObject({ outcome: "confirmed", gapMinutes: 28 });
    expect(signal.verification.quickCheckAt).not.toBeNull();
    expect(signal.verification.independentCheckAt).not.toBeNull();
  });

  test("reports a skipped verification without pretending it was verified", async () => {
    const seeded = await seedSignal({ detectedAt: T(11), createdAt: T(11, 2) });
    await testDb.insert(signalVerifications).values({
      changeId: seeded.changeId,
      competitorId: seeded.competitorId,
      monitorId: seeded.monitorId,
      deltaFingerprint: "fp-2",
      firstExcerpt: "+ x",
      quickCheckAt: T(11, 2),
      outcome: "skipped",
      emitted: 1,
      signalId: seeded.signalId,
    });

    const signal = await detail(seeded.signalId);

    expect(signal.verification.outcome).toBe("skipped");
    expect(signal.verification.independentCheckAt).toBeNull();
    expect(signal.verification.gapMinutes).toBeNull();
  });

  test("is null for the signals that were never in the perimeter", async () => {
    const seeded = await seedSignal({ detectedAt: T(12), createdAt: T(12) });
    const signal = await detail(seeded.signalId);
    expect(signal.verification).toBeNull();
  });
});

describe("a deferred emission does not move the fact-block window", () => {
  test("the sibling facts of a change still attach 32 minutes later", async () => {
    const seeded = await seedSignal({
      sourceType: "jobs",
      detectedAt: T(14),
      // The signal row is written after the double capture, half an hour on.
      createdAt: T(14, 32),
    });
    await testDb.insert(jobPostings).values({
      competitorId: seeded.competitorId,
      title: "Staff Engineer",
      department: "Engineering",
      isActive: true,
      // Written by the extractor right after the capture, long before the emission.
      detectedAt: T(14, 3),
    });

    const signal = await detail(seeded.signalId);

    // Anchored on changes.detected_at: the emission delay is invisible to the join.
    expect(signal.facts.kind).toBe("hiring");
    expect(signal.facts.opened.map((r: { title: string }) => r.title)).toContain("Staff Engineer");
  });
});
