import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { makeTestDb, schema, type TestDb } from "./db-harness";

/**
 * Content Intelligence v2 P5 — roadmap intelligence, end to end against a real
 * (in-process) Postgres: the same migrations, the same enum, the same unique
 * indexes as production.
 *
 * What is worth asserting here is mostly what did NOT happen. The parsing and the
 * ranking are owned by the pure modules (roadmap-status.test.ts,
 * roadmap-signals.test.ts); this file is about the rules that only show themselves
 * as a signal that never fired: the first read of a portal, a portal nobody votes
 * on, a status that flaps, and a copy edit to a column name.
 *
 * It also pins the phase's cost claim: the AI module is mocked with a counter, and
 * every roadmap path here must leave it at zero.
 *
 * mock.module is PROCESS-GLOBAL in Bun. This file re-points @outrival/db at its own
 * PGlite in beforeAll, exactly as its siblings do; files run in sequence, so each
 * installs its own before its tests.
 */

let testDb: TestDb;
let closeDb: () => Promise<void>;
let runIngest: (payload: {
  snapshotId: string;
  competitorId: string;
  sourceType: "changelog" | "roadmap";
  changeId?: string;
  lexicalWorth?: boolean;
}) => Promise<Record<string, unknown>>;

interface Enqueued {
  changeId: string;
  classification: {
    category: string;
    severity: string;
    reason: string;
    humanChangeBefore: string | null;
    humanChangeAfter: string;
  };
}
let enqueued: Enqueued[] = [];
let classified: string[] = [];
/** Every model call the run made. The phase claims none; this is the proof. */
let aiCalls = 0;
/** r2Key → html of the capture under test. */
let objects = new Map<string, string>();

const PORTAL = "https://rival.com/roadmap";

interface Entry {
  id: string;
  title: string;
  status: string;
  votes: number;
  url?: string | null;
}

/** The capture a roadmap scrape writes: a JSON island beside the diffed body. */
function capture(entries: Entry[]): string {
  const island = JSON.stringify({
    url: PORTAL,
    vendor: "canny",
    entries: entries.map((e) => ({
      id: e.id,
      title: e.title,
      status: e.status,
      url: e.url ?? `${PORTAL}/p/${e.id}`,
      votes: e.votes,
    })),
  }).replace(/</g, "\\u003c");
  return `<!doctype html><html><body><section>roadmap</section><script type="application/json" id="outrival-roadmap">${island}</script></body></html>`;
}

beforeAll(async () => {
  const realQueue = await import("@outrival/queue");
  const realShared = await import("@outrival/shared");
  const realAi = await import("@outrival/ai");
  const realAnalytics = await import("../src/lib/analytics");
  const harness = await makeTestDb();
  testDb = harness.db;
  closeDb = harness.close;

  mock.module("@outrival/db", () => ({ ...schema, db: harness.db }));
  mock.module("@outrival/queue", () => ({
    ...realQueue,
    NonRetriable: realQueue.NonRetriable,
    generateSignal: {
      queue: "generate-signal",
      enqueue: async (payload: Enqueued) => {
        enqueued.push(payload);
        return "job-id";
      },
    },
    classifyChange: {
      queue: "classify-change",
      enqueue: async (payload: { changeId: string }) => {
        classified.push(payload.changeId);
        return "job-id";
      },
    },
  }));
  mock.module("@outrival/shared", () => ({
    ...realShared,
    getFromR2: async (key: string) => objects.get(key) ?? "",
    uploadToR2: async () => undefined,
  }));
  mock.module("@outrival/ai", () => ({
    ...realAi,
    typeContentItems: async (batch: ReadonlyArray<{ title: string }>) => {
      aiCalls++;
      return { items: batch.map((_, index) => ({ index, item_type: "feature", summary: "" })) };
    },
  }));
  // Spread the REAL module: mock.module replaces it process-globally, and the
  // files that run after this one read other exports off it (getHiringMetricsHistory,
  // getArchivedPricingBatchTimes). Returning only `loggedAi` makes THEIR imports a
  // SyntaxError, in a file that has nothing to do with this one.
  mock.module("../src/lib/analytics", () => ({
    ...realAnalytics,
    loggedAi: async <T>(_task: string, _cfg: unknown, fn: () => Promise<T>) => fn(),
  }));

  ({ runIngestContentItems: runIngest } = await import("../src/core/ingest-content-items"));
});

