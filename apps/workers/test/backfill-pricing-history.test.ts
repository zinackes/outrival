import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";
import { makeTestDb, schema, type TestDb } from "./db-harness";

// Pricing Intelligence P5 — the Wayback price backfill, against a real
// (in-process) Postgres and a mocked Archive.
//
// The assertion this file exists for is the NEGATIVE one: a complete backfill
// writes pricing history and NOTHING else — no change row, no signal, no
// enqueue. That guarantee is invisible to anyone reading the feed (a signal that
// was never emitted leaves no trace), so it has to be mechanical rather than
// trusted. Everything else here — the AI cap, per-capture dedup, the plausibility
// drop — is checked in the same run because they share the fixture.
//
// mock.module is PROCESS-GLOBAL in Bun. This file re-points @outrival/db at its
// own PGlite in beforeAll, exactly as classify-change-gate.test.ts does; files
// run in sequence, so each installs its own before its tests. Check that still
// holds before adding a third.

let testDb: TestDb;
let closeDb: () => Promise<void>;
let runBackfill: (payload: {
  competitorId: string;
  url?: string;
  force?: boolean;
}) => Promise<{ batchesWritten?: number; skipped?: string; aiCalls?: number }>;

let enqueued: Array<{ queue: string; payload: unknown }> = [];
let aiCalls = 0;
/** Set by a test to make the AI stage answer; null = it returns nothing. */
let aiPlans: Array<Record<string, unknown>> | null = null;

const CDX_HEADER = ["timestamp", "statuscode", "digest"];

// fetchArchivedRaw rejects an implausibly small body (a stub / soft error), so
// every fixture here is a page-sized page rather than a snippet.
const CHROME = `<header><nav><a href="/">Home</a><a href="/pricing">Pricing</a>
  <a href="/docs">Docs</a><a href="/blog">Blog</a></nav></header>
  <footer><p>All prices exclude VAT. Cancel at any time from your account.</p>
  <p>Questions about billing? Our team answers within one business day.</p></footer>`;

/** A page the deterministic harvest reads cleanly — no AI needed. */
const pricingPage = (starter: number, pro: number) => `<html><body>
  ${CHROME}
  <main>
    <h1>Plans</h1>
    <div class="card"><h3>Starter</h3><span class="price">$${starter}/mo</span></div>
    <div class="card"><h3>Pro</h3><span class="price">$${pro}/mo</span></div>
  </main>
</body></html>`;

/** A page with no harvestable price: the case that reaches the AI fallback. */
const quotePage = `<html><body>
  ${CHROME}
  <main><h1>Pricing</h1>
  <p>Every deployment is different, so we quote each one. Talk to our team and we
  will put together a plan that matches the way you actually work.</p>
  <a href="/demo">Contact sales</a></main>
</body></html>`;

/** Captures the Archive will report, newest last. */
let cdxRows: string[][] = [];
/** waybackTimestamp → body served for that capture (null = unreachable). */
let archived = new Map<string, string | null>();

function installFetch() {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/cdx/search/cdx")) {
      return new Response(JSON.stringify([CDX_HEADER, ...cdxRows]), { status: 200 });
    }
    const ts = url.match(/\/web\/(\d{14})id_\//)?.[1];
    const body = ts ? archived.get(ts) : undefined;
    if (!body) return new Response("nope", { status: 404 });
    return new Response(body, { status: 200 });
  }) as typeof fetch;
}

beforeAll(async () => {
  const realQueue = await import("@outrival/queue");
  const harness = await makeTestDb();
  testDb = harness.db;
  closeDb = harness.close;


  // Every enqueue is recorded rather than performed: "no signal" means no
  // classify-change and no generate-signal reached the queue either.
  const stub = (queue: string) => ({
    queue,
    enqueue: async (payload: unknown) => {
      enqueued.push({ queue, payload });
      return "job-id";
    },
  });
  mock.module("@outrival/queue", () => ({
    ...realQueue,
    NonRetriable: realQueue.NonRetriable,
    classifyChange: stub("classify-change"),
    generateSignal: stub("generate-signal"),
    extractPricing: stub("extract-pricing"),
    backfillPricingHistory: stub("backfill-pricing-history"),
  }));

  const realAi = await import("@outrival/ai");
  mock.module("@outrival/ai", () => ({
    ...realAi,
    extractPricing: async () => {
      aiCalls++;
      return aiPlans ? { plans: aiPlans } : null;
    },
  }));

  ({ runBackfillPricingHistory: runBackfill } = await import(
    "../src/core/backfill-pricing-history"
  ));
});

