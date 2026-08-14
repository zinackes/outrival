import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { makeTestDb, schema, type TestDb } from "./db-harness";

/**
 * OUT-180 — the one-shot that removes the market-map rows the old blog prompt
 * produced, against a real (in-process) Postgres.
 *
 * This is a DELETE over a table three features read, so the tests that matter are
 * the negative ones: what it must NOT take. A content row that corroborates a real
 * `/vs/` page is evidence for that front, and a row carrying `signalled_at` holds
 * the marker that stops a front announced two years ago from being announced again
 * as news. Both survive, or the cleanup costs more than the bad data did.
 *
 * mock.module is PROCESS-GLOBAL in Bun. This file re-points @outrival/db at its own
 * PGlite in beforeAll, exactly as the sibling job tests do.
 */

let testDb: TestDb;
let closeDb: () => Promise<void>;
let cleanup: typeof import("../src/lib/blog-mention-cleanup").cleanupBlogMentions;

let seq = 0;
async function seedCompetitor(name?: string): Promise<string> {
  const n = ++seq;
  const orgId = `org-${n}`;
  const competitorId = `cmp-${n}`;
  await testDb.insert(schema.organizations).values({ id: orgId, name: `O${n}`, slug: `o-${n}` });
  await testDb
    .insert(schema.competitors)
    .values({ id: competitorId, orgId, name: name ?? `C${n}` });
  return competitorId;
}

async function seedNamed(
  competitorId: string,
  row: { name: string; source: string; signalledAt?: Date | null },
) {
  await testDb.insert(schema.namedCompetitors).values({
    competitorId,
    nameNormalized: row.name.toLowerCase(),
    displayName: row.name,
    source: row.source,
    evidenceUrl: `https://rival.com/${row.source}/${row.name.toLowerCase()}`,
    signalledAt: row.signalledAt ?? null,
  });
}

async function seedPost(competitorId: string, mentions: string[] | null) {
  const n = ++seq;
  await testDb.insert(schema.contentItems).values({
    competitorId,
    sourceType: "blog",
    externalId: `post-${n}`,
    title: `Post ${n}`,
    url: `https://rival.com/blog/post-${n}`,
    competitorsNamed: mentions,
    enrichedAt: new Date(),
  });
}

const namesOf = async (competitorId: string) =>
  (
    await testDb
      .select({ name: schema.namedCompetitors.displayName })
      .from(schema.namedCompetitors)
      .where(eq(schema.namedCompetitors.competitorId, competitorId))
  )
    .map((r) => r.name)
    .sort();

afterAll(() => closeDb());

beforeAll(async () => {
  const harness = await makeTestDb();
  testDb = harness.db;
  closeDb = harness.close;
  ({ cleanupBlogMentions: cleanup } = await import("../src/lib/blog-mention-cleanup"));
});

describe("blog mention cleanup", () => {
  test("a name only a post ever carried goes; a page keeps its front", async () => {
    const id = await seedCompetitor("Artifact Registry");
    await seedNamed(id, { name: "Docker Hub", source: "vs_page" });
    await seedNamed(id, { name: "Priceline", source: "blog" });
    await seedNamed(id, { name: "Intel", source: "docs" });

    const report = await cleanup({ apply: true, competitorId: id });

    expect(report.deleted).toBe(2);
    expect(await namesOf(id)).toEqual(["Docker Hub"]);
  });

  test("a post that corroborates a /vs/ page is evidence, not noise", async () => {
    const id = await seedCompetitor();
    await seedNamed(id, { name: "Klue", source: "vs_page" });
    // The same rival, named again in a post. Deleting this would cost the target
    // one piece of evidence and buy nothing: the page already proves the front.
    await seedNamed(id, { name: "Klue", source: "blog" });

    const report = await cleanup({ apply: true, competitorId: id });

    expect(report.deleted).toBe(0);
    expect(await namesOf(id)).toEqual(["Klue", "Klue"]);
  });

  test("an announced row is kept and counted, never deleted", async () => {
    // `signalled_at` is stamped on every row holding the name, across sources. Take
    // this one away and the dedup forgets the announcement.
    const id = await seedCompetitor();
    await seedNamed(id, { name: "Crayon", source: "blog", signalledAt: new Date() });

    const report = await cleanup({ apply: true, competitorId: id });

    expect(report.deleted).toBe(0);
    expect(report.announcedKept).toBe(1);
    expect(await namesOf(id)).toEqual(["Crayon"]);
  });

  test("competitors_named is cleared so the backfill cannot refill the map", async () => {
    const id = await seedCompetitor();
    await seedNamed(id, { name: "Spotify", source: "blog" });
    await seedPost(id, ["Spotify", "NVIDIA"]);

    const report = await cleanup({ apply: true, competitorId: id });

    expect(report.cleared).toBe(1);
    const posts = await testDb
      .select({ mentions: schema.contentItems.competitorsNamed })
      .from(schema.contentItems)
      .where(eq(schema.contentItems.competitorId, id));
    expect(posts.map((p) => p.mentions)).toEqual([null]);
  });

  test("a dry run reports the same rows and writes nothing", async () => {
    const id = await seedCompetitor();
    await seedNamed(id, { name: "GitHub", source: "blog" });
    await seedPost(id, ["GitHub"]);

    const report = await cleanup({ competitorId: id });

    expect(report.deleted).toBe(1);
    expect(report.cleared).toBe(1);
    expect(report.byCompetitor[0]!.names).toEqual(["GitHub"]);
    expect(await namesOf(id)).toEqual(["GitHub"]);
  });

  test("without --competitor it sweeps every workspace at once", async () => {
    const a = await seedCompetitor();
    const b = await seedCompetitor();
    await seedNamed(a, { name: "Airavia", source: "blog" });
    await seedNamed(b, { name: "Chipworks", source: "docs" });

    const report = await cleanup({ apply: true });

    expect(report.deleted).toBeGreaterThanOrEqual(2);
    expect(await namesOf(a)).toEqual([]);
    expect(await namesOf(b)).toEqual([]);
  });
});
