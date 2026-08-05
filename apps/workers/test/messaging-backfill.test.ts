import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { makeTestDb, schema, type TestDb } from "./db-harness";

/**
 * Positioning Intelligence v2 P1 — the one-shot timeline rebuild, against a real
 * (in-process) Postgres: the same migrations, the same unique index as production.
 *
 * The rule the whole feature rests on is a NEGATIVE one, so it gets its own test:
 * reconstructing three years of homepage captures must not announce, three years
 * late, that a company repositioned itself. No change row, no signal, no snapshot —
 * the only table this touches is messaging_versions.
 *
 * mock.module is PROCESS-GLOBAL in Bun. This file re-points @outrival/db at its own
 * PGlite in beforeAll, exactly as the sibling job tests do.
 */

let testDb: TestDb;
let closeDb: () => Promise<void>;
let backfill: typeof import("../src/lib/messaging-backfill").backfillMessagingVersions;

/** r2Key → stored HTML, for the pre-patch-16 captures that carry no structure. */
let archive = new Map<string, string>();

const heroStructure = (headline: string, cta = "Start free") => ({
  parserVersion: 3,
  title: headline,
  hero: { headline, subheadline: "The one place for it all", primaryCta: { text: cta } },
  sections: [{ type: "features", heading: "Real-time pricing", bodyText: "x", ctas: [] }],
  navigation: { items: [] },
  footer: {},
  socialProof: { customerLogos: [], testimonialCount: 0, testimonials: [] },
});

const heroHtml = (headline: string) =>
  `<!doctype html><html><body><main><h1>${headline}</h1>` +
  `<p>The one place for it all</p><a href="/signup">Start free</a></main>` +
  `<section><h2>Real-time pricing</h2><p>Live market data on every card.</p></section>` +
  `</body></html>`;

let seq = 0;
async function seedCompetitor(): Promise<{ competitorId: string; monitorId: string }> {
  const n = ++seq;
  const orgId = `org-${n}`;
  const competitorId = `cmp-${n}`;
  const monitorId = `mon-${n}`;
  await testDb.insert(schema.organizations).values({ id: orgId, name: `O${n}`, slug: `o-${n}` });
  await testDb.insert(schema.competitors).values({ id: competitorId, orgId, name: `C${n}` });
  await testDb
    .insert(schema.monitors)
    .values({ id: monitorId, competitorId, sourceType: "homepage" });
  return { competitorId, monitorId };
}

let snap = 0;
async function seedCapture(
  monitorId: string,
  iso: string,
  opts: { structure?: unknown; html?: string; status?: string } = {},
) {
  const n = ++snap;
  const r2Key = `snapshots/${monitorId}/homepage/${iso}`;
  if (opts.html) archive.set(`${r2Key}.html`, opts.html);
  await testDb.insert(schema.snapshots).values({
    id: `snp-${n}`,
    monitorId,
    r2Key,
    contentHash: `h-${n}`,
    status: opts.status ?? "success",
    scrapedAt: new Date(iso),
    resolvedUrl: "https://rival.com",
    homepageStructure: opts.structure ?? null,
  });
  return r2Key;
}

const fetchHtml = async (key: string) => archive.get(`${key}.html`) ?? null;

afterAll(() => closeDb());

beforeAll(async () => {
  const harness = await makeTestDb();
  testDb = harness.db;
  closeDb = harness.close;
  ({ backfillMessagingVersions: backfill } = await import("../src/lib/messaging-backfill"));
});

beforeEach(() => {
  archive = new Map();
});