afterAll(async () => {
  await closeDb();
});

let seq = 0;
async function seedCompetitor(type: "competitor" | "self" = "competitor"): Promise<string> {
  const n = ++seq;
  const orgId = `org-${n}`;
  const competitorId = `cmp-${n}`;
  await testDb
    .insert(schema.organizations)
    .values({ id: orgId, name: `Org ${n}`, slug: `org-${n}` });
  await testDb
    .insert(schema.competitors)
    .values({ id: competitorId, orgId, name: `Competitor ${n}`, type });
  await testDb
    .insert(schema.monitors)
    .values({ id: `mon-${n}`, competitorId, sourceType: "pricing" });
  return competitorId;
}

beforeEach(() => {
  enqueued = [];
  aiCalls = 0;
  aiPlans = null;
  cdxRows = [];
  archived = new Map();
  installFetch();
  process.env.PRICING_BACKFILL_GAP_MS = "1";
});

describe("backfill-pricing-history", () => {
  test("writes one archive-marked batch per capture, and nothing else", async () => {
    const competitorId = await seedCompetitor();
    cdxRows = [
      ["20240115000000", "200", "a"],
      ["20240715000000", "200", "b"],
    ];
    archived.set("20240115000000", pricingPage(9, 29));
    archived.set("20240715000000", pricingPage(12, 39));

    const result = await runBackfill({ competitorId, url: "https://x.test/pricing" });
    expect(result.batchesWritten).toBe(2);

    const rows = await testDb
      .select()
      .from(schema.pricingHistory)
      .where(eq(schema.pricingHistory.competitorId, competitorId));
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.origin === "archive")).toBe(true);
    // recorded_at IS the capture date — that is what makes it a timeline.
    const stamps = [...new Set(rows.map((r) => r.recordedAt.toISOString().slice(0, 10)))].sort();
    expect(stamps).toEqual(["2024-01-15", "2024-07-15"]);

    // The guarantee: history only.
    expect(await testDb.select().from(schema.changes)).toHaveLength(0);
    expect(await testDb.select().from(schema.signals)).toHaveLength(0);
    expect(enqueued).toEqual([]);
    expect(aiCalls).toBe(0);
  });

  test("a second run writes nothing: one backfill per competitor", async () => {
    const competitorId = await seedCompetitor();
    cdxRows = [["20240115000000", "200", "a"]];
    archived.set("20240115000000", pricingPage(9, 29));

    await runBackfill({ competitorId, url: "https://x.test/pricing" });
    const again = await runBackfill({ competitorId, url: "https://x.test/pricing" });
    expect(again.skipped).toBe("already_backfilled");

    const rows = await testDb
      .select()
      .from(schema.pricingHistory)
      .where(eq(schema.pricingHistory.competitorId, competitorId));
    expect(rows).toHaveLength(2);
  });

  test("a forced re-run still refuses to write the same capture twice", async () => {
    const competitorId = await seedCompetitor();
    cdxRows = [["20240115000000", "200", "a"]];
    archived.set("20240115000000", pricingPage(9, 29));

    await runBackfill({ competitorId, url: "https://x.test/pricing" });
    const forced = await runBackfill({ competitorId, url: "https://x.test/pricing", force: true });
    expect(forced.batchesWritten).toBe(0);

    const rows = await testDb
      .select()
      .from(schema.pricingHistory)
      .where(eq(schema.pricingHistory.competitorId, competitorId));
    expect(rows).toHaveLength(2);
  });

  test("the AI is a capped fallback, and a capped-out capture is skipped, not half-read", async () => {
    const competitorId = await seedCompetitor();
    process.env.PRICING_BACKFILL_MAX_AI_CALLS = "1";
    aiPlans = [
      { plan_name: "Pro", price: 49, currency: "USD", billing_period: "monthly" },
    ];
    // Two captures with no harvestable price → both want the AI, only one gets it.
    cdxRows = [
      ["20240115000000", "200", "a"],
      ["20240715000000", "200", "b"],
    ];
    archived.set("20240115000000", quotePage);
    archived.set("20240715000000", quotePage);

    const result = await runBackfill({ competitorId, url: "https://x.test/pricing" });
    expect(aiCalls).toBe(1);
    expect(result.batchesWritten).toBe(1);
    process.env.PRICING_BACKFILL_MAX_AI_CALLS = "";
  });

  test("a capture nothing can read writes no batch, and the run still succeeds", async () => {
    // The archived shell of a JS-rendered pricing page: real text, no price the
    // harvest can reach, and an AI that finds nothing either. A batch of zero
    // plans here would read on the chart as "that quarter they published nothing".
    const competitorId = await seedCompetitor();
    process.env.PRICING_BACKFILL_MAX_AI_CALLS = "2";
    aiPlans = null;
    cdxRows = [["20240115000000", "200", "a"]];
    archived.set("20240115000000", quotePage);

    const result = await runBackfill({ competitorId, url: "https://x.test/pricing" });
    expect(aiCalls).toBe(1);
    expect(result.batchesWritten).toBe(0);
    expect(result.snapshotsRead).toBe(1);
    process.env.PRICING_BACKFILL_MAX_AI_CALLS = "";
  });

  test("an implausible old capture is dropped rather than plotted", async () => {
    const competitorId = await seedCompetitor();
    process.env.PRICING_BACKFILL_MAX_AI_CALLS = "2";
    // A yearly cheaper than the same plan's monthly cannot both be true.
    aiPlans = [
      { plan_name: "Pro", price: 49, currency: "USD", billing_period: "monthly" },
      { plan_name: "Pro", price: 20, currency: "USD", billing_period: "yearly" },
    ];
    cdxRows = [["20240115000000", "200", "a"]];
    archived.set("20240115000000", quotePage);

    const result = await runBackfill({ competitorId, url: "https://x.test/pricing" });
    expect(result.batchesWritten).toBe(0);
    expect(
      await testDb
        .select()
        .from(schema.pricingHistory)
        .where(eq(schema.pricingHistory.competitorId, competitorId)),
    ).toHaveLength(0);
    process.env.PRICING_BACKFILL_MAX_AI_CALLS = "";
  });

  test("an archived challenge page never becomes a batch of zero plans", async () => {
    const competitorId = await seedCompetitor();
    cdxRows = [["20240115000000", "200", "a"]];
    archived.set(
      "20240115000000",
      `<html><head><title>Just a moment...</title></head><body>
       <div id="cf-challenge-running">Checking your browser before accessing the site.
       This process is automatic. Your browser will redirect to $9 requested content
       shortly. Please allow up to five seconds. DDoS protection by Cloudflare.
       Ray ID: 8f2a1c9d4e5b6a70</div>
       </body></html>`,
    );

    const result = await runBackfill({ competitorId, url: "https://x.test/pricing" });
    expect(result.batchesWritten).toBe(0);
  });

  test("an unreachable capture is abandoned silently, the rest still land", async () => {
    const competitorId = await seedCompetitor();
    cdxRows = [
      ["20240115000000", "200", "a"],
      ["20240715000000", "200", "b"],
    ];
    archived.set("20240715000000", pricingPage(12, 39));

    const result = await runBackfill({ competitorId, url: "https://x.test/pricing" });
    expect(result.batchesWritten).toBe(1);
    expect(result.snapshotsRead).toBe(1);
  });

  test("no archive at all is a clean skip", async () => {
    const competitorId = await seedCompetitor();
    const result = await runBackfill({ competitorId, url: "https://x.test/pricing" });
    expect(result.skipped).toBe("no_archive_capture");
  });

  test("the user's own product is never backfilled", async () => {
    const competitorId = await seedCompetitor("self");
    const result = await runBackfill({ competitorId, url: "https://x.test/pricing" });
    expect(result.skipped).toBe("self");
  });
});
