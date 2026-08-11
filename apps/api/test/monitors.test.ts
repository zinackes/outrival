import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { resolve } from "node:path";
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { competitors, monitors, forcedRescanLog } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, installQueueMock, mountApp, seedOrg } from "./app-harness";

// POST /monitors/:id/force-rescan (patch-27) is a tenant-scoped, tier-limited
// trigger. Its two security gates — ownership (the monitor's competitor must be in
// the caller's org, not soft-deleted) and the per-tier daily cap — both short
// circuit BEFORE tasks.trigger, so the denial paths test without any worker. The
// trigger is mocked so the happy path can be exercised too (it records a log row).
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let resetDb: () => Promise<void>;
let A: { orgId: string; userId: string; email: string };
let B: { orgId: string; userId: string; email: string };
let C: { orgId: string; userId: string; email: string };
let D: { orgId: string; userId: string; email: string };
let E: { orgId: string; userId: string; email: string };
let aiCharges = 0;
let aiBudgetRefuses = false;

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb, reset: resetDb } = await makeTestDb());
  await installAppMocks(testDb);
  // Keep the job queue out of the test: a fixed job id, never a queue connection.
  installQueueMock();
  // The hourly AI-action budget lives in Upstash, which the tests don't run. Stand in
  // a counter so the route's OWN decision — charge a re-scan, never a first scrape —
  // is observable; `aiBudgetRefuses` flips it to a spent budget on demand.
  mock.module(resolve(import.meta.dir, "../src/lib/ai-actions"), () => ({
    consumeAiAction: async () => {
      aiCharges++;
      return aiBudgetRefuses
        ? { allowed: false, used: 999, limit: 120, retryAfterSeconds: 600 }
        : { allowed: true, used: aiCharges, limit: 120, retryAfterSeconds: 0 };
    },
    aiRateLimitBody: () => ({ error: "ai_rate_limit_exceeded" }),
    peekAiActions: async () => ({ used: aiCharges, limit: 120 }),
  }));
  const { monitorsRouter } = await import("../src/routes/monitors");
  app = mountApp("/api/monitors", monitorsRouter);
});

