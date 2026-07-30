import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import {
  competitors,
  monitors,
  snapshots,
  changes,
  signals,
  jobPostings,
  pricingHistory,
} from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

// The sibling-fact join on GET /signals/:id/detail. A signal is born from a text
// diff of the page; the roles and plans of that same capture are written in
// parallel by the extractors, and until this join the two never met — a
// careers-page signal named five departments and not one role.
//
// The attribution is a time window, so what these tests pin is its edges: a row
// from the NEXT capture must never be claimed by an earlier change, and a row that
// landed hours late (the worker, not the scrape, stamps it) must still be found.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let org: { orgId: string; userId: string; email: string };

let seq = 0;
const T = (h: number, min = 0) => new Date(Date.UTC(2026, 0, 1, h, min, 0));

async function seedSource(sourceType: "jobs" | "pricing") {
  const n = ++seq;
  const competitorId = `cmp-${n}`;
  const monitorId = `mon-${n}`;
  const snapshotId = `snp-${n}`;
  await testDb.insert(competitors).values({ id: competitorId, orgId: org.orgId, name: `C${n}` });
  await testDb.insert(monitors).values({ id: monitorId, competitorId, sourceType });
  await testDb
    .insert(snapshots)
    .values({ id: snapshotId, monitorId, r2Key: `k-${n}`, contentHash: `h-${n}` });
  return { competitorId, monitorId, snapshotId };
}

async function seedSignal(src: {
  competitorId: string;
  monitorId: string;
  snapshotId: string;
  detectedAt: Date;
}): Promise<string> {
  const n = ++seq;
  await testDb.insert(changes).values({
    id: `chg-${n}`,
    monitorId: src.monitorId,
    snapshotAfterId: src.snapshotId,
    diffText: "+ something\n- something else",
    detectedAt: src.detectedAt,
  });
  await testDb.insert(signals).values({
    id: `sig-${n}`,
    changeId: `chg-${n}`,
    orgId: org.orgId,
    competitorId: src.competitorId,
    severity: "medium",
    category: "hiring",
    insight: `insight ${n}`,
    createdAt: src.detectedAt,
  });
  return `sig-${n}`;
}

async function facts(signalId: string) {
  const res = await app.request(`/api/signals/${signalId}/detail`, asUser(org.userId));
  expect(res.status).toBe(200);
  return (await res.json()).signal.facts;
}

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  const { signalsRouter } = await import("../src/routes/signals");
  app = mountApp("/api/signals", signalsRouter);
  org = await seedOrg(testDb);
});

describe("hiring facts", () => {
  test("the roles that landed with the change are named, with their apply link", async () => {
    const src = await seedSource("jobs");
    const signalId = await seedSignal({ ...src, detectedAt: T(10) });
    await testDb.insert(jobPostings).values([
      {
        competitorId: src.competitorId,
        title: "Staff Engineer",
        department: "Engineering",
        location: "Remote (US)",
        seniority: "staff",
        url: "https://boards.example.com/staff-engineer",
        salaryMin: 180000,
        salaryMax: 220000,
        salaryCurrency: "USD",
        isActive: true,
        // Stamped 40 minutes after the change: the scrape enqueued the extraction,
        // but a worker picked it up late. Queue waits past an hour are on record.
        detectedAt: T(10, 40),
      },
      {
        competitorId: src.competitorId,
        title: "Revenue Operations Lead",
        department: "Sales",
        location: "Toronto",
        isActive: true,
        detectedAt: T(10, 41),
      },
    ]);

    const f = await facts(signalId);
    expect(f.kind).toBe("hiring");
    expect(f.openedTotal).toBe(2);
    expect(f.openNow).toBe(2);
    const titles = f.opened.map((r: { title: string }) => r.title);
    expect(titles).toContain("Staff Engineer");
    expect(titles).toContain("Revenue Operations Lead");
    const staff = f.opened.find((r: { title: string }) => r.title === "Staff Engineer");
    expect(staff.url).toBe("https://boards.example.com/staff-engineer");
    expect(staff.salaryMax).toBe(220000);
  });

  test("the next capture's roles belong to the next change, not this one", async () => {
    const src = await seedSource("jobs");
    // Two changes on the same monitor three hours apart: a forced re-scan. Without
    // the next-change bound the six-hour window would let the first claim the
    // second's roles, which would report a hiring push that never happened.
    const first = await seedSignal({ ...src, detectedAt: T(1) });
    const second = await seedSignal({ ...src, detectedAt: T(4) });
    await testDb.insert(jobPostings).values([
      {
        competitorId: src.competitorId,
        title: "Belongs to the first",
        department: "Engineering",
        isActive: true,
        detectedAt: T(1, 5),
      },
      {
        competitorId: src.competitorId,
        title: "Belongs to the second",
        department: "Engineering",
        isActive: true,
        detectedAt: T(4, 5),
      },
    ]);

    const f1 = await facts(first);
    expect(f1.opened.map((r: { title: string }) => r.title)).toEqual(["Belongs to the first"]);
    const f2 = await facts(second);
    expect(f2.opened.map((r: { title: string }) => r.title)).toEqual(["Belongs to the second"]);
  });

  test("closed roles are reported when nothing opened", async () => {
    const src = await seedSource("jobs");
    const signalId = await seedSignal({ ...src, detectedAt: T(20) });
    await testDb.insert(jobPostings).values({
      competitorId: src.competitorId,
      title: "Support Engineer",
      department: "Support",
      isActive: false,
      // Detected long before this change, closed by it.
      detectedAt: T(2),
      closedAt: T(20, 3),
    });

    const f = await facts(signalId);
    expect(f.openedTotal).toBe(0);
    expect(f.closedTotal).toBe(1);
    expect(f.closed[0].title).toBe("Support Engineer");
  });

  test("a source with no extracted rows adds nothing", async () => {
    const src = await seedSource("jobs");
    const signalId = await seedSignal({ ...src, detectedAt: T(23) });
    expect(await facts(signalId)).toBeNull();
  });
});

