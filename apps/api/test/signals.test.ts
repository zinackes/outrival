import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { competitors, monitors, snapshots, changes, signals } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

// Signals feed: server-side pagination (offset/total/nextOffset), the unread-first
// ordering tier, facet counts, mark-all-read (full scope + undo) and org-scoping — the
// behaviours the pagination + read-state-ranking rework added.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;

let A: { orgId: string; userId: string; email: string };
let B: { orgId: string; userId: string; email: string };
let C: { orgId: string; userId: string; email: string };
let D: { orgId: string; userId: string; email: string };
let E: { orgId: string; userId: string; email: string };

let seq = 0;

// One competitor + its monitor + one snapshot, reused by every change under it.
async function seedCompetitor(
  orgId: string,
  overlapScore = 50,
): Promise<{ competitorId: string; monitorId: string; snapshotId: string }> {
  const n = ++seq;
  const competitorId = `cmp-${n}`;
  const monitorId = `mon-${n}`;
  const snapshotId = `snp-${n}`;
  await testDb
    .insert(competitors)
    .values({ id: competitorId, orgId, name: `Competitor ${n}`, overlapScore });
  await testDb
    .insert(monitors)
    .values({ id: monitorId, competitorId, sourceType: "homepage" });
  await testDb
    .insert(snapshots)
    .values({ id: snapshotId, monitorId, r2Key: `k-${n}`, contentHash: `h-${n}` });
  return { competitorId, monitorId, snapshotId };
}

async function seedSignal(opts: {
  orgId: string;
  competitorId: string;
  monitorId: string;
  snapshotId: string;
  severity: "low" | "medium" | "high" | "critical";
  category?: "pricing" | "product" | "hiring" | "reviews" | "content" | "funding";
  isRead?: boolean;
  createdAt: Date;
  relevanceScore?: number | null;
  insight?: string;
}): Promise<string> {
  const n = ++seq;
  const changeId = `chg-${n}`;
  const signalId = `sig-${n}`;
  await testDb.insert(changes).values({
    id: changeId,
    monitorId: opts.monitorId,
    snapshotAfterId: opts.snapshotId,
    detectedAt: opts.createdAt,
  });
  await testDb.insert(signals).values({
    id: signalId,
    changeId,
    orgId: opts.orgId,
    competitorId: opts.competitorId,
    severity: opts.severity,
    category: opts.category ?? "product",
    insight: opts.insight ?? `insight ${n}`,
    isRead: opts.isRead ?? false,
    relevanceScore: opts.relevanceScore ?? null,
    createdAt: opts.createdAt,
  });
  return signalId;
}

const T = (min: number) => new Date(Date.UTC(2026, 0, 1, 0, min, 0));

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  const { signalsRouter } = await import("../src/routes/signals");
  app = mountApp("/api/signals", signalsRouter);

  A = await seedOrg(testDb);
  B = await seedOrg(testDb);
  C = await seedOrg(testDb);
  D = await seedOrg(testDb);
  E = await seedOrg(testDb);

  // Org A — ordering + facets + filters.
  const a = await seedCompetitor(A.orgId);
  // Read critical (newer) vs unread low (older): the unread-first tier must float the
  // unread low above the read critical despite critical + recency.
  await seedSignal({ ...a, orgId: A.orgId, severity: "low", isRead: false, createdAt: T(1), insight: "unread-low" });
  await seedSignal({ ...a, orgId: A.orgId, severity: "critical", isRead: true, createdAt: T(2), insight: "read-critical" });
  // A pricing signal for the category filter.
  await seedSignal({ ...a, orgId: A.orgId, severity: "medium", category: "pricing", isRead: false, createdAt: T(3), insight: "pricing-one" });

  // Org C — mark-all-read (3 unread).
  const c = await seedCompetitor(C.orgId);
  for (let i = 0; i < 3; i++) {
    await seedSignal({ ...c, orgId: C.orgId, severity: "high", isRead: false, createdAt: T(10 + i) });
  }

  // Org D — pagination (5 signals).
  const d = await seedCompetitor(D.orgId);
  for (let i = 0; i < 5; i++) {
    await seedSignal({ ...d, orgId: D.orgId, severity: "medium", isRead: false, createdAt: T(20 + i) });
  }

  // Org E — the two halves of the default ordering, each with the older signal being
  // the higher-threat one so threat and recency disagree inside both tiers.
  const e = await seedCompetitor(E.orgId);
  await seedSignal({ ...e, orgId: E.orgId, severity: "critical", isRead: false, createdAt: T(1), insight: "unread-critical-old" });
  await seedSignal({ ...e, orgId: E.orgId, severity: "low", isRead: false, createdAt: T(2), insight: "unread-low-new" });
  await seedSignal({ ...e, orgId: E.orgId, severity: "critical", isRead: true, createdAt: T(3), insight: "read-critical-old" });
  await seedSignal({ ...e, orgId: E.orgId, severity: "low", isRead: true, createdAt: T(4), insight: "read-low-new" });
});