// Per test, not per file: the /run and force-rescan tests spend a per-day rescan cap
// and move lastRunAt, and the AI-budget stand-in counts charges — all state a later
// test reads as its own starting point.
beforeEach(async () => {
  await resetDb();
  aiCharges = 0;
  aiBudgetRefuses = false;

  A = await seedOrg(testDb, { plan: "free" });
  B = await seedOrg(testDb, { plan: "free" });
  // Pro org (cap 20) so the /run metering tests don't collide with A/B's spent free cap.
  C = await seedOrg(testDb, { plan: "pro" });
  // Fresh free org for the plan-gating tests, so its 1/day free rescan cap is unspent.
  D = await seedOrg(testDb, { plan: "free" });
  // Free org sitting OVER its competitor cap (2): the two oldest stay monitored, the
  // third is frozen. createdAt is explicit — the cap ranks by it, and rows inserted in
  // one statement share a timestamp.
  E = await seedOrg(testDb, { plan: "free" });
  await testDb.insert(competitors).values([
    { id: "c-a", orgId: A.orgId, name: "Rival A" },
    { id: "c-b", orgId: B.orgId, name: "Rival B" },
    { id: "c-del", orgId: A.orgId, name: "Gone", deletedAt: new Date() },
    { id: "c-c", orgId: C.orgId, name: "Rival C" },
    // A competitor with a URL so a retargeted monitor URL passes the brand-lock guard.
    { id: "c-d", orgId: C.orgId, name: "Rival D", url: "https://rival-d.com" },
    { id: "c-e", orgId: D.orgId, name: "Rival E" },
    { id: "c-f1", orgId: E.orgId, name: "Rival F1", createdAt: new Date(Date.now() - 3 * 86_400_000) },
    { id: "c-f2", orgId: E.orgId, name: "Rival F2", createdAt: new Date(Date.now() - 2 * 86_400_000) },
    { id: "c-f3", orgId: E.orgId, name: "Rival F3", createdAt: new Date(Date.now() - 86_400_000) },
  ]);
  await testDb.insert(monitors).values([
    // Already run → a force-rescan is a genuine (metered) re-scan.
    { id: "m-a", competitorId: "c-a", sourceType: "homepage", lastRunAt: new Date(Date.now() - 60_000) },
    { id: "m-b", competitorId: "c-b", sourceType: "homepage", lastRunAt: new Date(Date.now() - 60_000) },
    // Never run — a first scrape via force-rescan must be exempt even when B is at cap.
    { id: "m-b-fresh", competitorId: "c-b", sourceType: "pricing" },
    { id: "m-del", competitorId: "c-del", sourceType: "homepage" },
    // m-c-new was never scraped (first scrape, unmetered); m-c-ran already ran (re-scan, metered).
    { id: "m-c-new", competitorId: "c-c", sourceType: "homepage" },
    { id: "m-c-ran", competitorId: "c-c", sourceType: "pricing", lastRunAt: new Date(Date.now() - 60_000) },
    // Already-scraped monitors whose URL a PATCH will retarget (m-d-retarget) or
    // re-submit unchanged (m-d-same) — exercises the freshness-state reset.
    {
      id: "m-d-retarget",
      competitorId: "c-d",
      sourceType: "homepage",
      config: { url: "https://rival-d.com/home" },
      lastRunAt: new Date(Date.now() - 60_000),
      lastChangedAt: new Date(Date.now() - 60_000),
    },
    {
      id: "m-d-same",
      competitorId: "c-d",
      sourceType: "pricing",
      config: { url: "https://rival-d.com/pricing" },
      lastRunAt: new Date(Date.now() - 60_000),
    },
    // Auto-paused after a refusal, with a learned cascade level: retargeting its URL
    // must clear the whole diagnosis of the OLD page, not just the freshness stamps.
    {
      id: "m-d-broken",
      competitorId: "c-d",
      sourceType: "blog",
      config: { url: "https://rival-d.com/old-blog" },
      lastRunAt: new Date(Date.now() - 60_000),
      isActive: false,
      markedUnscrapable: true,
      consecutiveFailures: 3,
      requiresLevel: 2,
      requiresLevelSince: new Date(Date.now() - 86_400_000),
      refusedAt: new Date(Date.now() - 60_000),
      refusalReason: "blocked_403",
      lastFailureCategory: "anti_bot",
      lastFailureConfidence: "high",
      lastFailureEvidence: ["http:403"],
      lastFailureDiagnosedAt: new Date(Date.now() - 60_000),
      nextRunAt: new Date(Date.now() + 7 * 86_400_000),
    },
    // Paused BY THE USER (never auto-paused): retargeting must not silently
    // re-enable a source someone deliberately turned off.
    {
      id: "m-d-userpaused",
      competitorId: "c-d",
      sourceType: "changelog",
      config: { url: "https://rival-d.com/old-changelog" },
      lastRunAt: new Date(Date.now() - 60_000),
      isActive: false,
    },
    // Manual pause / enable target (starts active, with a far-future nextRunAt so
    // re-enabling can be seen to reset it to "due next tick").
    {
      id: "m-toggle",
      competitorId: "c-a",
      sourceType: "blog",
      nextRunAt: new Date(Date.now() + 7 * 86_400_000),
    },
    // Infra-only anchor — a manual toggle must refuse to flip it on.
    { id: "m-tech", competitorId: "c-a", sourceType: "tech_stack", isActive: false },
    // Always-on sources on the PRO org: `news` tops out at realtime (one cheap RSS
    // GET), `subdomains` at daily (crt.sh + up to 100 DNS probes per run). Seeded
    // weekly like seedCompetitorMonitors does — the column default is `daily`, which
    // is not what these rows are born with.
    { id: "m-c-news", competitorId: "c-c", sourceType: "news", frequency: "weekly" },
    { id: "m-c-subs", competitorId: "c-c", sourceType: "subdomains", frequency: "weekly" },
    // The same kind of source on the FREE org — the cadence control is pro+.
    { id: "m-e-auto", competitorId: "c-e", sourceType: "news", frequency: "weekly" },
    // Plan-gating fixtures on free org D. m-e-gated is a premium source (jobs, starter+)
    // frozen by the free plan; m-e-ungated is a free-tier source that must stay refreshable.
    { id: "m-e-gated", competitorId: "c-e", sourceType: "jobs", lastRunAt: new Date(Date.now() - 60_000) },
    { id: "m-e-ungated", competitorId: "c-e", sourceType: "homepage", lastRunAt: new Date(Date.now() - 60_000) },
    // Free-tier source on both sides of org E's competitor cap: m-f3 hangs off the
    // frozen competitor, m-f1 off an in-cap one (the control that must stay runnable).
    { id: "m-f3", competitorId: "c-f3", sourceType: "homepage", lastRunAt: new Date(Date.now() - 60_000) },
    { id: "m-f1", competitorId: "c-f1", sourceType: "homepage", lastRunAt: new Date(Date.now() - 60_000) },
  ]);
}, 30_000);