afterAll(() => closeDb());
beforeEach(() => {
  enqueued = [];
  classified = [];
  aiCalls = 0;
  objects = new Map();
});

let seq = 0;

/** One org, one competitor with a roadmap monitor, and a capture to read. */
async function seed(options: { type?: "competitor" | "self" } = {}) {
  const n = ++seq;
  const orgId = `org-${n}`;
  const competitorId = `cmp-${n}`;
  const monitorId = `mon-${n}`;

  await testDb
    .insert(schema.organizations)
    .values({ id: orgId, name: `Org ${n}`, slug: `org-${n}` });
  await testDb.insert(schema.competitors).values({
    id: competitorId,
    orgId,
    name: "Rival",
    url: "https://rival.com",
    type: options.type ?? "competitor",
  });
  await testDb
    .insert(schema.monitors)
    .values({ id: monitorId, competitorId, sourceType: "roadmap" });

  return { orgId, competitorId, monitorId };
}

/** Store a capture and run the ingestion over it. */
async function ingest(
  ctx: { competitorId: string; monitorId: string },
  entries: Entry[],
  options: { withChange?: boolean; lexicalWorth?: boolean } = {},
) {
  const n = ++seq;
  const snapshotId = `snap-${n}`;
  const r2Key = `key-${n}`;
  objects.set(`${r2Key}.html`, capture(entries));
  await testDb
    .insert(schema.snapshots)
    .values({ id: snapshotId, monitorId: ctx.monitorId, r2Key, contentHash: `h-${n}` });

  let changeId: string | undefined;
  if (options.withChange) {
    changeId = `chg-${n}`;
    await testDb.insert(schema.changes).values({
      id: changeId,
      monitorId: ctx.monitorId,
      snapshotAfterId: snapshotId,
      diffText: "- [under review] X\n+ [planned] X",
      diffType: "text",
    });
  }

  return await runIngest({
    snapshotId,
    competitorId: ctx.competitorId,
    sourceType: "roadmap",
    changeId,
    lexicalWorth: options.lexicalWorth,
  });
}

const events = (competitorId: string) =>
  testDb
    .select()
    .from(schema.roadmapStatusEvents)
    .where(eq(schema.roadmapStatusEvents.competitorId, competitorId));

const items = (competitorId: string) =>
  testDb
    .select()
    .from(schema.contentItems)
    .where(eq(schema.contentItems.competitorId, competitorId));

describe("the first read of a portal is a baseline", () => {
  test("thirty entries are recorded and NOTHING is announced", async () => {
    const ctx = await seed();
    const entries: Entry[] = Array.from({ length: 30 }, (_, i) => ({
      id: `e${i}`,
      title: `Request ${i}`,
      // Half of them have been "Planned" since long before we arrived.
      status: i % 2 === 0 ? "Planned" : "Under review",
      votes: 200 - i,
    }));

    const result = await ingest(ctx, entries);

    expect(result.baseline).toBe(true);
    expect(enqueued).toHaveLength(0);
    const rows = await events(ctx.competitorId);
    expect(rows).toHaveLength(30);
    expect(rows.every((r) => r.isBaseline === 1)).toBe(true);
    expect(rows.every((r) => r.fromStatus === null)).toBe(true);
    // The rows themselves ARE the point of the pass.
    const stored = await items(ctx.competitorId);
    expect(stored).toHaveLength(30);
    expect(stored.find((s) => s.externalId === "e0")?.votes).toBe(200);
    expect(stored.find((s) => s.externalId === "e0")?.statusNormalized).toBe("planned");
    expect(stored.find((s) => s.externalId === "e1")?.statusNormalized).toBe("under_review");
  });

  test("a roadmap capture spends nothing on the model", async () => {
    const ctx = await seed();
    await ingest(ctx, [{ id: "a", title: "SSO / SAML", status: "Under review", votes: 40 }]);
    expect(aiCalls).toBe(0);
  });
});