describe("signals feed", () => {
  test("rejects an unauthenticated request", async () => {
    const res = await app.request("/api/signals", asUser(null));
    expect(res.status).toBe(401);
  });

  test("unread signals rank above read ones (hard tier)", async () => {
    const res = await app.request("/api/signals", asUser(A.userId, A.email));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(3);
    // unread-low + pricing (both unread) come before read-critical.
    const insights = body.signals.map((s: { insight: string }) => s.insight);
    expect(insights.indexOf("read-critical")).toBe(2);
    expect(insights).toContain("unread-low");
    expect(insights).toContain("pricing-one");
  });

  test("threat ranks the unread tier; the read tier is chronological", async () => {
    const res = await app.request("/api/signals", asUser(E.userId, E.email));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signals.map((s: { insight: string }) => s.insight)).toEqual([
      // Unread tier: the older critical outranks the newer low.
      "unread-critical-old",
      "unread-low-new",
      // Read tier: newest first, whatever the threat score.
      "read-low-new",
      "read-critical-old",
    ]);
  });

  test("paginates with total + nextOffset", async () => {
    const p1 = await (await app.request("/api/signals?limit=2", asUser(D.userId, D.email))).json();
    expect(p1.total).toBe(5);
    expect(p1.signals).toHaveLength(2);
    expect(p1.nextOffset).toBe(2);

    const p3 = await (
      await app.request("/api/signals?limit=2&offset=4", asUser(D.userId, D.email))
    ).json();
    expect(p3.signals).toHaveLength(1);
    expect(p3.nextOffset).toBeNull();
  });

  test("facets: counts + dropdown options, product-scoped", async () => {
    const res = await app.request("/api/signals/facets", asUser(A.userId, A.email));
    expect(res.status).toBe(200);
    const f = await res.json();
    expect(f.counts.all).toBe(3);
    expect(f.counts.unread).toBe(2);
    expect(f.counts.critical).toBe(1);
    expect(f.counts.alerts).toBe(1); // the read critical
    expect(f.categories.sort()).toEqual(["pricing", "product"]);
    expect(f.competitors).toHaveLength(1);
  });

  test("category filter narrows server-side", async () => {
    const res = await app.request("/api/signals?category=pricing", asUser(A.userId, A.email));
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.signals[0].insight).toBe("pricing-one");
  });

  test("view=unread filter", async () => {
    const res = await app.request("/api/signals?view=unread", asUser(A.userId, A.email));
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.signals.every((s: { isRead: boolean }) => !s.isRead)).toBe(true);
  });

  test("org-scoping: a foreign org sees nothing", async () => {
    const res = await app.request("/api/signals", asUser(B.userId, B.email));
    const body = await res.json();
    expect(body.total).toBe(0);
    expect(body.signals).toHaveLength(0);
  });

  test("mark-all-read flips the whole scope, undo restores", async () => {
    const res = await app.request(
      "/api/signals/mark-all-read",
      asUser(C.userId, C.email, { method: "POST", body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.count).toBe(3);
    expect(out.ids).toHaveLength(3);

    const facets = await (
      await app.request("/api/signals/facets", asUser(C.userId, C.email))
    ).json();
    expect(facets.counts.unread).toBe(0);

    // Undo — set exactly those ids back to unread.
    const undo = await app.request(
      "/api/signals/mark-all-read",
      asUser(C.userId, C.email, {
        method: "POST",
        body: JSON.stringify({ ids: out.ids, read: false }),
      }),
    );
    expect((await undo.json()).count).toBe(3);
    const after = await (
      await app.request("/api/signals/facets", asUser(C.userId, C.email))
    ).json();
    expect(after.counts.unread).toBe(3);
  });

  test("mark-all-read is org-scoped (cannot touch another org)", async () => {
    // B has no signals; marking all read there must not affect A's unread.
    await app.request(
      "/api/signals/mark-all-read",
      asUser(B.userId, B.email, { method: "POST", body: JSON.stringify({}) }),
    );
    const facets = await (
      await app.request("/api/signals/facets", asUser(A.userId, A.email))
    ).json();
    expect(facets.counts.unread).toBe(2);
  });

  test("CSV export returns the filtered scope", async () => {
    const res = await app.request("/api/signals/export", asUser(A.userId, A.email));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    const lines = text.trim().split("\n");
    expect(lines[0]).toContain("Insight");
    expect(lines).toHaveLength(4); // header + 3 signals
    expect(text).toContain("pricing-one");
  });
});