const patchMonitor = (
  u: { userId: string; email: string },
  monitorId: string,
  patch: Record<string, unknown>,
) =>
  app.request(
    `/api/monitors/${monitorId}`,
    asUser(u.userId, u.email, { method: "PATCH", body: JSON.stringify(patch) }),
  );

const rescan = (u: { userId: string; email: string }, monitorId: string) =>
  app.request(
    `/api/monitors/${monitorId}/force-rescan`,
    asUser(u.userId, u.email, { method: "POST" }),
  );

const run = (u: { userId: string; email: string }, monitorId: string) =>
  app.request(`/api/monitors/${monitorId}/run`, asUser(u.userId, u.email, { method: "POST" }));

describe("force-rescan ownership gate (short-circuits before trigger)", () => {
  test("unknown monitor id → 404", async () => {
    const res = await rescan(A, "does-not-exist");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Monitor not found");
  });

  test("IDOR: a foreign org cannot rescan another org's monitor → 403", async () => {
    const res = await rescan(B, "m-a");
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Forbidden");
  });

  test("a monitor on a soft-deleted competitor → 403", async () => {
    const res = await rescan(A, "m-del");
    expect(res.status).toBe(403);
  });
});

describe("force-rescan happy path", () => {
  test("owner under the cap → 200, logs the run with its task id", async () => {
    const res = await rescan(A, "m-a");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.usageToday).toBe(1);
    expect(body.dailyLimit).toBe(1); // free tier

    const logs = await testDb
      .select()
      .from(forcedRescanLog)
      .where(eq(forcedRescanLog.userId, A.userId));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.taskId).toBe("run_test");
    expect(logs[0]?.monitorId).toBe("m-a");
  });
});

describe("force-rescan per-tier daily cap", () => {
  test("at the cap → 429 rescan_limit_reached (before any trigger)", async () => {
    // Consume B's single free rescan up front, decoupled from the happy path.
    await testDb
      .insert(forcedRescanLog)
      .values({ userId: B.userId, orgId: B.orgId, monitorId: "m-b" });

    const res = await rescan(B, "m-b");
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("rescan_limit_reached");
  });

  test("first scrape via force-rescan is exempt from the cap (200, unmetered, no log)", async () => {
    // B is at its single free rescan (previous test), yet a never-run monitor is a
    // first scrape, not a re-scan — it bypasses the cap and logs nothing.
    const res = await rescan(B, "m-b-fresh");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metered).toBe(false);
    expect(body.rescanLogId).toBeNull();
    const logs = await testDb
      .select()
      .from(forcedRescanLog)
      .where(eq(forcedRescanLog.monitorId, "m-b-fresh"));
    expect(logs).toHaveLength(0);
  });
});

// patch-27 — POST /:id/run now meters genuine re-scans through the same cap + log as
// /force-rescan, but exempts a monitor's first scrape (just enabled, never run).
describe("run metering (counts re-scans, exempts first scrape)", () => {
  test("first scrape (never run) → 200, no forced_rescan_log row", async () => {
    const res = await run(C, "m-c-new");
    expect(res.status).toBe(200);
    const logs = await testDb
      .select()
      .from(forcedRescanLog)
      .where(eq(forcedRescanLog.monitorId, "m-c-new"));
    expect(logs).toHaveLength(0);
  });

  test("re-scan (already run) → 200, logs the run with its task id", async () => {
    const res = await run(C, "m-c-ran");
    expect(res.status).toBe(200);
    const logs = await testDb
      .select()
      .from(forcedRescanLog)
      .where(eq(forcedRescanLog.monitorId, "m-c-ran"));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.userId).toBe(C.userId);
    expect(logs[0]?.taskId).toBe("run_test");
  });

  // The hourly AI cap used to be middleware, so it charged the request before the
  // route could tell setup from consumption. Enabling every source on a pro roster is
  // maxCompetitors × allowedSources = 135 clicks; charging those made the ceiling
  // refuse the one burst it must not.
  test("a first scrape never spends the hourly AI budget", async () => {
    aiCharges = 0;
    await testDb.update(monitors).set({ lastRunAt: null }).where(eq(monitors.id, "m-c-new"));
    const res = await run(C, "m-c-new");
    expect(res.status).toBe(200);
    expect(aiCharges).toBe(0);
  });

  test("a re-scan spends it, and a spent budget refuses before the scrape", async () => {
    aiCharges = 0;
    await run(C, "m-c-ran");
    expect(aiCharges).toBe(1);

    aiBudgetRefuses = true;
    const res = await run(C, "m-c-ran");
    aiBudgetRefuses = false;
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("ai_rate_limit_exceeded");
  });
});