describe("messaging backfill", () => {
  test("rebuilds the timeline from stored structures, dated at each first capture", async () => {
    const { competitorId, monitorId } = await seedCompetitor();
    await seedCapture(monitorId, "2026-05-01T00:00:00Z", {
      structure: heroStructure("Track your collection"),
    });
    await seedCapture(monitorId, "2026-06-01T00:00:00Z", {
      structure: heroStructure("Track your collection"),
    });
    await seedCapture(monitorId, "2026-07-15T00:00:00Z", {
      structure: heroStructure("Buy, sell, trade"),
    });

    const result = await backfill(competitorId, { apply: true, fetchHtml });
    expect(result.inserted).toBe(2);

    const rows = await testDb
      .select()
      .from(schema.messagingVersions)
      .where(eq(schema.messagingVersions.competitorId, competitorId))
      .orderBy(asc(schema.messagingVersions.capturedAt));

    expect(rows.map((r) => r.h1)).toEqual(["Track your collection", "Buy, sell, trade"]);
    expect(rows[0]!.capturedAt.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(rows[1]!.capturedAt.toISOString()).toBe("2026-07-15T00:00:00.000Z");
    // The capture a version was read off, so it can be checked at its source.
    expect(rows[1]!.snapshotKey).toContain("2026-07-15");
  });

  test("writes NOTHING but messaging_versions — no change, no signal, no snapshot", async () => {
    const { competitorId, monitorId } = await seedCompetitor();
    await seedCapture(monitorId, "2023-01-01T00:00:00Z", { structure: heroStructure("Old copy") });
    await seedCapture(monitorId, "2024-06-01T00:00:00Z", { structure: heroStructure("Newer copy") });
    await seedCapture(monitorId, "2026-01-01T00:00:00Z", { structure: heroStructure("Latest copy") });

    const before = {
      changes: (await testDb.select().from(schema.changes)).length,
      signals: (await testDb.select().from(schema.signals)).length,
      snapshots: (await testDb.select().from(schema.snapshots)).length,
    };

    const result = await backfill(competitorId, { apply: true, fetchHtml });
    expect(result.inserted).toBe(3);

    expect((await testDb.select().from(schema.changes)).length).toBe(before.changes);
    expect((await testDb.select().from(schema.signals)).length).toBe(before.signals);
    expect((await testDb.select().from(schema.snapshots)).length).toBe(before.snapshots);
  });

  test("a second run writes nothing — the unique key makes it idempotent", async () => {
    const { competitorId, monitorId } = await seedCompetitor();
    await seedCapture(monitorId, "2026-05-01T00:00:00Z", { structure: heroStructure("A") });
    await seedCapture(monitorId, "2026-06-01T00:00:00Z", { structure: heroStructure("B") });

    expect((await backfill(competitorId, { apply: true, fetchHtml })).inserted).toBe(2);
    expect((await backfill(competitorId, { apply: true, fetchHtml })).inserted).toBe(0);

    const rows = await testDb
      .select()
      .from(schema.messagingVersions)
      .where(eq(schema.messagingVersions.competitorId, competitorId));
    expect(rows).toHaveLength(2);
  });

  test("a dry run plans the versions and writes none", async () => {
    const { competitorId, monitorId } = await seedCompetitor();
    await seedCapture(monitorId, "2026-05-01T00:00:00Z", { structure: heroStructure("A") });

    const result = await backfill(competitorId, { fetchHtml });
    expect(result.versions).toHaveLength(1);
    expect(result.inserted).toBe(0);
    expect(
      await testDb
        .select()
        .from(schema.messagingVersions)
        .where(eq(schema.messagingVersions.competitorId, competitorId)),
    ).toHaveLength(0);
  });

  test("a pre-patch-16 capture is re-parsed from its stored HTML", async () => {
    // Captures older than the structure column are the entire reason a backfill
    // exists — the HTML in R2 is the only record of what the page said.
    const { competitorId, monitorId } = await seedCompetitor();
    await seedCapture(monitorId, "2025-02-01T00:00:00Z", { html: heroHtml("The old promise") });
    await seedCapture(monitorId, "2026-05-01T00:00:00Z", {
      structure: heroStructure("The new promise"),
    });

    const result = await backfill(competitorId, { apply: true, fetchHtml });
    expect(result.fetched).toBe(1);

    const rows = await testDb
      .select()
      .from(schema.messagingVersions)
      .where(eq(schema.messagingVersions.competitorId, competitorId))
      .orderBy(asc(schema.messagingVersions.capturedAt));
    expect(rows.map((r) => r.h1)).toEqual(["The old promise", "The new promise"]);
  });

  test("the R2 cap bounds the work, and a missing object is skipped not guessed", async () => {
    const { competitorId, monitorId } = await seedCompetitor();
    await seedCapture(monitorId, "2025-01-01T00:00:00Z", { html: heroHtml("First") });
    // Stored in the snapshot table but gone from the bucket (retention purge).
    await seedCapture(monitorId, "2025-02-01T00:00:00Z");
    await seedCapture(monitorId, "2025-03-01T00:00:00Z", { html: heroHtml("Third") });

    const result = await backfill(competitorId, { apply: true, fetchHtml, maxR2Parses: 2 });
    // Two GETs attempted, one of which found nothing; the third capture is past
    // the cap and simply not read.
    expect(result.fetched).toBe(2);
    expect(result.versions.map((v) => v.copy.headline)).toEqual(["First"]);
  });

  test("a partial capture never becomes a version", async () => {
    const { competitorId, monitorId } = await seedCompetitor();
    await seedCapture(monitorId, "2026-05-01T00:00:00Z", { structure: heroStructure("Real copy") });
    await seedCapture(monitorId, "2026-06-01T00:00:00Z", {
      structure: heroStructure("Something went wrong"),
      status: "partial",
    });

    const result = await backfill(competitorId, { apply: true, fetchHtml });
    expect(result.versions.map((v) => v.copy.headline)).toEqual(["Real copy"]);
  });

  test("a competitor with no homepage monitor plans nothing", async () => {
    const n = ++seq;
    await testDb.insert(schema.organizations).values({ id: `org-${n}`, name: "O", slug: `o-${n}` });
    await testDb
      .insert(schema.competitors)
      .values({ id: `cmp-${n}`, orgId: `org-${n}`, name: "No homepage" });

    const result = await backfill(`cmp-${n}`, { apply: true, fetchHtml });
    expect(result).toMatchObject({ captures: 0, versions: [], inserted: 0 });
  });
});
