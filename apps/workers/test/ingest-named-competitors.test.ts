import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { makeTestDb, schema, type TestDb } from "./db-harness";

/**
 * Positioning Intelligence v2 P2 — the market map, end to end against a real
 * (in-process) Postgres.
 *
 * The URL patterns are owned by comparison-targets.test.ts in the scrapers package.
 * What is asserted here is what only shows itself as a signal that did NOT fire: a
 * competitor's whole back catalogue of `/vs/` pages on the first pass, the same
 * rival found again under a second URL shape, a blog mention, and our own product.
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
let mergeMentions: (
  competitorId: string,
  items: Array<{ sourceType: string; url: string | null; mentions: string[] }>,
  exclude: {
    self: { brands: string[]; domains: string[] };
    owner: { name: string; url: string | null };
  },
) => Promise<number>;

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
  const realQueue = await import("@outrival/queue");
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
  }));
  mock.module("@outrival/scrapers/content-fetch", () => ({
    fetchPostHtml: async (url: string) => {
      fetched.push(url);
      const html = pages.get(url);
      return html ? { ok: true, html, bytes: html.length } : { ok: false, reason: "http_404" };
    },
  }));

  ({ runIngestNamedCompetitors: runIngest } = await import(
    "../src/core/ingest-named-competitors"
  ));
  ({ mergeNamedFromMentions: mergeMentions } = await import("../src/lib/named-competitors"));
});

afterAll(() => closeDb());
beforeEach(() => {
  enqueued = [];
  pages = new Map();
  fetched = [];
});

let seq = 0;

/** One org, one competitor, and a sitemap capture to trigger on. */
async function seed(
  options: { type?: "competitor" | "self"; orgName?: string; productUrl?: string } = {},
) {
  const n = ++seq;
  const orgId = `org-${n}`;
  const competitorId = `cmp-${n}`;
  const monitorId = `mon-${n}`;
  const snapshotId = `snap-${n}`;

  await testDb.insert(schema.organizations).values({
    id: orgId,
    name: options.orgName ?? `Org ${n}`,
    slug: `org-${n}`,
    productUrl: options.productUrl ?? null,
  });
  await testDb.insert(schema.competitors).values({
    id: competitorId,
    orgId,
    name: "Rival",
    url: HOST,
    type: options.type ?? "competitor",
  });
  await testDb.insert(schema.monitors).values({ id: monitorId, competitorId, sourceType: "sitemap" });
  await testDb
    .insert(schema.snapshots)
    .values({ id: snapshotId, monitorId, r2Key: `k-${n}`, contentHash: `h-${n}` });

  return { orgId, competitorId, snapshotId };
}

const registry = (competitorId: string) =>
  testDb
    .select()
    .from(schema.namedCompetitors)
    .where(eq(schema.namedCompetitors.competitorId, competitorId));