// Retargeting a monitor's URL invalidates its freshness state: the new page has
// never been scraped, so the next Run must count as a first scrape (unmetered),
// not a forced re-scan of the old page.
describe("PATCH url change resets freshness so the next run is a first scrape", () => {
  test("changing the URL nulls lastRunAt/lastChangedAt", async () => {
    const res = await patchMonitor(C, "m-d-retarget", { url: "https://rival-d.com/new-home" });
    expect(res.status).toBe(200);
    const [m] = await testDb
      .select()
      .from(monitors)
      .where(eq(monitors.id, "m-d-retarget"));
    expect(m?.config).toEqual({ url: "https://rival-d.com/new-home" });
    expect(m?.lastRunAt).toBeNull();
    expect(m?.lastChangedAt).toBeNull();
  });

  test("the subsequent run is unmetered (no forced_rescan_log row)", async () => {
    await patchMonitor(C, "m-d-retarget", { url: "https://rival-d.com/new-home" });

    const res = await run(C, "m-d-retarget");
    expect(res.status).toBe(200);
    const logs = await testDb
      .select()
      .from(forcedRescanLog)
      .where(eq(forcedRescanLog.monitorId, "m-d-retarget"));
    expect(logs).toHaveLength(0);
  });

  test("re-submitting the same URL keeps lastRunAt (still a metered re-scan)", async () => {
    const res = await patchMonitor(C, "m-d-same", { url: "https://rival-d.com/pricing" });
    expect(res.status).toBe(200);
    const [m] = await testDb.select().from(monitors).where(eq(monitors.id, "m-d-same"));
    expect(m?.lastRunAt).not.toBeNull();

    const runRes = await run(C, "m-d-same");
    expect(runRes.status).toBe(200);
    const logs = await testDb
      .select()
      .from(forcedRescanLog)
      .where(eq(forcedRescanLog.monitorId, "m-d-same"));
    expect(logs).toHaveLength(1);
  });
});

describe("PATCH url change clears the OLD page's failure state", () => {
  test("a refused, auto-paused source comes back on a new URL", async () => {
    const res = await patchMonitor(C, "m-d-broken", { url: "https://rival-d.com/blog" });
    expect(res.status).toBe(200);
    const [m] = await testDb.select().from(monitors).where(eq(monitors.id, "m-d-broken"));

    // Every judgement below was about the URL that just got replaced.
    expect(m?.markedUnscrapable).toBe(false);
    expect(m?.consecutiveFailures).toBe(0);
    expect(m?.refusedAt).toBeNull();
    expect(m?.refusalReason).toBeNull();
    expect(m?.lastFailureCategory).toBeNull();
    expect(m?.lastFailureConfidence).toBeNull();
    expect(m?.lastFailureEvidence).toBeNull();
    expect(m?.lastFailureDiagnosedAt).toBeNull();
    // Re-learn the cascade from the bottom. The doctrine's cascade is L0/L1/L2 only
    // — null restarts at L0 and can never land on a retired L3/L4 tier.
    expect(m?.requiresLevel).toBeNull();
    expect(m?.requiresLevelSince).toBeNull();
    // Our auto-pause is lifted, and the source is due on the next hourly tick —
    // no forced-rescan budget spent to verify the fix.
    expect(m?.isActive).toBe(true);
    expect(m?.nextRunAt).toBeNull();
  });

  test("the next scrape targets the new URL", async () => {
    await patchMonitor(C, "m-d-broken", { url: "https://rival-d.com/blog" });

    const [m] = await testDb.select().from(monitors).where(eq(monitors.id, "m-d-broken"));
    expect(m?.config).toEqual({ url: "https://rival-d.com/blog" });
  });

  test("a source the USER paused stays paused after a retarget", async () => {
    const res = await patchMonitor(C, "m-d-userpaused", { url: "https://rival-d.com/changelog" });
    expect(res.status).toBe(200);
    const [m] = await testDb.select().from(monitors).where(eq(monitors.id, "m-d-userpaused"));
    expect(m?.config).toEqual({ url: "https://rival-d.com/changelog" });
    expect(m?.isActive).toBe(false);
  });

  test("a frequency change in the same PATCH doesn't defer the first scrape", async () => {
    // computeNextRun would push it out by the OLD page's staleness multiplier.
    const res = await patchMonitor(C, "m-d-broken", {
      url: "https://rival-d.com/blog-v2",
      frequency: "weekly",
    });
    expect(res.status).toBe(200);
    const [m] = await testDb.select().from(monitors).where(eq(monitors.id, "m-d-broken"));
    expect(m?.frequency).toBe("weekly");
    expect(m?.nextRunAt).toBeNull();
  });
});