describe("a top request moving into committed work", () => {
  const portal = (topStatus: string): Entry[] => [
    { id: "sso", title: "SSO / SAML", status: topStatus, votes: 142 },
    { id: "api", title: "Public API", status: "Under review", votes: 90 },
    { id: "dark", title: "Dark mode", status: "Under review", votes: 12 },
  ];

  test("their #1 request becoming planned is a HIGH signal that quotes their numbers", async () => {
    const ctx = await seed();
    await ingest(ctx, portal("Under review")); // baseline
    enqueued = [];

    await ingest(ctx, portal("Planned"), { withChange: true });

    expect(enqueued).toHaveLength(1);
    const signal = enqueued[0]!;
    expect(signal.classification.category).toBe("product");
    expect(signal.classification.severity).toBe("high");
    expect(signal.classification.reason).toBe(
      'Top request moves to planned — "SSO / SAML" (142 votes, #1)',
    );
    // The portal's own words on both sides, not our vocabulary. Lowercased at
    // capture time by the adapters (a P1 decision — the snapshot line reads
    // "[planned] SSO / SAML"), so what travels here is exactly what is diffed.
    expect(signal.classification.humanChangeBefore).toBe("under review");
    expect(signal.classification.humanChangeAfter).toBe("planned — 142 votes (#1)");
    expect(aiCalls).toBe(0);
  });

  test("it rides the portal's OWN change row, so the classifier is not also run", async () => {
    const ctx = await seed();
    await ingest(ctx, portal("Under review"));
    enqueued = [];
    classified = [];

    await ingest(ctx, portal("Planned"), { withChange: true, lexicalWorth: true });

    expect(enqueued).toHaveLength(1);
    // signals.changeId is unique: two writers on one change would lose one silently.
    expect(classified).toHaveLength(0);
    expect(enqueued[0]!.changeId).toMatch(/^chg-/);
  });

  test("with no change row of its own it falls back to the synthetic anchor", async () => {
    const ctx = await seed();
    await ingest(ctx, portal("Under review"));
    enqueued = [];

    await ingest(ctx, portal("Planned")); // no change row this time

    expect(enqueued).toHaveLength(1);
    const anchor = await testDb
      .select()
      .from(schema.monitors)
      .where(
        and(
          eq(schema.monitors.competitorId, ctx.competitorId),
          eq(schema.monitors.sourceType, "roadmap_shift"),
        ),
      );
    expect(anchor).toHaveLength(1);
    // Never scheduled, never scraped.
    expect(anchor[0]!.isActive).toBe(false);
  });

  test("the move is stamped, so a status that flaps cannot alert twice", async () => {
    const ctx = await seed();
    await ingest(ctx, portal("Under review"));
    await ingest(ctx, portal("Planned"), { withChange: true });
    enqueued = [];

    // Bounced back, then forward again inside the cooldown.
    await ingest(ctx, portal("Under review"), { withChange: true });
    await ingest(ctx, portal("Planned"), { withChange: true });

    expect(enqueued).toHaveLength(0);
    const stamped = (await events(ctx.competitorId)).filter((e) => e.signalledAt !== null);
    expect(stamped).toHaveLength(1);
  });

  test("a deferred change with no deterministic emission goes back to the classifier", async () => {
    const ctx = await seed();
    await ingest(ctx, portal("Under review"));
    classified = [];

    // Dark mode moves; it is rank 3 but only carries 12 votes, over the floor —
    // so this DOES signal. Move the one that cannot instead: nothing at all.
    const quiet: Entry[] = [
      { id: "sso", title: "SSO / SAML", status: "Under review", votes: 142 },
      { id: "api", title: "Public API", status: "Under review", votes: 90 },
      { id: "dark", title: "Dark mode", status: "Under review", votes: 12 },
      { id: "tiny", title: "Tooltip copy", status: "Planned", votes: 1 },
    ];
    await ingest(ctx, quiet, { withChange: true, lexicalWorth: true });

    expect(enqueued).toHaveLength(0);
    expect(classified).toHaveLength(1);
  });
});

