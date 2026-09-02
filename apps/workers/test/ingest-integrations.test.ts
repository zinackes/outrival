import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { clearQueueOverrides, recordEnqueues, setQueueOverrides } from "./queue-mock";
import { and, eq } from "drizzle-orm";
import { makeTestDb, schema, type TestDb } from "./db-harness";

/**
 * Content Intelligence v2 P5 — the integration catalog, end to end against a real
 * (in-process) Postgres.
 *
 * The parsing rules are owned by integrations.test.ts in the scrapers package. What
 * is asserted here is what only shows itself as a signal that did NOT fire: the
 * first pass over a catalog of forty tiles, an integration already in the registry,
 * one that disappeared, and the free sitemap route working with no fetch at all.
 *
 * There is no AI mock because the job imports no model: the whole path is URL slugs
 * and alt text, which is the phase's cost claim made structural.
 */

let testDb: TestDb;
let closeDb: () => Promise<void>;
let runIngest: (payload: {
  snapshotId: string;
  competitorId: string;
  urls?: string[];
}) => Promise<Record<string, unknown>>;

interface Enqueued {
  changeId: string;
  classification: {
    category: string;
    severity: string;
    reason: string;
    humanChangeAfter: string;
  };
}
let enqueued: Enqueued[] = [];
/** url → html. A URL absent from this map answers like a 404. */
let pages = new Map<string, string>();
/** Every URL the run actually fetched — the free route must fetch nothing. */
let fetched: string[] = [];

const HOST = "https://rival.com";

function catalog(names: string[]): string {
  return `<!doctype html><html><head><title>Integrations | Rival</title></head><body>
    <h1>Integrations</h1>
    <main>
      ${names
        .map((n) => `<a href="/integrations/${n.toLowerCase().replace(/\s+/g, "-")}">${n}</a>`)
        .join("\n")}
    </main>
  </body></html>`;
}

beforeAll(async () => {
  const realContentFetch = await import("@outrival/scrapers/content-fetch");
  const harness = await makeTestDb();
  testDb = harness.db;
  closeDb = harness.close;

  setQueueOverrides({ generateSignal: recordEnqueues(() => enqueued) });
  // Spread the REAL module: this mock is process-global and outlives the file,
  // so a partial one leaves every later file importing a module that reads
  // POST_FETCH_CAP with a SyntaxError, depending only on the order bun picked.
  mock.module("@outrival/scrapers/content-fetch", () => ({
    ...realContentFetch,
    fetchPostHtml: async (url: string) => {
      fetched.push(url);
      const html = pages.get(url);
      return html ? { ok: true, html, bytes: html.length } : { ok: false, reason: "http_404" };
    },
  }));

  ({ runIngestIntegrations: runIngest } = await import("../src/core/ingest-integrations"));
});

afterAll(() => {
  clearQueueOverrides();
  return closeDb();
});
beforeEach(() => {
  enqueued = [];
  pages = new Map();
  fetched = [];
});

let seq = 0;

/** One org, one competitor, and a sitemap capture to trigger on. */
async function seed(options: { type?: "competitor" | "self" } = {}) {
  const n = ++seq;
  const orgId = `org-${n}`;
  const competitorId = `cmp-${n}`;
  const monitorId = `mon-${n}`;
  const snapshotId = `snap-${n}`;

  await testDb
    .insert(schema.organizations)
    .values({ id: orgId, name: `Org ${n}`, slug: `org-${n}` });
  await testDb.insert(schema.competitors).values({
    id: competitorId,
    orgId,
    name: "Rival",
    url: HOST,
    type: options.type ?? "competitor",
  });
  await testDb
    .insert(schema.monitors)
    .values({ id: monitorId, competitorId, sourceType: "sitemap" });
  await testDb
    .insert(schema.snapshots)
    .values({ id: snapshotId, monitorId, r2Key: `k-${n}`, contentHash: `h-${n}` });

  return { competitorId, snapshotId };
}

const registry = (competitorId: string) =>
  testDb
    .select()
    .from(schema.knownIntegrations)
    .where(eq(schema.knownIntegrations.competitorId, competitorId));

describe("the first pass is a baseline", () => {
  test("forty tiles are recorded and NOTHING is announced", async () => {
    const { competitorId, snapshotId } = await seed();
    const names = Array.from({ length: 40 }, (_, i) => `Vendor${i}`);
    pages.set(`${HOST}/integrations`, catalog(names));

    const result = await runIngest({ snapshotId, competitorId });

    expect(result.baseline).toBe(true);
    expect(enqueued).toHaveLength(0);
    // The registry IS the point of the pass.
    expect((await registry(competitorId)).length).toBe(40);
  });
});

