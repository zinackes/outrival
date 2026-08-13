import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { changes, competitors, monitors, signals, snapshots } from "@outrival/db";
import type { CompetitorStory } from "@outrival/shared";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

// OUT-172 — the competitor page used to show atomised movement ("+3 in 30 days")
// and never the story. The detail payload now carries the same accumulated memory
// the weekly brief narrates, built from the same query, so the push read and the
// pull read cannot tell different stories about the same competitor.
//
// What must NOT be replayed is the point of most of these: a signal the faithfulness
// gate blocked, one the post-hoc check could not verify, and one the user hid are
// all facts we already decided not to show. Three months does not improve them.

let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let A: { orgId: string; userId: string; email: string };

const T = new Date("2026-08-10T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(T.getTime() - days * DAY);

type SignalSeed = {
  id: string;
  before: string | null;
  after: string | null;
  days: number;
  groundingStatus?: string | null;
  filteredReason?: string | null;
  hidden?: boolean;
};

const SEEDS: SignalSeed[] = [
  { id: "sig-old", before: "Pro · $25/mo", after: "Pro · $29/mo", days: 120 },
  { id: "sig-mid", before: null, after: "SOC 2 Type II published", days: 40 },
  { id: "sig-new", before: "12 open roles", after: "19 open roles", days: 3 },
  // Never replayed, one reason each.
  {
    id: "sig-blocked",
    before: "a",
    after: "the gate blocked this",
    days: 20,
    filteredReason: "faithfulness_blocked",
  },
  {
    id: "sig-unverified",
    before: "a",
    after: "the figures never checked out",
    days: 21,
    groundingStatus: "unverified",
  },
  { id: "sig-hidden", before: "a", after: "the user hid this", days: 22, hidden: true },
  // A change we detected but could not restate carries no fact to tell.
  { id: "sig-noafter", before: "a", after: null, days: 23 },
];

beforeAll(async () => {
  const harness = await makeTestDb();
  testDb = harness.db;
  closeDb = harness.close;
  await installAppMocks(testDb);
  const { competitorsRouter } = await import("../src/routes/competitors");
  app = mountApp("/api/competitors", competitorsRouter);

  A = await seedOrg(testDb, { email: "competitor-memory@example.com" });
  await testDb.insert(competitors).values([
    { id: "cmp-mem", orgId: A.orgId, name: "Storied Co", url: "https://storied.example" },
    { id: "cmp-new", orgId: A.orgId, name: "Fresh Co", url: "https://fresh.example" },
  ]);
  await testDb.insert(monitors).values({
    id: "mon-mem",
    competitorId: "cmp-mem",
    sourceType: "homepage",
    frequency: "daily",
  });
  await testDb.insert(snapshots).values({
    id: "snap-mem",
    monitorId: "mon-mem",
    r2Key: "k",
    contentHash: "h",
    scrapedAt: T,
    status: "success",
  });

  // Signals hang off a change (FK), so each one needs its own.
  await testDb.insert(changes).values(
    SEEDS.map((s) => ({
      id: `chg-${s.id}`,
      monitorId: "mon-mem",
      snapshotAfterId: "snap-mem",
      diffText: "diff",
      detectedAt: ago(s.days),
    })),
  );
  await testDb.insert(signals).values(
    SEEDS.map((s) => ({
      id: s.id,
      changeId: `chg-${s.id}`,
      orgId: A.orgId,
      competitorId: "cmp-mem",
      severity: "medium" as const,
      category: "pricing" as const,
      insight: `insight for ${s.id}`,
      humanChangeBefore: s.before,
      humanChangeAfter: s.after,
      groundingStatus: s.groundingStatus ?? null,
      filteredReason: s.filteredReason ?? null,
      hiddenForUserAt: s.hidden ? T : null,
      createdAt: ago(s.days),
    })),
  );
});

afterAll(async () => {
  await closeDb();
});

async function fetchMemory(competitorId: string): Promise<CompetitorStory | null> {
  const res = await app.request(`/api/competitors/${competitorId}`, asUser(A.userId, A.email));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { memory: CompetitorStory | null };
  return body.memory;
}

describe("GET /competitors/:id memory", () => {
  test("tells the whole watch, oldest first, with the date it starts from", async () => {
    const memory = await fetchMemory("cmp-mem");
    expect(memory?.competitor).toBe("Storied Co");
    expect(memory?.facts.map((f) => f.after)).toEqual([
      "Pro · $29/mo",
      "SOC 2 Type II published",
      "19 open roles",
    ]);
    expect(memory?.total).toBe(3);
    expect(memory?.since).toBe(ago(120).toISOString());
    expect(memory?.sinceLabel).toBe("Apr 12, 2026");
  });

  test("every fact links back to the signal it was replayed from", async () => {
    const memory = await fetchMemory("cmp-mem");
    expect(memory?.facts.map((f) => f.signalId)).toEqual(["sig-old", "sig-mid", "sig-new"]);
  });

  test("a first capture keeps its null before rather than inventing one", async () => {
    const memory = await fetchMemory("cmp-mem");
    expect(memory?.facts[1]?.before).toBeNull();
    expect(memory?.facts[0]?.before).toBe("Pro · $25/mo");
  });

  test("what we already decided not to show is never replayed", async () => {
    const memory = await fetchMemory("cmp-mem");
    const text = JSON.stringify(memory);
    expect(text).not.toContain("the gate blocked this");
    expect(text).not.toContain("the figures never checked out");
    expect(text).not.toContain("the user hid this");
  });

  test("a competitor nothing has moved on has no story, not an empty one", async () => {
    expect(await fetchMemory("cmp-new")).toBeNull();
  });
});
