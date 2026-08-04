import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { makeTestDb, schema, type TestDb } from "./db-harness";

/**
 * A blog row's `published_at`, against a real (in-process) Postgres — the same
 * unique index and the same ON CONFLICT as production.
 *
 * The rule under test is the one exception to "a post is never updated in place":
 * a date we never had can be filled in later. It exists because an undated row is
 * dated from the day we first saw it everywhere downstream, so a listing that only
 * hands us the real date on a later capture has to be able to correct it — and a
 * blog re-ingests only when its capture stops being byte-identical, which can be
 * months.
 *
 * The count it returns has to stay the count of PUBLICATIONS, or a repaired date
 * would be logged as a post that never appeared.
 *
 * mock.module is PROCESS-GLOBAL in Bun; this file re-points @outrival/db at its own
 * PGlite in beforeAll, as its siblings do.
 */

let testDb: TestDb;
let closeDb: () => Promise<void>;
let insertItems: (
  competitorId: string,
  items: ReadonlyArray<{
    externalId: string;
    title: string;
    url: string | null;
    publishedAt: string | null;
    body: string | null;
    status: string | null;
    itemType: string | null;
  }>,
  options?: { markSeen?: boolean },
) => Promise<number>;

const ORG_ID = "00000000-0000-4000-8000-0000000000a1";
const COMPETITOR_ID = "00000000-0000-4000-8000-0000000000b1";
const POST_URL = "https://rival.com/blog/release-4-0";

function post(publishedAt: string | null) {
  return {
    externalId: POST_URL,
    title: "Release: 4.0",
    url: POST_URL,
    publishedAt,
    body: null,
    status: null,
    itemType: null,
  };
}

async function storedDate(): Promise<Date | null> {
  const [row] = await testDb
    .select({ publishedAt: schema.contentItems.publishedAt })
    .from(schema.contentItems)
    .where(eq(schema.contentItems.competitorId, COMPETITOR_ID));
  return row?.publishedAt ?? null;
}

beforeAll(async () => {
  const harness = await makeTestDb();
  testDb = harness.db;
  closeDb = harness.close;
  const { mock } = await import("bun:test");
  mock.module("@outrival/db", () => ({ ...schema, db: harness.db }));
  // Restore the real content-fetch before importing the job. A sibling file that
  // stubbed only `fetchPostHtml` leaves a process-global mock with no
  // POST_FETCH_CAP on it, and this file's import of ingest-blog-posts then dies
  // with a SyntaxError — on CI only, because the order bun reads files in is the
  // filesystem's. Imported by PATH: the package specifier is the mocked one.
  const realContentFetch = await import("../../../packages/scrapers/src/content/fetch");
  mock.module("@outrival/scrapers/content-fetch", () => ({ ...realContentFetch }));

  await testDb
    .insert(schema.organizations)
    .values({ id: ORG_ID, name: "Org", slug: "org-blog-dates" });
  await testDb.insert(schema.competitors).values({
    id: COMPETITOR_ID,
    orgId: ORG_ID,
    name: "Rival",
    url: "https://rival.com",
    type: "competitor",
  });

  ({ insertItems } = await import("../src/core/ingest-blog-posts"));
});

afterAll(() => closeDb());

test("a date the listing withheld is filled in by a later capture", async () => {
  // The capture that saw only the undated "Recent posts" link.
  expect(await insertItems(COMPETITOR_ID, [post(null)])).toBe(1);
  expect(await storedDate()).toBeNull();

  // The next one reads the same post off the dated listing entry. One row, still
  // one publication — the repair is not a new post.
  expect(await insertItems(COMPETITOR_ID, [post("2023-10-23T00:00:00.000Z")])).toBe(0);
  expect((await storedDate())?.toISOString()).toBe("2023-10-23T00:00:00.000Z");
});

test("a date we already hold is never rewritten", async () => {
  await insertItems(COMPETITOR_ID, [post("2020-01-01T00:00:00.000Z")]);
  expect((await storedDate())?.toISOString()).toBe("2023-10-23T00:00:00.000Z");

  // Nor is it cleared by a capture that stopped printing the date.
  await insertItems(COMPETITOR_ID, [post(null)]);
  expect((await storedDate())?.toISOString()).toBe("2023-10-23T00:00:00.000Z");
});
