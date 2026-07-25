import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { changes, competitors, monitors, snapshots } from "@outrival/db";
import { scrapeRuns } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

// Activity: the aggregates the rebuilt page opens on (the 24h strip and the
// per-day tallies) and the log's outcome-list / window filters. The tallies are
// the only source of "38 checks today" — the log itself pages through findings —
// so what they count, and for whose day, is worth locking.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;

let A: { orgId: string; userId: string; email: string };
let B: { orgId: string; userId: string; email: string };

let seq = 0;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// scrape_runs.recorded_at is a naive timestamp holding UTC wall-clock, and the
// routes compare it against `now() AT TIME ZONE 'UTC'`. Seeding through Drizzle
// writes the same shape the workers do, so the tests exercise the real contract.
function agoDate(ms: number): Date {
  return new Date(Date.now() - ms);
}

async function seedMonitor(
  competitorId: string,
  sourceType: "pricing" | "homepage",
): Promise<{ competitorId: string; monitorId: string }> {
  const monitorId = `mon-${++seq}`;
  await testDb.insert(monitors).values({ id: monitorId, competitorId, sourceType, frequency: "daily" });
  return { competitorId, monitorId };
}

async function seedCompetitor(orgId: string): Promise<{ competitorId: string; monitorId: string }> {
  const n = ++seq;
  const competitorId = `cmp-${n}`;
  await testDb.insert(competitors).values({
    id: competitorId,
    orgId,
    name: `Competitor ${n}`,
    url: `https://example-${n}.com`,
  });
  return seedMonitor(competitorId, "pricing");
}

// One run, plus the rows that make it read as a given outcome: a change row for
// "change", an older snapshot for anything that must not look like a baseline.
async function seedRun(opts: {
  competitorId: string;
  monitorId: string;
  ago: number;
  status: "success" | "no_change" | "failed";
  withChange?: boolean;
  withEarlierSnapshot?: boolean;
  sourceType?: string;
}): Promise<void> {
  const n = ++seq;
  const recordedAt = agoDate(opts.ago);
  await testDb.insert(scrapeRuns).values({
    monitorId: opts.monitorId,
    competitorId: opts.competitorId,
    sourceType: opts.sourceType ?? "pricing",
    status: opts.status,
    durationMs: 1000,
    recordedAt,
  });
  if (opts.withEarlierSnapshot) {
    await testDb.insert(snapshots).values({
      id: `snap-${n}`,
      monitorId: opts.monitorId,
      r2Key: `k-${n}`,
      contentHash: `h-${n}`,
      scrapedAt: new Date(recordedAt.getTime() - HOUR),
      status: "success",
    });
  }
  if (opts.withChange) {
    const beforeId = `snap-before-${n}`;
    const afterId = `snap-after-${n}`;
    await testDb.insert(snapshots).values([
      {
        id: beforeId,
        monitorId: opts.monitorId,
        r2Key: `kb-${n}`,
        contentHash: `hb-${n}`,
        scrapedAt: new Date(recordedAt.getTime() - 2 * HOUR),
        status: "success",
      },
      {
        id: afterId,
        monitorId: opts.monitorId,
        r2Key: `ka-${n}`,
        contentHash: `ha-${n}`,
        scrapedAt: recordedAt,
        status: "success",
      },
    ]);
    await testDb.insert(changes).values({
      id: `chg-${n}`,
      monitorId: opts.monitorId,
      snapshotBeforeId: beforeId,
      snapshotAfterId: afterId,
      diffText: "price moved",
      summary: `Change ${n}`,
      detectedAt: recordedAt,
    });
  }
}

beforeAll(async () => {
  const harness = await makeTestDb();
  testDb = harness.db;
  closeDb = harness.close;
  await installAppMocks(testDb);
  const { activityRouter } = await import("../src/routes/activity");
  app = mountApp("/api/activity", activityRouter);

  A = await seedOrg(testDb, { email: "a@example.com" });
  B = await seedOrg(testDb, { email: "b@example.com" });

  const a = await seedCompetitor(A.orgId);
  // Two hours ago: a change. Four hours ago: a refusal. Eight: a quiet run.
  await seedRun({ ...a, ago: 2 * HOUR, status: "success", withChange: true, withEarlierSnapshot: true });
  await seedRun({ ...a, ago: 4 * HOUR, status: "failed" });
  // Six hours ago: a baseline. It needs a monitor of its own — "first capture"
  // means no snapshot exists for THAT monitor before the run, and the runs above
  // already left some on theirs.
  const aBaseline = await seedMonitor(a.competitorId, "homepage");
  await seedRun({ ...aBaseline, ago: 6 * HOUR, status: "success" });
  await seedRun({ ...a, ago: 8 * HOUR, status: "no_change", withEarlierSnapshot: true });
  // Outside the 24h strip but inside the 15-day day window.
  await seedRun({ ...a, ago: 40 * HOUR, status: "no_change", withEarlierSnapshot: true });
  // An internal anchor: never user-facing, in any count.
  await seedRun({ ...a, ago: 3 * HOUR, status: "success", sourceType: "sitemap" });

  const b = await seedCompetitor(B.orgId);
  await seedRun({ ...b, ago: 1 * HOUR, status: "success", withChange: true, withEarlierSnapshot: true });
});

afterAll(async () => {
  await closeDb();
});

const sum = (rows: { checks: number }[]) => rows.reduce((n, r) => n + r.checks, 0);