describe("the first pass is a baseline", () => {
  test("ten comparison pages are recorded and NOTHING is announced", async () => {
    const { competitorId, snapshotId } = await seed();
    const urls = Array.from({ length: 10 }, (_, i) => `${HOST}/vs/rival${i}`);

    const result = await runIngest({ snapshotId, competitorId, urls });

    expect(result.baseline).toBe(true);
    expect(enqueued).toHaveLength(0);
    // The registry IS the point of the pass.
    expect((await registry(competitorId)).length).toBe(10);
  });

  test("a competitor with NO comparison pages still leaves baseline mode", async () => {
    // The failure this guards: with a row COUNT as the marker, an empty registry
    // makes every run "the first run", and the day they publish their very first
    // /vs/ page — the most newsworthy one they will ever publish — it is swallowed.
    const { competitorId, snapshotId } = await seed();
    const first = await runIngest({ snapshotId, competitorId, urls: [`${HOST}/pricing`] });
    expect(first.baseline).toBe(true);
    expect((await registry(competitorId)).length).toBe(0);

    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/vs/klue`] });

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.classification.humanChangeAfter).toBe("New comparison target — /vs/klue");
  });
});

describe("after the baseline", () => {
  test("rivals we have never seen emit ONE grouped signal", async () => {
    const { competitorId, snapshotId } = await seed();
    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/vs/klue`] }); // baseline
    enqueued = [];

    await runIngest({
      snapshotId,
      competitorId,
      urls: [`${HOST}/vs/klue`, `${HOST}/vs/kompyte`, `${HOST}/crayon-alternative`],
    });

    expect(enqueued).toHaveLength(1);
    const signal = enqueued[0]!;
    // The same category the comparison_page detector uses — the enum is not extended.
    expect(signal.classification.category).toBe("content");
    expect(signal.classification.severity).toBe("medium");
    expect(signal.classification.humanChangeAfter).toBe(
      "2 new comparison targets — Kompyte, Crayon",
    );
  });

  test("a single target leads with the page itself", async () => {
    const { competitorId, snapshotId } = await seed();
    await runIngest({ snapshotId, competitorId, urls: [] });
    enqueued = [];

    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/vs/klue`] });

    expect(enqueued[0]!.classification.humanChangeAfter).toBe("New comparison target — /vs/klue");
  });

  test("a rival from the BASELINE gaining a second page shape stays silent", async () => {
    // The back-catalogue leak this guards: the baseline recorded /vs/klue, and
    // them re-slugging that same fight as /klue-alternatives is not them opening
    // a new one.
    const { competitorId, snapshotId } = await seed();
    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/vs/klue`] }); // baseline
    enqueued = [];

    await runIngest({
      snapshotId,
      competitorId,
      urls: [`${HOST}/vs/klue`, `${HOST}/klue-alternatives`],
    });

    expect(enqueued).toHaveLength(0);
    // And the second page IS recorded — it is real evidence, the tab shows both.
    const rows = await registry(competitorId);
    expect(rows.map((r) => r.source).sort()).toEqual(["alternatives_page", "vs_page"]);
  });

  test("the same rival under a second URL shape never announces twice", async () => {
    const { competitorId, snapshotId } = await seed();
    await runIngest({ snapshotId, competitorId, urls: [] }); // baseline
    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/vs/crayon`] });
    expect(enqueued).toHaveLength(1);
    enqueued = [];

    // A second page, a second ROW, and the same piece of news.
    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/alternatives/crayon`] });

    expect(enqueued).toHaveLength(0);
    const rows = await registry(competitorId);
    // Two rows, because both pages are real evidence and the tab shows both.
    expect(rows.map((r) => r.source).sort()).toEqual(["alternatives_page", "vs_page"]);
    // And the name carries a stamp. That is the dedup: it is asked of the NAME
    // ("does any row for Crayon have one"), not of the row, so the second page
    // arriving later reads as already announced.
    expect(rows.some((r) => r.signalledAt !== null)).toBe(true);
    expect(rows.find((r) => r.source === "vs_page")!.signalledAt).not.toBeNull();
  });

  test("a target already announced never re-announces", async () => {
    const { competitorId, snapshotId } = await seed();
    await runIngest({ snapshotId, competitorId, urls: [] });
    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/vs/klue`] });
    enqueued = [];

    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/vs/klue`] });
    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/vs/klue`] });

    expect(enqueued).toHaveLength(0);
  });

  test("a page that disappears keeps its row and announces nothing", async () => {
    const { competitorId, snapshotId } = await seed();
    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/vs/klue`] });
    enqueued = [];

    await runIngest({ snapshotId, competitorId, urls: [] });

    expect(enqueued).toHaveLength(0);
    expect((await registry(competitorId)).map((r) => r.displayName)).toEqual(["Klue"]);
  });

  test("generic slugs never enter the map", async () => {
    const { competitorId, snapshotId } = await seed();
    await runIngest({ snapshotId, competitorId, urls: [] });
    enqueued = [];

    await runIngest({
      snapshotId,
      competitorId,
      urls: [`${HOST}/compare`, `${HOST}/vs/all`, `${HOST}/vs/pricing`, `${HOST}/alternatives`],
    });

    expect(enqueued).toHaveLength(0);
    expect(await registry(competitorId)).toHaveLength(0);
  });

  test("the signal hangs off the comparison_page anchor, never the sitemap monitor", async () => {
    const { competitorId, snapshotId } = await seed();
    await runIngest({ snapshotId, competitorId, urls: [] });
    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/vs/klue`] });

    const anchor = await testDb
      .select()
      .from(schema.monitors)
      .where(
        and(
          eq(schema.monitors.competitorId, competitorId),
          eq(schema.monitors.sourceType, "comparison_page"),
        ),
      );
    expect(anchor).toHaveLength(1);
    expect(anchor[0]!.isActive).toBe(false);

    const [change] = await testDb
      .select()
      .from(schema.changes)
      .where(eq(schema.changes.monitorId, anchor[0]!.id));
    expect((change!.rawDiff as { kind: string }).kind).toBe("new_comparison_target");
  });
});

describe("the reader's own product", () => {
  test("a /vs/{us} page leaves the registry untouched", async () => {
    const { competitorId, snapshotId } = await seed({
      orgName: "Outrival",
      productUrl: "https://outrival.app",
    });
    await runIngest({ snapshotId, competitorId, urls: [] });
    enqueued = [];

    // That page IS a signal — the deterministic critical from the sitemap
    // detector's own path, which this job never touches.
    await runIngest({
      snapshotId,
      competitorId,
      urls: [`${HOST}/vs/outrival`, `${HOST}/outrival-alternative`, `${HOST}/vs/klue`],
    });

    expect((await registry(competitorId)).map((r) => r.displayName)).toEqual(["Klue"]);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.classification.humanChangeAfter).toBe("New comparison target — /vs/klue");
  });

  test("a competitor never enters its OWN map", async () => {
    // `/compare/rival-vs-klue` on rival.com names two companies and one of them
    // is the publisher. Without the owner exclusion the map reads "Rival competes
    // with Rival" on the most ordinary comparison URL shape there is.
    const { competitorId, snapshotId } = await seed();

    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/compare/rival-vs-klue`] });

    expect((await registry(competitorId)).map((r) => r.displayName)).toEqual(["Klue"]);
  });

  test("our own comparison pages are recorded and announce nothing", async () => {
    const { competitorId, snapshotId } = await seed({ type: "self" });
    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/vs/klue`] });
    enqueued = [];

    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/vs/klue`, `${HOST}/vs/crayon`] });

    expect(enqueued).toHaveLength(0);
    // The rows still land: they are how "you already compete with X and they do
    // not" can ever be said.
    expect((await registry(competitorId)).length).toBe(2);
  });
});