describe("the bar", () => {
  test("a portal where the loudest request has six votes never signals", async () => {
    const ctx = await seed();
    const quiet = (status: string): Entry[] => [
      { id: "a", title: "Nice to have", status, votes: 6 },
      { id: "b", title: "Another", status: "Under review", votes: 3 },
    ];
    await ingest(ctx, quiet("Under review"));
    enqueued = [];

    await ingest(ctx, quiet("Planned"), { withChange: true });

    expect(enqueued).toHaveLength(0);
  });

  test("rank 4 does not signal, however loud the portal is", async () => {
    const ctx = await seed();
    const portal = (fourth: string): Entry[] => [
      { id: "a", title: "One", status: "Under review", votes: 500 },
      { id: "b", title: "Two", status: "Under review", votes: 400 },
      { id: "c", title: "Three", status: "Under review", votes: 300 },
      { id: "d", title: "Four", status: fourth, votes: 200 },
    ];
    await ingest(ctx, portal("Under review"));
    enqueued = [];

    await ingest(ctx, portal("Planned"), { withChange: true });

    expect(enqueued).toHaveLength(0);
  });

  test("#1 with modest support is medium, not high", async () => {
    const ctx = await seed();
    const portal = (status: string): Entry[] => [
      { id: "a", title: "Bulk export", status, votes: 20 },
      { id: "b", title: "Other", status: "Under review", votes: 4 },
    ];
    await ingest(ctx, portal("Under review"));
    enqueued = [];

    await ingest(ctx, portal("In progress"), { withChange: true });

    expect(enqueued[0]!.classification.severity).toBe("medium");
  });

  test("a refusal is never read as a commitment", async () => {
    const ctx = await seed();
    const portal = (status: string): Entry[] => [
      { id: "a", title: "Offline mode", status, votes: 300 },
      { id: "b", title: "Other", status: "Under review", votes: 4 },
    ];
    await ingest(ctx, portal("Under review"));
    enqueued = [];

    await ingest(ctx, portal("Not planned"), { withChange: true });

    expect(enqueued).toHaveLength(0);
    const moved = (await events(ctx.competitorId)).find((e) => e.toStatus === "closed");
    expect(moved?.toRaw).toBe("not planned");
  });
});

describe("what is not a move", () => {
  test("a column renamed around the same meaning writes no event", async () => {
    const ctx = await seed();
    await ingest(ctx, [{ id: "a", title: "SSO", status: "Planned", votes: 90 }]);
    const before = (await events(ctx.competitorId)).length;

    await ingest(ctx, [{ id: "a", title: "SSO", status: "Planned (Q3)", votes: 95 }], {
      withChange: true,
    });

    expect((await events(ctx.competitorId)).length).toBe(before);
    expect(enqueued).toHaveLength(0);
    // The refreshed count still lands — it is read for ranking, not for the diff.
    const [row] = await items(ctx.competitorId);
    expect(row?.votes).toBe(95);
  });

  test("an entry the portal dropped keeps the last state we saw", async () => {
    const ctx = await seed();
    await ingest(ctx, [
      { id: "a", title: "Kept", status: "Planned", votes: 90 },
      { id: "b", title: "Dropped", status: "Under review", votes: 40 },
    ]);

    await ingest(ctx, [{ id: "a", title: "Kept", status: "Planned", votes: 91 }], {
      withChange: true,
    });

    const stored = await items(ctx.competitorId);
    expect(stored).toHaveLength(2);
    expect(stored.find((s) => s.externalId === "b")?.votes).toBe(40);
  });
});

describe("our own product", () => {
  test("rows are written and nothing is announced", async () => {
    const ctx = await seed({ type: "self" });
    const portal = (status: string): Entry[] => [
      { id: "a", title: "SSO", status, votes: 300 },
      { id: "b", title: "Other", status: "Under review", votes: 4 },
    ];
    await ingest(ctx, portal("Under review"));
    enqueued = [];

    await ingest(ctx, portal("Planned"), { withChange: true });

    expect(enqueued).toHaveLength(0);
    expect((await items(ctx.competitorId)).length).toBe(2);
  });
});