describe("GET /api/activity/summary", () => {
  test("counts the last 24h into quarter-hour buckets, hidden sources excluded", async () => {
    const res = await app.request("/api/activity/summary?tzOffset=0", asUser(A.userId, A.email));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      buckets: { slot: number; checks: number; changes: number; failures: number }[];
    };

    // Four user-facing runs inside 24h; the sitemap anchor is not one of them.
    expect(sum(body.buckets)).toBe(4);
    expect(body.buckets.reduce((n, b) => n + b.changes, 0)).toBe(1);
    expect(body.buckets.reduce((n, b) => n + b.failures, 0)).toBe(1);
    // Slots count backwards from now, so a 2h-old run sits around slot 8 and every
    // slot is inside the drawn window.
    for (const b of body.buckets) {
      expect(b.slot).toBeGreaterThanOrEqual(0);
      expect(b.slot).toBeLessThan(96);
    }
  });

  test("day tallies split the four outcomes and reach back past 24h", async () => {
    const res = await app.request("/api/activity/summary?tzOffset=0", asUser(A.userId, A.email));
    const body = (await res.json()) as {
      days: {
        date: string;
        checks: number;
        changes: number;
        failures: number;
        firstCaptures: number;
      }[];
    };

    const total = body.days.reduce((n, d) => n + d.checks, 0);
    expect(total).toBe(5); // the 40h-old run included, the sitemap anchor still not
    expect(body.days.reduce((n, d) => n + d.changes, 0)).toBe(1);
    expect(body.days.reduce((n, d) => n + d.failures, 0)).toBe(1);
    // The 6h-old success has no earlier snapshot: it is a baseline capture.
    expect(body.days.reduce((n, d) => n + d.firstCaptures, 0)).toBe(1);
    // Newest day first, so the log can walk it straight down the page.
    expect([...body.days].sort((x, y) => y.date.localeCompare(x.date))).toEqual(body.days);
  });

  test("a timezone offset moves the day boundary", async () => {
    // UTC+14 is the furthest a viewer's day can run ahead of the server's. The
    // same runs are counted either way; only the day they land in may differ, and
    // it can never land EARLIER than the UTC one.
    const east = await app.request(
      "/api/activity/summary?tzOffset=-840",
      asUser(A.userId, A.email),
    );
    const utc = await app.request("/api/activity/summary?tzOffset=0", asUser(A.userId, A.email));
    const eastBody = (await east.json()) as { days: { date: string; checks: number }[] };
    const utcBody = (await utc.json()) as { days: { date: string; checks: number }[] };

    expect(sum(eastBody.days)).toBe(sum(utcBody.days));
    expect(eastBody.days[0]!.date >= utcBody.days[0]!.date).toBe(true);
  });

  test("is org-scoped", async () => {
    const res = await app.request("/api/activity/summary?tzOffset=0", asUser(B.userId, B.email));
    const body = (await res.json()) as { buckets: { checks: number }[] };
    // B sees its own single run, never A's five.
    expect(sum(body.buckets)).toBe(1);
  });

  test("requires a session", async () => {
    const res = await app.request("/api/activity/summary", asUser(null));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/activity/timeline", () => {
  test("accepts a comma-separated outcome list", async () => {
    const res = await app.request(
      "/api/activity/timeline?status=change,failed",
      asUser(A.userId, A.email),
    );
    const body = (await res.json()) as {
      events: { status: string; changeId: string | null }[];
      total: number;
    };
    expect(body.total).toBe(2);
    expect(body.events).toHaveLength(2);
    // Exactly the change and the refusal — no baseline, no quiet run.
    expect(body.events.some((e) => e.status === "failed")).toBe(true);
    expect(body.events.some((e) => e.changeId)).toBe(true);
  });

  test("first_capture and no_change stay distinguishable", async () => {
    const first = await app.request(
      "/api/activity/timeline?status=first_capture",
      asUser(A.userId, A.email),
    );
    const quiet = await app.request(
      "/api/activity/timeline?status=no_change",
      asUser(A.userId, A.email),
    );
    const firstBody = (await first.json()) as { events: { isFirstCapture: boolean }[]; total: number };
    const quietBody = (await quiet.json()) as { total: number };
    expect(firstBody.total).toBe(1);
    expect(firstBody.events[0]!.isFirstCapture).toBe(true);
    expect(quietBody.total).toBe(2); // 8h and 40h old
  });

  test("from/to bound the window", async () => {
    const from = new Date(Date.now() - 5 * HOUR).toISOString();
    const to = new Date(Date.now() - 1 * HOUR).toISOString();
    const res = await app.request(
      `/api/activity/timeline?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      asUser(A.userId, A.email),
    );
    const body = (await res.json()) as { events: { recordedAt: string }[]; total: number };
    // The 2h change and the 4h refusal; the 6h baseline is older than `from`.
    expect(body.total).toBe(2);
    for (const e of body.events) {
      const t = new Date(e.recordedAt).getTime();
      expect(t).toBeGreaterThanOrEqual(new Date(from).getTime());
      expect(t).toBeLessThan(new Date(to).getTime());
    }
  });

  test("an unparseable window is ignored rather than returning nothing", async () => {
    const res = await app.request("/api/activity/timeline?from=yesterday", asUser(A.userId, A.email));
    const body = (await res.json()) as { total: number };
    expect(body.total).toBe(5);
  });
});