describe("pricing facts", () => {
  const plan = (
    competitorId: string,
    planName: string,
    price: number | null,
    recordedAt: Date,
  ) => ({
    competitorId,
    planName,
    price,
    currency: "USD",
    billingPeriod: "monthly",
    recordedAt,
  });

  test("each plan carries what it was at the previous capture", async () => {
    const src = await seedSource("pricing");
    const signalId = await seedSignal({ ...src, detectedAt: T(12) });
    await testDb.insert(pricingHistory).values([
      // Previous batch, days earlier: the baseline is the prior capture whatever
      // its age, so it sits deliberately outside the attribution window.
      plan(src.competitorId, "Starter", 29, T(3)),
      plan(src.competitorId, "Pro", 99, T(3)),
      plan(src.competitorId, "Legacy", 9, T(3)),
      // This capture: Pro cut, Team new, Legacy gone, Starter untouched.
      plan(src.competitorId, "Starter", 29, T(12, 2)),
      plan(src.competitorId, "Pro", 79, T(12, 2)),
      plan(src.competitorId, "Team", 199, T(12, 2)),
    ]);

    const f = await facts(signalId);
    expect(f.kind).toBe("pricing");
    const byName = new Map(
      f.plans.map((p: { planName: string }) => [p.planName, p as Record<string, unknown>]),
    );
    expect(byName.get("Pro")).toMatchObject({ state: "changed", price: 79, previousPrice: 99 });
    expect(byName.get("Team")).toMatchObject({ state: "added", previousPrice: null });
    expect(byName.get("Legacy")).toMatchObject({ state: "removed", previousPrice: 9 });
    expect(byName.get("Starter")).toMatchObject({ state: "unchanged" });
    // What moved leads: the reader should not hunt for it.
    expect(f.plans[0].state).not.toBe("unchanged");
  });

  test("a first capture calls nothing new", async () => {
    const src = await seedSource("pricing");
    const signalId = await seedSignal({ ...src, detectedAt: T(15) });
    await testDb.insert(pricingHistory).values([
      plan(src.competitorId, "Starter", 19, T(15, 1)),
      plan(src.competitorId, "Pro", 49, T(15, 1)),
    ]);

    const f = await facts(signalId);
    // Thirty plans announced as "added" would read as a launch, not a first look.
    expect(f.plans.every((p: { state: string }) => p.state === "unchanged")).toBe(true);
  });
});

test("a source with no fact block is simply absent", async () => {
  const n = ++seq;
  const competitorId = `cmp-x-${n}`;
  const monitorId = `mon-x-${n}`;
  const snapshotId = `snp-x-${n}`;
  await testDb.insert(competitors).values({ id: competitorId, orgId: org.orgId, name: "Blog co" });
  await testDb.insert(monitors).values({ id: monitorId, competitorId, sourceType: "blog" });
  await testDb
    .insert(snapshots)
    .values({ id: snapshotId, monitorId, r2Key: `kx-${n}`, contentHash: `hx-${n}` });
  const signalId = await seedSignal({ competitorId, monitorId, snapshotId, detectedAt: T(18) });
  expect(await facts(signalId)).toBeNull();
});
