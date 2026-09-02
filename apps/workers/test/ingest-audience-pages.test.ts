import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { clearQueueOverrides, recordEnqueues, setQueueOverrides } from "./queue-mock";
import { and, eq } from "drizzle-orm";
import { makeTestDb, schema, type TestDb } from "./db-harness";

/**
 * Positioning Intelligence v2 P3 — the ICP registry, end to end against a real
 * (in-process) Postgres.
 *
 * The URL patterns are owned by audience-pages.test.ts in the scrapers package. What
 * is asserted here is what only shows itself as a signal that did NOT fire: a
 * competitor's whole back catalogue of `/solutions/` pages on the first pass, the
 * same segment seen again a month later, and our own product.
 *
 * There is no AI mock because the job imports no model: the whole path is URL slugs
 * and links, which is the phase's cost claim made structural.
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
let fetched: string[] = [];

const HOST = "https://rival.com";

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

  ({ runIngestAudiencePages: runIngest } = await import("../src/core/ingest-audience-pages"));
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

  return { orgId, competitorId, snapshotId };
}

const registry = (competitorId: string) =>
  testDb
    .select()
    .from(schema.audiencePages)
    .where(eq(schema.audiencePages.competitorId, competitorId));

describe("the first pass is a baseline", () => {
  test("twelve /solutions pages are recorded and NOTHING is announced", async () => {
    const { competitorId, snapshotId } = await seed();
    const urls = Array.from({ length: 12 }, (_, i) => `${HOST}/solutions/job-${i}`);

    const result = await runIngest({ snapshotId, competitorId, urls });

    expect(result.baseline).toBe(true);
    expect(enqueued).toHaveLength(0);
    // The registry IS the point of the pass.
    expect((await registry(competitorId)).length).toBe(12);
  });

  test("a competitor with NO audience pages still leaves baseline mode", async () => {
    // The failure this guards: with a row COUNT as the marker, an empty registry
    // makes every run "the first run", and the day they publish their very first
    // /industries/ page — the one that says they entered a vertical — it is swallowed.
    const { competitorId, snapshotId } = await seed();
    const first = await runIngest({ snapshotId, competitorId, urls: [`${HOST}/pricing`] });
    expect(first.baseline).toBe(true);
    expect((await registry(competitorId)).length).toBe(0);

    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/for/enterprise`] });

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.classification.humanChangeAfter).toBe(
      "New persona page — /for/enterprise",
    );
  });
});

describe("after the baseline", () => {
  test("segments across all three kinds emit ONE grouped signal", async () => {
    const { competitorId, snapshotId } = await seed();
    await runIngest({ snapshotId, competitorId, urls: [] }); // baseline
    enqueued = [];

    await runIngest({
      snapshotId,
      competitorId,
      urls: [
        `${HOST}/for/enterprise`,
        `${HOST}/industries/fintech`,
        `${HOST}/use-cases/onboarding`,
      ],
    });

    expect(enqueued).toHaveLength(1);
    const signal = enqueued[0]!;
    // The same category the comparison_page detector uses — the enum is not extended.
    expect(signal.classification.category).toBe("content");
    expect(signal.classification.severity).toBe("medium");
    expect(signal.classification.humanChangeAfter).toBe(
      "3 new audience pages — /for/enterprise, /industries/fintech, /use-cases/onboarding",
    );
  });

  test("a single page leads with the page itself, named by its kind", async () => {
    const { competitorId, snapshotId } = await seed();
    await runIngest({ snapshotId, competitorId, urls: [] });
    enqueued = [];

    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/industries/fintech`] });

    expect(enqueued[0]!.classification.humanChangeAfter).toBe(
      "New industry page — /industries/fintech",
    );
  });

  test("a segment already announced never announces again", async () => {
    const { competitorId, snapshotId } = await seed();
    await runIngest({ snapshotId, competitorId, urls: [] });
    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/for/agencies`] });
    expect(enqueued).toHaveLength(1);
    enqueued = [];

    // Same page next week, and the week after, and under a locale prefix.
    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/for/agencies`] });
    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/en/for/agencies`] });

    expect(enqueued).toHaveLength(0);
    expect((await registry(competitorId)).length).toBe(1);
  });

  test("a page that disappears keeps its row and announces nothing", async () => {
    const { competitorId, snapshotId } = await seed();
    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/for/agencies`] });
    enqueued = [];

    await runIngest({ snapshotId, competitorId, urls: [] });

    expect(enqueued).toHaveLength(0);
    expect((await registry(competitorId)).map((r) => r.displayName)).toEqual(["Agencies"]);
  });

  test("a sub-page of a known segment is not a second segment", async () => {
    const { competitorId, snapshotId } = await seed();
    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/solutions/finance`] });
    enqueued = [];

    await runIngest({
      snapshotId,
      competitorId,
      urls: [`${HOST}/solutions/finance`, `${HOST}/solutions/finance/banking`],
    });

    expect(enqueued).toHaveLength(0);
    expect((await registry(competitorId)).length).toBe(1);
  });

  test("chrome and hub roots never enter the registry", async () => {
    const { competitorId, snapshotId } = await seed();
    await runIngest({ snapshotId, competitorId, urls: [] });
    enqueued = [];

    await runIngest({
      snapshotId,
      competitorId,
      urls: [
        `${HOST}/solutions`,
        `${HOST}/for/index`,
        `${HOST}/industries/all`,
        `${HOST}/use-cases/overview`,
      ],
    });

    expect(enqueued).toHaveLength(0);
    expect(await registry(competitorId)).toHaveLength(0);
  });

  test("the signal hangs off the audience_page anchor, never the sitemap monitor", async () => {
    const { competitorId, snapshotId } = await seed();
    await runIngest({ snapshotId, competitorId, urls: [] });
    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/for/agencies`] });

    const anchor = await testDb
      .select()
      .from(schema.monitors)
      .where(
        and(
          eq(schema.monitors.competitorId, competitorId),
          eq(schema.monitors.sourceType, "audience_page"),
        ),
      );
    expect(anchor).toHaveLength(1);
    expect(anchor[0]!.isActive).toBe(false);

    const [change] = await testDb
      .select()
      .from(schema.changes)
      .where(eq(schema.changes.monitorId, anchor[0]!.id));
    expect((change!.rawDiff as { kind: string }).kind).toBe("new_persona_page");
    expect((change!.rawDiff as { pages: unknown[] }).pages).toEqual([
      { kind: "persona", slug: "agencies" },
    ]);
  });
});

describe("industries answer to the catalog", () => {
  test("a sitemap slug is stored canonical, so a case study can meet it", async () => {
    const { competitorId, snapshotId } = await seed();
    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/industries/fin-tech`] });

    const [row] = await registry(competitorId);
    expect(row!.slug).toBe("fintech");
    expect(row!.isCanonical).toBe(1);
    // The page's own wording survives for display.
    expect(row!.displayName).toBe("Fin Tech");
  });

  test("a vertical the catalog does not know is stored non-canonical", async () => {
    const { competitorId, snapshotId } = await seed();
    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/industries/quantum-computing`] });

    const [row] = await registry(competitorId);
    expect(row!.slug).toBe("quantum_computing");
    expect(row!.isCanonical).toBe(0);
  });
});

describe("the reader's own product", () => {
  test("our own audience pages are recorded and announce nothing", async () => {
    const { competitorId, snapshotId } = await seed({ type: "self" });
    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/for/agencies`] });
    enqueued = [];

    await runIngest({
      snapshotId,
      competitorId,
      urls: [`${HOST}/for/agencies`, `${HOST}/industries/fintech`],
    });

    expect(enqueued).toHaveLength(0);
    // The rows still land: they are how "they cover a vertical you do not" can ever
    // be said.
    expect((await registry(competitorId)).length).toBe(2);
  });
});

describe("the audience hub", () => {
  const hub = (hrefs: string[]) =>
    `<!doctype html><html><head><title>Solutions</title></head><body><h1>Solutions</h1>
      ${hrefs.map((h) => `<a href="${h}">go</a>`).join("")}</body></html>`;

  test("is probed once and its MISS is cached", async () => {
    const { competitorId, snapshotId } = await seed();
    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/for/agencies`] });
    const probes = fetched.length;
    fetched = [];
    enqueued = [];

    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/for/banks`] });

    expect(probes).toBeGreaterThan(0); // the first run paid the probe
    expect(fetched).toHaveLength(0); // the cached miss means the second paid nothing
    expect(enqueued).toHaveLength(1);
  });

  test("names segments the sitemap never listed", async () => {
    const { competitorId, snapshotId } = await seed();
    pages.set(`${HOST}/solutions`, hub(["/industries/fintech", "/use-cases/onboarding"]));
    await runIngest({ snapshotId, competitorId, urls: [] }); // baseline reads the hub too
    expect((await registry(competitorId)).length).toBe(2);
    enqueued = [];

    pages.set(
      `${HOST}/solutions`,
      hub(["/industries/fintech", "/use-cases/onboarding", "/industries/logistics"]),
    );
    await runIngest({ snapshotId, competitorId, urls: [] });

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.classification.humanChangeAfter).toBe(
      "New industry page — /industries/logistics",
    );
  });
});

describe("an archive capture", () => {
  test("writes nothing at all", async () => {
    const { competitorId, snapshotId } = await seed();
    await testDb
      .update(schema.snapshots)
      .set({ origin: "archive" })
      .where(eq(schema.snapshots.id, snapshotId));

    const result = await runIngest({ snapshotId, competitorId, urls: [`${HOST}/for/agencies`] });

    expect(result.skipped).toBe(true);
    expect(await registry(competitorId)).toHaveLength(0);
  });
});