describe("after the baseline", () => {
  test("names we have never seen emit ONE grouped signal", async () => {
    const { competitorId, snapshotId } = await seed();
    pages.set(`${HOST}/integrations`, catalog(["Slack", "Notion"]));
    await runIngest({ snapshotId, competitorId }); // baseline
    enqueued = [];

    // Three added; Notion is still there and Slack has been REMOVED.
    pages.set(`${HOST}/integrations`, catalog(["Notion", "Zapier", "Linear", "Segment"]));
    await runIngest({ snapshotId, competitorId });

    expect(enqueued).toHaveLength(1);
    const signal = enqueued[0]!;
    expect(signal.classification.category).toBe("partnerships");
    expect(signal.classification.severity).toBe("medium");
    expect(signal.classification.humanChangeAfter).toBe(
      "3 new integrations — Zapier, Linear, Segment",
    );
  });

  test("a removal announces nothing at all", async () => {
    const { competitorId, snapshotId } = await seed();
    pages.set(`${HOST}/integrations`, catalog(["Slack", "Notion"]));
    await runIngest({ snapshotId, competitorId });
    enqueued = [];

    pages.set(`${HOST}/integrations`, catalog(["Notion"]));
    await runIngest({ snapshotId, competitorId });

    expect(enqueued).toHaveLength(0);
    // And the name stays in the registry: catalogs paginate and get reorganised.
    expect((await registry(competitorId)).map((r) => r.displayName).sort()).toEqual([
      "Notion",
      "Slack",
    ]);
  });

  test("an integration already known never announces twice", async () => {
    const { competitorId, snapshotId } = await seed();
    pages.set(`${HOST}/integrations`, catalog(["Slack", "Segment"]));
    await runIngest({ snapshotId, competitorId });
    pages.set(`${HOST}/integrations`, catalog(["Slack", "Notion"]));
    await runIngest({ snapshotId, competitorId });
    enqueued = [];

    await runIngest({ snapshotId, competitorId });

    expect(enqueued).toHaveLength(0);
  });

  test("the signal hangs off its own anchor, never the sitemap monitor", async () => {
    const { competitorId, snapshotId } = await seed();
    // Two tiles minimum: a page carrying one link does not qualify as a catalog,
    // and the probe caches that miss (see resolveIndexUrl).
    pages.set(`${HOST}/integrations`, catalog(["Slack", "Notion"]));
    await runIngest({ snapshotId, competitorId });
    pages.set(`${HOST}/integrations`, catalog(["Slack", "Notion", "Linear"]));
    await runIngest({ snapshotId, competitorId });

    const anchor = await testDb
      .select()
      .from(schema.monitors)
      .where(
        and(
          eq(schema.monitors.competitorId, competitorId),
          eq(schema.monitors.sourceType, "integration_catalog"),
        ),
      );
    expect(anchor).toHaveLength(1);
    expect(anchor[0]!.isActive).toBe(false);
  });
});

describe("the sitemap route", () => {
  test("reads names out of URLs with no fetch of a catalog at all", async () => {
    const { competitorId, snapshotId } = await seed();
    // No catalog page anywhere: every probe 404s and the miss is cached.
    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/integrations/slack`] });
    const probes = fetched.length;
    fetched = [];
    enqueued = [];

    await runIngest({
      snapshotId,
      competitorId,
      urls: [`${HOST}/integrations/notion`, `${HOST}/blog/why-we-love-slack`],
    });

    expect(probes).toBeGreaterThan(0); // the first run paid the probe
    expect(fetched).toHaveLength(0); // the cached miss means the second paid nothing
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.classification.humanChangeAfter).toBe("New integration — Notion");
    // The blog post was not a listing and never entered the registry.
    expect((await registry(competitorId)).map((r) => r.displayName).sort()).toEqual([
      "Notion",
      "Slack",
    ]);
  });

  test("a partner PROGRAMME page yields nothing", async () => {
    const { competitorId, snapshotId } = await seed();
    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/integrations/slack`] });
    enqueued = [];

    await runIngest({
      snapshotId,
      competitorId,
      urls: [`${HOST}/partners`, `${HOST}/partners/become-a-partner`],
    });

    expect(enqueued).toHaveLength(0);
    expect((await registry(competitorId)).map((r) => r.displayName)).toEqual(["Slack"]);
  });
});

describe("the first-run marker", () => {
  /** What the sitemap's no-change catch-up reads to decide this ingest is owed a run. */
  const firstRunAt = async (competitorId: string) => {
    const [row] = await testDb
      .select({ metadata: schema.competitors.metadata })
      .from(schema.competitors)
      .where(eq(schema.competitors.id, competitorId));
    return (row?.metadata as { integrationsFirstRunAt?: string } | null)?.integrationsFirstRunAt;
  };

  test("a competitor with NO catalog at all is still marked as read", async () => {
    const { competitorId, snapshotId } = await seed();
    // Every probe 404s: the registry stays empty, which is this competitor's
    // permanent state — the row count can never say the ingest has run.
    await runIngest({ snapshotId, competitorId });

    expect((await registry(competitorId)).length).toBe(0);
    expect(await firstRunAt(competitorId)).toBeString();
  });

  test("the marker is stamped once and never moves again", async () => {
    const { competitorId, snapshotId } = await seed();
    pages.set(`${HOST}/integrations`, catalog(["Slack", "Notion"]));
    await runIngest({ snapshotId, competitorId });
    const first = await firstRunAt(competitorId);

    pages.set(`${HOST}/integrations`, catalog(["Slack", "Notion", "Linear"]));
    await runIngest({ snapshotId, competitorId });

    expect(await firstRunAt(competitorId)).toBe(first!);
  });
});

describe("our own product", () => {
  test("rows are written and nothing is announced", async () => {
    const { competitorId, snapshotId } = await seed({ type: "self" });
    pages.set(`${HOST}/integrations`, catalog(["Slack", "Notion"]));
    await runIngest({ snapshotId, competitorId });
    pages.set(`${HOST}/integrations`, catalog(["Slack", "Notion", "Linear"]));

    await runIngest({ snapshotId, competitorId });

    expect(enqueued).toHaveLength(0);
    // The rows still land: they are how "you integrate with X and they do not"
    // can ever be said.
    expect((await registry(competitorId)).length).toBe(3);
  });
});
