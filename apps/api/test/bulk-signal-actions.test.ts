import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { competitors, monitors, snapshots, changes, signals, qualityFeedback } from "@outrival/db";
import { eq, inArray } from "drizzle-orm";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, seedOrg } from "./app-harness";

// The bulk surface behind the signals feed's selection bar (`code:PER-40`). Track,
// snooze and dismiss each used to fire one request per selected row — and a
// shift-selected range spans every loaded page — so the fix is these endpoints. What
// has to hold is what the fan-out gave for free: each row's write is org-guarded, so
// a forged id in the list changes nothing, and every action's Undo is exact.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let resetDb: () => Promise<void>;

let A: { orgId: string; userId: string; email: string };
let B: { orgId: string; userId: string; email: string };

let mine: string[] = [];
let theirs = "";

let seq = 0;

// PGlite migrates the whole schema on first use, which runs past bun's 5s hook default.
const HOOK_TIMEOUT_MS = 30_000;

/** N signals for one org, each on its own change (signals.change_id is unique). */
async function seedSignals(orgId: string, count: number): Promise<string[]> {
  const n = ++seq;
  const competitorId = `bulk-cmp-${n}`;
  await testDb.insert(competitors).values({ id: competitorId, orgId, name: `Rival ${n}` });
  await testDb
    .insert(monitors)
    .values({ id: `bulk-mon-${n}`, competitorId, sourceType: "homepage" });
  await testDb
    .insert(snapshots)
    .values({ id: `bulk-snp-${n}`, monitorId: `bulk-mon-${n}`, r2Key: `bk-${n}`, contentHash: `bh-${n}` });

  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const k = ++seq;
    await testDb.insert(changes).values({
      id: `bulk-chg-${k}`,
      monitorId: `bulk-mon-${n}`,
      snapshotAfterId: `bulk-snp-${n}`,
    });
    await testDb.insert(signals).values({
      id: `bulk-sig-${k}`,
      changeId: `bulk-chg-${k}`,
      orgId,
      competitorId,
      severity: "medium",
      category: "product",
      insight: `bulk insight ${k}`,
    });
    ids.push(`bulk-sig-${k}`);
  }
  return ids;
}

const rowsOf = (ids: string[]) =>
  testDb.query.signals.findMany({ where: inArray(signals.id, ids) });

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb, reset: resetDb } = await makeTestDb());
  await installAppMocks(testDb);
  const { signalsRouter } = await import("../src/routes/signals");
  const { feedbackQualityRouter } = await import("../src/routes/feedback-quality");
  app = new Hono()
    .route("/api/signals", signalsRouter)
    .route("/api/feedback-quality", feedbackQualityRouter);
}, HOOK_TIMEOUT_MS);

// Per TEST, not per file. Every test here writes to `mine`, and four of them read a
// value a SIBLING left behind: an actionStatus of "doing", a feed total of 3, an
// empty qualityFeedback for the org. That only holds while bun runs a file in
// declaration order, so `bun test --randomize` turned four of these red on most
// seeds (`code:TES-76`). A truncate and a fresh seed per test cost ~30 ms each and
// remove the only reason the order mattered.
beforeEach(async () => {
  await resetDb();
  A = await seedOrg(testDb);
  B = await seedOrg(testDb);
  mine = await seedSignals(A.orgId, 3);
  [theirs = ""] = await seedSignals(B.orgId, 1);
});

const post = (path: string, who: typeof A, body: unknown) =>
  app.request(path, asUser(who.userId, who.email, { method: "POST", body: JSON.stringify(body) }));

describe("POST /api/signals/bulk-action", () => {
  test("one request triages the whole selection", async () => {
    const res = await post("/api/signals/bulk-action", A, { ids: mine, status: "todo" });
    expect(res.status).toBe(200);
    expect((await res.json()).count).toBe(3);
    const rows = await rowsOf(mine);
    expect(rows.map((r) => r.actionStatus)).toEqual(["todo", "todo", "todo"]);
    // Clearing is the same call with a null status — the "untrack" path.
    expect((await (await post("/api/signals/bulk-action", A, { ids: mine, status: null })).json()).count).toBe(3);
    expect((await rowsOf(mine)).every((r) => r.actionStatus === null)).toBe(true);
  });

  test("a foreign id in the list is not written", async () => {
    const res = await post("/api/signals/bulk-action", A, {
      ids: [...mine, theirs],
      status: "doing",
    });
    expect((await res.json()).count).toBe(3);
    const [foreign] = await rowsOf([theirs]);
    expect(foreign?.actionStatus).toBeNull();
  });

  test("an unknown status is refused before any write", async () => {
    await post("/api/signals/bulk-action", A, { ids: mine, status: "doing" });
    const res = await post("/api/signals/bulk-action", A, { ids: mine, status: "archived" });
    expect(res.status).toBe(400);
    // The value set just above is still there: nothing was half-applied.
    expect((await rowsOf(mine)).every((r) => r.actionStatus === "doing")).toBe(true);
  });

  test("an empty selection is a no-op, not an error", async () => {
    const res = await post("/api/signals/bulk-action", A, { ids: [], status: "done" });
    expect(res.status).toBe(200);
    expect((await res.json()).count).toBe(0);
  });
});

