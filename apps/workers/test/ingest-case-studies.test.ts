import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";
import { makeTestDb, schema, type TestDb } from "./db-harness";

/**
 * Content Intelligence v2 P3 — the customer signals, end to end against a real
 * (in-process) Postgres: the same migrations, the same enum, the same unique
 * indexes as production.
 *
 * What is worth asserting here is not the parsing (customers.test.ts owns that) but
 * the rules that only show themselves as signals that did NOT fire: a first pass
 * that writes a competitor's whole back catalogue without announcing any of it, a
 * customer already in the registry, a removed logo, and the HIGH that must be
 * unreachable when the reader's own market is unknown.
 *
 * mock.module is PROCESS-GLOBAL in Bun. This file re-points @outrival/db at its own
 * PGlite in beforeAll, exactly as detect-salary-shifts.test.ts does; files run in
 * sequence, so each installs its own before its tests.
 */

let testDb: TestDb;
let closeDb: () => Promise<void>;
let runIngest: (payload: {
  snapshotId: string;
  competitorId: string;
  urls?: string[];
  contentItemIds?: string[];
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
/** What the model "reads" out of each page, keyed by title. */
let extraction = new Map<
  string,
  {
    customer_name: string | null;
    customer_industry_label: string | null;
    use_case: string | null;
    metrics_claimed: string[];
  }
>();

const HOST = "https://rival.com";

function logoWall(names: string[]): string {
  return `<!doctype html><html><head><title>Customers</title></head><body>
    <h1>Trusted by teams everywhere</h1>
    <div class="logo-wall">
      ${names.map((n) => `<img alt="${n}" src="/l.png">`).join("\n")}
    </div>
    <ul>${storyLinks.map((u) => `<li><a href="${u}">Story</a></li>`).join("")}</ul>
  </body></html>`;
}
let storyLinks: string[] = [];

function storyPage(title: string, body: string): string {
  return `<!doctype html><html><head><title>${title}</title></head><body>
    <article><h1>${title}</h1><p>${body}</p></article></body></html>`;
}

beforeAll(async () => {
  const realQueue = await import("@outrival/queue");
  const realAi = await import("@outrival/ai");
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
  mock.module("@outrival/ai", () => ({
    ...realAi,
    extractCaseStudies: async (batch: ReadonlyArray<{ title: string; text: string }>) => ({
      studies: batch.map((page, index) => ({
        index,
        ...(extraction.get(page.title) ?? {
          customer_name: null,
          customer_industry_label: null,
          use_case: null,
          metrics_claimed: [],
        }),
      })),
    }),
  }));
  mock.module("@outrival/scrapers/content-fetch", () => ({
    fetchPostHtml: async (url: string) => {
      const html = pages.get(url);
      return html ? { ok: true, html, bytes: html.length } : { ok: false, reason: "http_404" };
    },
  }));
  mock.module("../src/lib/analytics", () => ({
    loggedAi: async <T>(_task: string, _cfg: unknown, fn: () => Promise<T>) => fn(),
  }));

  ({ runIngestCaseStudies: runIngest } = await import("../src/core/ingest-case-studies"));
});

afterAll(() => closeDb());
beforeEach(() => {
  enqueued = [];
  pages = new Map();
  extraction = new Map();
  storyLinks = [];
});

let seq = 0;

/** One org with a self product, one competitor, and a sitemap capture to trigger on. */
async function seed(options: { audience?: string; category?: string } = {}) {
  const n = ++seq;
  const orgId = `org-${n}`;
  const competitorId = `cmp-${n}`;
  const selfId = `self-${n}`;
  const monitorId = `mon-${n}`;
  const snapshotId = `snap-${n}`;

  await testDb.insert(schema.organizations).values({ id: orgId, name: `Org ${n}`, slug: `org-${n}` });
  await testDb.insert(schema.competitors).values([
    { id: competitorId, orgId, name: "Rival", url: HOST, type: "competitor" },
    {
      id: selfId,
      orgId,
      name: "Us",
      type: "self",
      selfProfile: {
        audience: { value: options.audience ?? null },
        category: { value: options.category ?? null },
      },
    },
  ]);
  await testDb
    .insert(schema.products)
    .values({ id: `prd-${n}`, orgId, name: "Us", selfCompetitorId: selfId });
  await testDb
    .insert(schema.monitors)
    .values({ id: monitorId, competitorId, sourceType: "sitemap" });
  await testDb
    .insert(schema.snapshots)
    .values({ id: snapshotId, monitorId, r2Key: `k-${n}`, contentHash: `h-${n}` });

  return { orgId, competitorId, snapshotId };
}

describe("the first pass is a baseline", () => {
  test("a competitor with a full customers page writes rows and signals NOTHING", async () => {
    const { competitorId, snapshotId } = await seed();
    storyLinks = Array.from({ length: 15 }, (_, i) => `${HOST}/customers/acme-${i}`);
    pages.set(
      `${HOST}/customers`,
      logoWall(["Acme Logistics", "Globex", "Initech", "Umbrella Health"]),
    );
    for (let i = 0; i < 15; i++) {
      const title = `How Customer ${i} shipped faster`;
      pages.set(`${HOST}/customers/acme-${i}`, storyPage(title, `Customer ${i} uses the product.`));
      extraction.set(title, {
        customer_name: null,
        customer_industry_label: "logistics",
        use_case: "Shipping",
        metrics_claimed: [],
      });
    }

    const result = await runIngest({ snapshotId, competitorId });

    expect(result.baseline).toBe(true);
    expect(enqueued).toHaveLength(0);
    const registry = await testDb
      .select()
      .from(schema.knownCustomers)
      .where(eq(schema.knownCustomers.competitorId, competitorId));
    // Every logo on the wall is now known — that memory is the point of the pass.
    expect(registry.map((r) => r.displayName).sort()).toEqual([
      "Acme Logistics",
      "Globex",
      "Initech",
      "Umbrella Health",
    ]);
    const stories = await testDb
      .select()
      .from(schema.caseStudies)
      .where(eq(schema.caseStudies.competitorId, competitorId));
    // The page cap holds: the index plus nine stories, the rest deferred.
    expect(stories.length).toBe(9);
  });
});

describe("after the baseline", () => {
  test("a name we have never seen emits ONE grouped customer_win", async () => {
    const { competitorId, snapshotId } = await seed();
    pages.set(`${HOST}/customers`, logoWall(["Acme Logistics", "Globex"]));
    await runIngest({ snapshotId, competitorId }); // baseline
    enqueued = [];

    // Two new logos appear; Globex is still there and Acme is GONE.
    pages.set(`${HOST}/customers`, logoWall(["Globex", "Northwind", "Vandelay"]));
    await runIngest({ snapshotId, competitorId });

    expect(enqueued).toHaveLength(1);
    const [signal] = enqueued;
    expect(signal!.classification.category).toBe("partnerships");
    expect(signal!.classification.severity).toBe("medium");
    expect(signal!.classification.humanChangeAfter).toBe("2 new customers — Northwind, Vandelay");
  });

  test("a customer already in the registry never wins twice", async () => {
    const { competitorId, snapshotId } = await seed();
    pages.set(`${HOST}/customers`, logoWall(["Acme Logistics"]));
    await runIngest({ snapshotId, competitorId }); // baseline
    pages.set(`${HOST}/customers`, logoWall(["Acme Logistics", "Northwind"]));
    await runIngest({ snapshotId, competitorId }); // Northwind wins
    enqueued = [];

    // Same wall again, plus the same customer written with its legal form.
    pages.set(`${HOST}/customers`, logoWall(["Acme Logistics", "Northwind Inc."]));
    await runIngest({ snapshotId, competitorId });
    expect(enqueued).toHaveLength(0);
  });

  test("a removed logo produces nothing at all", async () => {
    const { competitorId, snapshotId } = await seed();
    pages.set(`${HOST}/customers`, logoWall(["Acme Logistics", "Globex"]));
    await runIngest({ snapshotId, competitorId }); // baseline
    enqueued = [];

    pages.set(`${HOST}/customers`, logoWall(["Acme Logistics"]));
    await runIngest({ snapshotId, competitorId });
    expect(enqueued).toHaveLength(0);
  });
});

describe("case_study_published severity", () => {
  async function publishStory(
    seeded: { competitorId: string; snapshotId: string },
    story: {
      customer_name: string | null;
      customer_industry_label: string | null;
      metrics_claimed: string[];
    },
    body: string,
  ) {
    const title = `Story ${++seq}`;
    const url = `${HOST}/case-studies/story-${seq}`;
    pages.set(url, storyPage(title, body));
    extraction.set(title, { ...story, use_case: "Something" });
    await runIngest({ ...seeded, urls: [url] });
  }

  test("HIGH only when the reader's market and the story's market are the same slug", async () => {
    const seeded = await seed({ audience: "insurance brokers" });
    pages.set(`${HOST}/customers`, logoWall(["Seed One", "Seed Two"]));
    await runIngest({ snapshotId: seeded.snapshotId, competitorId: seeded.competitorId });
    enqueued = [];

    await publishStory(
      seeded,
      {
        customer_name: "Northwind Assurance",
        customer_industry_label: "insurance broker",
        metrics_claimed: ["cut claims handling by 40%"],
      },
      "Northwind Assurance, an insurance broker, cut claims handling by 40% with us.",
    );
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.classification.severity).toBe("high");
    expect(enqueued[0]!.classification.category).toBe("content");
    expect(enqueued[0]!.classification.humanChangeAfter).toContain("Northwind Assurance");
    expect(enqueued[0]!.classification.humanChangeAfter).toContain("cut claims handling by 40%");

    enqueued = [];
    await publishStory(
      seeded,
      {
        customer_name: "Globex Foods",
        customer_industry_label: "grocery chain",
        metrics_claimed: [],
      },
      "Globex Foods, a grocery chain, rolled us out across 40 stores.",
    );
    expect(enqueued[0]!.classification.severity).toBe("medium");
  });

  test("HIGH is impossible when the workspace's own market is unknown", async () => {
    // The profile names no market this catalog knows → resolveUserIndustry is null.
    const seeded = await seed({ audience: "small teams", category: "project management" });
    pages.set(`${HOST}/customers`, logoWall(["Seed One", "Seed Two"]));
    await runIngest({ snapshotId: seeded.snapshotId, competitorId: seeded.competitorId });
    enqueued = [];

    await publishStory(
      seeded,
      {
        customer_name: "Northwind Assurance",
        customer_industry_label: "insurance broker",
        metrics_claimed: [],
      },
      "Northwind Assurance, an insurance broker, uses the product daily.",
    );
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.classification.severity).toBe("medium");
  });

  test("an anonymised story signals, counts for the vertical, and wins nobody", async () => {
    const seeded = await seed({ audience: "insurance brokers" });
    pages.set(`${HOST}/customers`, logoWall(["Seed One", "Seed Two"]));
    await runIngest({ snapshotId: seeded.snapshotId, competitorId: seeded.competitorId });
    enqueued = [];

    await publishStory(
      seeded,
      {
        // The model turned the description into a name; the page never writes it.
        customer_name: "European Insurance Group",
        customer_industry_label: "insurance",
        metrics_claimed: [],
      },
      "How a leading european insurance group cut onboarding time in half.",
    );

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.classification.humanChangeAfter).toContain("an unnamed customer");
    const registry = await testDb
      .select()
      .from(schema.knownCustomers)
      .where(eq(schema.knownCustomers.competitorId, seeded.competitorId));
    expect(registry.map((r) => r.displayName).sort()).toEqual(["Seed One", "Seed Two"]);
    const [story] = await testDb
      .select()
      .from(schema.caseStudies)
      .where(eq(schema.caseStudies.competitorId, seeded.competitorId));
    expect(story!.customerIndustry).toBe("insurance");
    expect(story!.isCanonicalIndustry).toBe(1);
  });

  test("a story already stored is never re-signalled", async () => {
    const seeded = await seed();
    pages.set(`${HOST}/customers`, logoWall(["Seed One", "Seed Two"]));
    await runIngest({ snapshotId: seeded.snapshotId, competitorId: seeded.competitorId });

    const title = "Repeat story";
    const url = `${HOST}/case-studies/repeat`;
    pages.set(url, storyPage(title, "Northwind Traders uses the product."));
    extraction.set(title, {
      customer_name: "Northwind Traders",
      customer_industry_label: "logistics",
      use_case: "Freight",
      metrics_claimed: [],
    });

    await runIngest({ ...seeded, urls: [url] });
    enqueued = [];
    await runIngest({ ...seeded, urls: [url] });
    expect(enqueued).toHaveLength(0);
  });
});