describe("the comparison hub", () => {
  const hub = (hrefs: string[]) =>
    `<!doctype html><html><head><title>Compare</title></head><body><h1>Compare</h1>
      ${hrefs.map((h) => `<a href="${h}">compare</a>`).join("")}</body></html>`;

  test("is probed once and its MISS is cached", async () => {
    const { competitorId, snapshotId } = await seed();
    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/vs/klue`] });
    const probes = fetched.length;
    fetched = [];
    enqueued = [];

    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/vs/kompyte`] });

    expect(probes).toBeGreaterThan(0); // the first run paid the probe
    expect(fetched).toHaveLength(0); // the cached miss means the second paid nothing
    expect(enqueued).toHaveLength(1);
  });

  test("names rivals the sitemap never listed", async () => {
    const { competitorId, snapshotId } = await seed();
    pages.set(`${HOST}/vs`, hub(["/vs/klue", "/vs/crayon"]));
    await runIngest({ snapshotId, competitorId, urls: [] }); // baseline reads the hub too
    expect((await registry(competitorId)).length).toBe(2);
    enqueued = [];

    pages.set(`${HOST}/vs`, hub(["/vs/klue", "/vs/crayon", "/vs/kompyte"]));
    await runIngest({ snapshotId, competitorId, urls: [] });

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.classification.humanChangeAfter).toBe(
      "New comparison target — /vs/kompyte",
    );
  });
});

describe("mentions merged from content items", () => {
  test("enter the map and announce NOTHING", async () => {
    const { competitorId, snapshotId } = await seed();
    await runIngest({ snapshotId, competitorId, urls: [] }); // baselined
    enqueued = [];

    const written = await mergeMentions(
      competitorId,
      [
        { sourceType: "blog", url: `${HOST}/blog/why-klue`, mentions: ["Klue", "Kompyte"] },
        { sourceType: "docs", url: `${HOST}/docs/migrate`, mentions: ["Crayon"] },
        // A changelog naming a rival is comparing features, not positioning.
        { sourceType: "changelog", url: `${HOST}/changelog/1`, mentions: ["Nobody"] },
      ],
      { self: { brands: [], domains: [] }, owner: { name: "Rival", url: HOST } },
    );

    expect(written).toBe(3);
    expect(enqueued).toHaveLength(0);
    const rows = await registry(competitorId);
    expect(rows.map((r) => r.displayName).sort()).toEqual(["Crayon", "Klue", "Kompyte"]);
    expect(rows.every((r) => r.signalledAt === null)).toBe(true);
    expect(rows.every((r) => r.namedDomain === null)).toBe(true);
  });

  test("a mention does NOT consume the announcement the front deserves later", async () => {
    const { competitorId, snapshotId } = await seed();
    await runIngest({ snapshotId, competitorId, urls: [] });
    await mergeMentions(
      competitorId,
      [{ sourceType: "blog", url: `${HOST}/blog/klue`, mentions: ["Klue"] }],
      { self: { brands: [], domains: [] }, owner: { name: "Rival", url: HOST } },
    );
    enqueued = [];

    await runIngest({ snapshotId, competitorId, urls: [`${HOST}/vs/klue`] });

    expect(enqueued).toHaveLength(1);
  });

  test("the reader's own product is excluded here too", async () => {
    const { competitorId, snapshotId } = await seed();
    await runIngest({ snapshotId, competitorId, urls: [] });

    await mergeMentions(
      competitorId,
      [{ sourceType: "blog", url: `${HOST}/blog/x`, mentions: ["Outrival", "Klue"] }],
      {
        self: { brands: ["Outrival"], domains: ["outrival.app"] },
        owner: { name: "Rival", url: HOST },
      },
    );

    expect((await registry(competitorId)).map((r) => r.displayName)).toEqual(["Klue"]);
  });
});

describe("an archive capture", () => {
  test("writes nothing at all", async () => {
    const { competitorId, snapshotId } = await seed();
    await testDb
      .update(schema.snapshots)
      .set({ origin: "archive" })
      .where(eq(schema.snapshots.id, snapshotId));

    const result = await runIngest({ snapshotId, competitorId, urls: [`${HOST}/vs/klue`] });

    expect(result.skipped).toBe(true);
    expect(await registry(competitorId)).toHaveLength(0);
  });
});