describe("POST /api/signals/bulk-snooze", () => {
  test("snoozes the selection out of the feed, and Undo brings it back", async () => {
    const until = new Date(Date.now() + 3600_000).toISOString();
    const res = await post("/api/signals/bulk-snooze", A, { ids: mine, until });
    expect((await res.json()).count).toBe(3);
    const feed = await (await app.request("/api/signals", asUser(A.userId, A.email))).json();
    expect(feed.total).toBe(0);

    // Undo is `until: null` over the same ids.
    expect((await (await post("/api/signals/bulk-snooze", A, { ids: mine, until: null })).json()).count).toBe(3);
    const back = await (await app.request("/api/signals", asUser(A.userId, A.email))).json();
    expect(back.total).toBe(3);
  });

  test("a moment already past is refused", async () => {
    const res = await post("/api/signals/bulk-snooze", A, {
      ids: mine,
      until: new Date(Date.now() - 1000).toISOString(),
    });
    expect(res.status).toBe(400);
  });

  test("another org's signal is not snoozed", async () => {
    await post("/api/signals/bulk-snooze", A, {
      ids: [theirs],
      until: new Date(Date.now() + 3600_000).toISOString(),
    });
    const [foreign] = await rowsOf([theirs]);
    expect(foreign?.snoozedUntil).toBeNull();
  });
});

describe("POST /api/feedback-quality/bulk", () => {
  test("one verdict hides the whole selection, bulk-delete un-hides it", async () => {
    const res = await post("/api/feedback-quality/bulk", A, {
      targetType: "signal",
      targetIds: mine,
      verdict: "not_useful",
      reason: "irrelevant",
    });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.feedbackIds).toHaveLength(3);
    expect(out.immediateAction?.type).toBe("signal_hidden");
    expect((await rowsOf(mine)).every((r) => r.hiddenForUserAt !== null)).toBe(true);

    const undo = await post("/api/feedback-quality/bulk-delete", A, { ids: out.feedbackIds });
    expect((await undo.json()).count).toBe(3);
    expect((await rowsOf(mine)).every((r) => r.hiddenForUserAt === null)).toBe(true);
    const left = await testDb.query.qualityFeedback.findMany({
      where: eq(qualityFeedback.orgId, A.orgId),
    });
    expect(left).toHaveLength(0);
  });

  test("the same target twice is one verdict, and a second pass replaces it", async () => {
    const first = await post("/api/feedback-quality/bulk", A, {
      targetType: "signal",
      targetIds: [mine[0]!, mine[0]!],
      verdict: "not_useful",
    });
    expect((await first.json()).feedbackIds).toHaveLength(1);

    // Upsert, not a second row: the unique index on (user, targetType, targetId) is
    // what every downstream count relies on.
    const again = await post("/api/feedback-quality/bulk", A, {
      targetType: "signal",
      targetIds: [mine[0]!],
      verdict: "useful",
    });
    expect((await again.json()).feedbackIds).toHaveLength(1);
    const rows = await testDb.query.qualityFeedback.findMany({
      where: eq(qualityFeedback.orgId, A.orgId),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verdict).toBe("useful");
    // Changing the verdict does not un-hide — same as the single-verdict route: only
    // DELETING the feedback reverts its action. Recorded here so the bulk path is not
    // read as having its own rule.
    expect((await rowsOf([mine[0]!]))[0]?.hiddenForUserAt).not.toBeNull();
  });

  test("another org's signal is not hidden by a forged id", async () => {
    await post("/api/feedback-quality/bulk", A, {
      targetType: "signal",
      targetIds: [theirs],
      verdict: "not_useful",
    });
    const [foreign] = await rowsOf([theirs]);
    expect(foreign?.hiddenForUserAt).toBeNull();
  });

  test("bulk-delete only cancels the caller's own verdicts", async () => {
    const mineRes = await post("/api/feedback-quality/bulk", A, {
      targetType: "signal",
      targetIds: [mine[1]!],
      verdict: "not_useful",
    });
    const { feedbackIds } = await mineRes.json();

    const res = await post("/api/feedback-quality/bulk-delete", B, { ids: feedbackIds });
    expect((await res.json()).count).toBe(0);
    expect((await rowsOf([mine[1]!]))[0]?.hiddenForUserAt).not.toBeNull();
  });
});