// The always-on sources are seeded on every plan and carry no toggle, so a cadence is
// the only thing they can hold. Two independent refusals guard it: the plan may have
// no say at all (pro+), and even a plan that does cannot ask a given endpoint for more
// than it tolerates.
describe("PATCH frequency on an always-on source", () => {
  test("pro moves an always-on source to daily → 200", async () => {
    const res = await patchMonitor(C, "m-c-subs", { frequency: "daily" });
    expect(res.status).toBe(200);
    const [m] = await testDb.select().from(monitors).where(eq(monitors.id, "m-c-subs"));
    expect(m?.frequency).toBe("daily");
    // A tighter cadence takes effect now, not after the previously-scheduled run.
    expect(m?.nextRunAt).not.toBeNull();
  });

  test("pro moves a same-day source to realtime → 200", async () => {
    const res = await patchMonitor(C, "m-c-news", { frequency: "realtime" });
    expect(res.status).toBe(200);
    const [m] = await testDb.select().from(monitors).where(eq(monitors.id, "m-c-news"));
    expect(m?.frequency).toBe("realtime");
  });

  test("realtime above the source's own ceiling → 400, whatever the plan", async () => {
    const res = await patchMonitor(C, "m-c-subs", { frequency: "realtime" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("frequency_above_source_max");
    expect(body.source).toBe("subdomains");
    expect(body.max).toBe("daily");
    const [m] = await testDb.select().from(monitors).where(eq(monitors.id, "m-c-subs"));
    expect(m?.frequency).toBe("weekly"); // untouched
  });

  test("below pro the control is locked → 403 plan_locked_feature", async () => {
    // `weekly` is on the free plan and within the source ceiling, so the ONLY gate
    // that can fire here is the feature one — which is the point.
    const res = await patchMonitor(D, "m-e-auto", { frequency: "weekly" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("plan_locked_feature");
    expect(body.feature).toBe("alwaysOnCadence");
    expect(body.plan).toBe("free");
  });

  test("a configurable source is untouched by the always-on ceiling", async () => {
    const res = await patchMonitor(C, "m-c-ran", { frequency: "realtime" });
    expect(res.status).toBe(200);
    const [m] = await testDb.select().from(monitors).where(eq(monitors.id, "m-c-ran"));
    expect(m?.frequency).toBe("realtime");
  });
});

describe("PATCH isActive — manual pause / enable of a single source", () => {
  test("IDOR: a foreign org cannot toggle another org's monitor → 403", async () => {
    const res = await patchMonitor(B, "m-toggle", { isActive: false });
    expect(res.status).toBe(403);
    const [m] = await testDb.select().from(monitors).where(eq(monitors.id, "m-toggle"));
    expect(m?.isActive).toBe(true); // untouched
  });

  test("pausing sets isActive=false (no reschedule)", async () => {
    const res = await patchMonitor(A, "m-toggle", { isActive: false });
    expect(res.status).toBe(200);
    const [m] = await testDb.select().from(monitors).where(eq(monitors.id, "m-toggle"));
    expect(m?.isActive).toBe(false);
    expect(m?.nextRunAt).not.toBeNull(); // pause leaves the schedule as-is
  });

  test("re-enabling sets isActive=true and makes it due next tick (nextRunAt null)", async () => {
    const res = await patchMonitor(A, "m-toggle", { isActive: true });
    expect(res.status).toBe(200);
    const [m] = await testDb.select().from(monitors).where(eq(monitors.id, "m-toggle"));
    expect(m?.isActive).toBe(true);
    expect(m?.nextRunAt).toBeNull();
  });

  test("infra-only anchor sources refuse the toggle → 400 source_not_toggleable", async () => {
    const res = await patchMonitor(A, "m-tech", { isActive: true });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("source_not_toggleable");
    const [m] = await testDb.select().from(monitors).where(eq(monitors.id, "m-tech"));
    expect(m?.isActive).toBe(false); // still off
  });
});

// A source frozen by a plan downgrade (its monitor row is kept, the scheduler just
// skips it) must not be refreshable on demand either — both /run and /force-rescan
// mirror the scheduler's plan gate. The gate short-circuits BEFORE metering, so a
// denied premium source never spends the org's forced-rescan cap.
describe("on-demand re-scan plan gate (premium source frozen on a downgraded plan)", () => {
  test("force-rescan of a gated source (jobs on free) → 403 plan_locked_source", async () => {
    const res = await rescan(D, "m-e-gated");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("plan_locked_source");
    expect(body.source).toBe("jobs");
    expect(body.plan).toBe("free");
    // The gate ran before metering — no log row was written.
    const logs = await testDb
      .select()
      .from(forcedRescanLog)
      .where(eq(forcedRescanLog.monitorId, "m-e-gated"));
    expect(logs).toHaveLength(0);
  });

  test("run of a gated source (jobs on free) → 403 plan_locked_source", async () => {
    const res = await run(D, "m-e-gated");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("plan_locked_source");
    expect(body.source).toBe("jobs");
    expect(body.plan).toBe("free");
  });

  test("force-rescan of an ungated source (homepage) on the same free org → 200", async () => {
    const res = await rescan(D, "m-e-ungated");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

// OUT-151 — the freeze one level up: a whole competitor over the plan's competitor
// cap. The scheduler skips every one of its sources, so a manual trigger must too,
// even on a source the plan does entitle. Otherwise a downgraded org keeps its
// over-cap competitors fresh by clicking, and the cap only bites the cron.
describe("on-demand re-scan plan gate (competitor frozen by the competitor cap)", () => {
  test("run on an over-cap competitor → 403 plan_limit_competitors", async () => {
    const res = await run(E, "m-f3");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("plan_limit_competitors");
    expect(body.limit).toBe(2); // free tier
    expect(body.used).toBe(3);
    expect(body.plan).toBe("free");
  });

  test("force-rescan on an over-cap competitor → 403, before any metering", async () => {
    const res = await rescan(E, "m-f3");
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("plan_limit_competitors");
    const logs = await testDb
      .select()
      .from(forcedRescanLog)
      .where(eq(forcedRescanLog.monitorId, "m-f3"));
    expect(logs).toHaveLength(0);
    expect(aiCharges).toBe(0);
  });

  test("the same source on an IN-CAP competitor of that org → 200", async () => {
    const res = await rescan(E, "m-f1");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

// The status endpoint is what the web hook polls to show a contextual toast. A
// failed forced re-scan must be distinguishable from "still running" and from a
// completed-but-uneventful re-scan — otherwise the client polls to timeout instead
// of surfacing the honest outcome (fix for the forced-rescan-failure gap).
describe("GET /force-rescan/:logId/status", () => {
  const status = (u: { userId: string; email: string }, logId: string) =>
    app.request(
      `/api/monitors/force-rescan/${logId}/status`,
      asUser(u.userId, u.email, { method: "GET" }),
    );

  test("a failed forced re-scan reports done:true, failed:true", async () => {
    const [log] = await testDb
      .insert(forcedRescanLog)
      .values({
        userId: A.userId,
        orgId: A.orgId,
        monitorId: "m-a",
        resultCapturedAt: new Date(),
        hadNewSignal: false,
        failed: true,
      })
      .returning();
    const res = await status(A, log!.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.done).toBe(true);
    expect(body.failed).toBe(true);
    expect(body.hadNewSignal).toBe(false);
  });

  test("a successful forced re-scan reports done:true, failed:false", async () => {
    const [log] = await testDb
      .insert(forcedRescanLog)
      .values({
        userId: A.userId,
        orgId: A.orgId,
        monitorId: "m-a",
        resultCapturedAt: new Date(),
        hadNewSignal: true,
      })
      .returning();
    const res = await status(A, log!.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.done).toBe(true);
    expect(body.failed).toBe(false);
  });

  test("a still-running forced re-scan reports done:false, failed:false", async () => {
    const [log] = await testDb
      .insert(forcedRescanLog)
      .values({ userId: A.userId, orgId: A.orgId, monitorId: "m-a" })
      .returning();
    const res = await status(A, log!.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.done).toBe(false);
    expect(body.failed).toBe(false);
  });
});
