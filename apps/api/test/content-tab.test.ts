import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { changes, competitors, contentItems, monitors, signals, snapshots } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

/**
 * Content Intelligence v2 P4, read side: the two endpoints the Content tab is
 * built on, and the fact block behind an `editorial_pivot`.
 *
 * What is worth pinning here is that the tab can never claim a competitor
 * published less than they did. Filters run in SQL, so a page is a page of the
 * real set; items nobody has read come back like any other row; and the cadence is
 * counted off entries, so it works on a competitor whose posts have never been
 * opened — which is the whole shape of the tab's second empty state.
 */
let app: Hono;
let competitorsApp: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let org: { orgId: string; userId: string; email: string };

let seq = 0;
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

async function seedCompetitor(): Promise<string> {
  const id = `cmp-${++seq}`;
  await testDb.insert(competitors).values({ id, orgId: org.orgId, name: `C${seq}` });
  return id;
}

async function seedItem(
  competitorId: string,
  item: {
    sourceType: string;
    itemType?: string | null;
    topics?: string[] | null;
    title?: string;
    url?: string | null;
    status?: string | null;
    statusNormalized?: string | null;
    votes?: number | null;
    summary?: string | null;
    publishedAt?: Date | null;
    firstSeenAt?: Date;
  },
) {
  const n = ++seq;
  await testDb.insert(contentItems).values({
    id: `ci-${n}`,
    competitorId,
    sourceType: item.sourceType,
    externalId: `ext-${n}`,
    title: item.title ?? `Item ${n}`,
    url: item.url ?? `https://rival.com/p/${n}`,
    itemType: item.itemType ?? null,
    topics: item.topics ?? null,
    status: item.status ?? null,
    statusNormalized: item.statusNormalized ?? null,
    votes: item.votes ?? null,
    summary: item.summary ?? null,
    publishedAt: item.publishedAt ?? null,
    firstSeenAt: item.firstSeenAt ?? item.publishedAt ?? daysAgo(1),
  });
  return `ci-${n}`;
}

async function content(competitorId: string, query = "") {
  const res = await competitorsApp.request(
    `/api/competitors/${competitorId}/content${query}`,
    asUser(org.userId),
  );
  expect(res.status).toBe(200);
  return await res.json();
}

async function summary(competitorId: string) {
  const res = await competitorsApp.request(
    `/api/competitors/${competitorId}/content-summary`,
    asUser(org.userId),
  );
  expect(res.status).toBe(200);
  return await res.json();
}

afterAll(() => closeDb());

// Generous: the first file in a run pays the full migration into PGlite, which is
// several seconds on its own and well past bun's 5s hook default.
beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  const { signalsRouter } = await import("../src/routes/signals");
  const { competitorsRouter } = await import("../src/routes/competitors");
  app = mountApp("/api/signals", signalsRouter);
  competitorsApp = mountApp("/api/competitors", competitorsRouter);
  org = await seedOrg(testDb);
}, 60_000);

describe("GET /:id/content", () => {
  test("returns the timeline newest first, dated on published_at when there is one", async () => {
    const id = await seedCompetitor();
    await seedItem(id, { sourceType: "blog", title: "Older", publishedAt: daysAgo(20) });
    await seedItem(id, { sourceType: "blog", title: "Newer", publishedAt: daysAgo(2) });

    const res = await content(id);
    expect(res.items.map((i: { title: string }) => i.title)).toEqual(["Newer", "Older"]);
    expect(res.total).toBe(2);
  });

  test("an item the source never dated falls back to when WE saw it", async () => {
    const id = await seedCompetitor();
    // A roadmap portal announces a STATUS, not a date. first_seen_at is the only
    // date that exists, and the row must still be placeable.
    await seedItem(id, {
      sourceType: "roadmap",
      itemType: "roadmap_entry",
      status: "planned",
      publishedAt: null,
      firstSeenAt: daysAgo(3),
    });
    const res = await content(id);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].publishedAt).toBeNull();
    expect(res.items[0].firstSeenAt).not.toBeNull();
  });

  test("an unread item is returned like any other, flagged not enriched", async () => {
    const id = await seedCompetitor();
    await seedItem(id, {
      sourceType: "blog",
      itemType: null,
      topics: null,
      title: "Never opened",
      publishedAt: daysAgo(4),
    });
    const res = await content(id);
    // The row is THERE. Hiding it would make the timeline claim they published less.
    expect(res.items).toHaveLength(1);
    expect(res.items[0].enriched).toBe(false);
    expect(res.items[0].title).toBe("Never opened");
  });

  test("filters by source in SQL, and the pill counts ignore that filter", async () => {
    const id = await seedCompetitor();
    await seedItem(id, { sourceType: "blog", publishedAt: daysAgo(2) });
    await seedItem(id, { sourceType: "blog", publishedAt: daysAgo(3) });
    await seedItem(id, { sourceType: "changelog", itemType: "fix", publishedAt: daysAgo(4) });

    const res = await content(id, "?source=blog");
    expect(res.total).toBe(2);
    expect(res.items.every((i: { sourceType: string }) => i.sourceType === "blog")).toBe(true);
    // A pill that recounted itself when pressed would read as the data changing.
    expect(res.sourceCounts).toEqual({ blog: 2, changelog: 1 });
  });

  test("filters by item type, and `unread` selects the ones with no type", async () => {
    const id = await seedCompetitor();
    await seedItem(id, { sourceType: "changelog", itemType: "breaking", publishedAt: daysAgo(2) });
    await seedItem(id, { sourceType: "changelog", itemType: "fix", publishedAt: daysAgo(3) });
    await seedItem(id, { sourceType: "blog", itemType: null, publishedAt: daysAgo(4) });

    expect((await content(id, "?type=breaking")).total).toBe(1);
    expect((await content(id, "?type=unread")).total).toBe(1);
    expect((await content(id, "?type=unread")).items[0].enriched).toBe(false);
  });

  test("the kind counts carry their source, over the period and not the filter", async () => {
    const id = await seedCompetitor();
    await seedItem(id, { sourceType: "changelog", itemType: "fix", publishedAt: daysAgo(2) });
    await seedItem(id, { sourceType: "changelog", itemType: "fix", publishedAt: daysAgo(3) });
    await seedItem(id, { sourceType: "blog", itemType: null, publishedAt: daysAgo(4) });
    await seedItem(id, { sourceType: "blog", itemType: "seo", publishedAt: daysAgo(200) });

    const key = (t: { sourceType: string; itemType: string | null; count: number }) =>
      [`${t.sourceType}:${t.itemType ?? "unread"}`, t.count] as const;

    // The kind menu is scoped to the selected source, so a count with no source on
    // it cannot be offered under the right pill.
    const within = await content(id, "?period=90&source=changelog");
    expect(Object.fromEntries(within.typeCounts.map(key))).toEqual({
      "changelog:fix": 2,
      "blog:unread": 1,
    });

    // And it follows the PERIOD, which is what the old fixed 90-day mix could not
    // do: past 90 days it hid kinds that were on screen.
    const wider = await content(id, "?period=365");
    expect(Object.fromEntries(wider.typeCounts.map(key))["blog:seo"]).toBe(1);
  });

  test("a roadmap row carries its vote count and our own status word", async () => {
    const id = await seedCompetitor();
    await seedItem(id, {
      sourceType: "roadmap",
      itemType: "roadmap_entry",
      status: "up next",
      statusNormalized: "planned",
      votes: 128,
      publishedAt: null,
      firstSeenAt: daysAgo(3),
    });

    const res = await content(id, "?source=roadmap");
    // The portal's own word is what the board shows; the normalized one is what it
    // groups a column on, since every portal spells its columns differently.
    expect(res.items[0]).toMatchObject({ status: "up next", statusNormalized: "planned", votes: 128 });
  });

  test("the period filter is applied on the date the item is placed on", async () => {
    const id = await seedCompetitor();
    await seedItem(id, { sourceType: "blog", publishedAt: daysAgo(10) });
    await seedItem(id, { sourceType: "blog", publishedAt: daysAgo(200) });

    expect((await content(id, "?period=30")).total).toBe(1);
    expect((await content(id, "?period=365")).total).toBe(2);
    // 0 means everything we hold.
    expect((await content(id, "?period=0")).total).toBe(2);
  });

  test("pages, and says whether there is more", async () => {
    const id = await seedCompetitor();
    for (let i = 0; i < 5; i++) {
      await seedItem(id, { sourceType: "blog", publishedAt: daysAgo(i + 1) });
    }
    const first = await content(id, "?limit=2");
    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(5);
    expect(first.hasMore).toBe(true);

    const last = await content(id, "?limit=2&offset=4");
    expect(last.items).toHaveLength(1);
    expect(last.hasMore).toBe(false);
  });

  test("another org's competitor is not found, not empty", async () => {
    const other = await seedOrg(testDb);
    const id = await seedCompetitor();
    const res = await competitorsApp.request(
      `/api/competitors/${id}/content`,
      asUser(other.userId),
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /:id/content-summary", () => {
  test("cadence counts entries, so it works with nothing read at all", async () => {
    const id = await seedCompetitor();
    for (let i = 0; i < 4; i++) {
      // No topics, no type: the shape of a competitor we have only just started
      // reading. The chart must still be real — that is empty state two.
      await seedItem(id, { sourceType: "blog", itemType: null, topics: null, publishedAt: daysAgo(5 + i) });
    }
    const res = await summary(id);
    expect(res.cadence.reduce((n: number, m: { total: number }) => n + m.total, 0)).toBe(4);
    expect(res.totals.published).toBe(4);
    expect(res.totals.postsRead).toBe(0);
    expect(res.totals.unread).toBe(4);
    expect(res.themes).toEqual([]);
  });

  test("the running month is marked, and only it", async () => {
    const id = await seedCompetitor();
    await seedItem(id, { sourceType: "blog", publishedAt: daysAgo(2) });
    const res = await summary(id);
    const partial = res.cadence.filter((m: { partial: boolean }) => m.partial);
    expect(partial).toHaveLength(1);
    expect(partial[0].month).toBe(new Date().toISOString().slice(0, 7));
  });

  test("cadence splits each month by source", async () => {
    const id = await seedCompetitor();
    // `now`, not "a day ago": on the 1st of a month that would land in the month
    // BEFORE the running one and the assertion would flip once a month.
    const now = new Date();
    await seedItem(id, { sourceType: "changelog", itemType: "fix", publishedAt: now });
    await seedItem(id, { sourceType: "changelog", itemType: "fix", publishedAt: now });
    await seedItem(id, { sourceType: "blog", publishedAt: now });

    const res = await summary(id);
    const month = res.cadence.find((m: { partial: boolean }) => m.partial);
    expect(month.bySource).toEqual({ changelog: 2, blog: 1 });
  });

  test("themes carry both windows, so a subject they DROPPED still gets a row", async () => {
    const id = await seedCompetitor();
    await seedItem(id, { sourceType: "blog", topics: ["ai agents"], itemType: "thought_leadership", publishedAt: daysAgo(10) });
    await seedItem(id, { sourceType: "blog", topics: ["ai agents"], itemType: "thought_leadership", publishedAt: daysAgo(20) });
    await seedItem(id, { sourceType: "blog", topics: ["onboarding"], itemType: "seo", publishedAt: daysAgo(120) });
    await seedItem(id, { sourceType: "blog", topics: ["onboarding"], itemType: "seo", publishedAt: daysAgo(130) });

    const res = await summary(id);
    const byTopic = Object.fromEntries(
      res.themes.map((t: { topic: string; now: number; then: number }) => [t.topic, t]),
    );
    expect(byTopic["ai agents"]).toMatchObject({ now: 2, then: 0 });
    // Ranked on whichever window holds more, so a dropped subject is still visible.
    expect(byTopic["onboarding"]).toMatchObject({ now: 0, then: 2 });
  });

  test("a post nobody opened does not become a theme, and does not count as read", async () => {
    const id = await seedCompetitor();
    await seedItem(id, { sourceType: "blog", topics: null, publishedAt: daysAgo(5) });
    await seedItem(id, { sourceType: "blog", topics: [], itemType: "seo", publishedAt: daysAgo(6) });

    const res = await summary(id);
    // `topics: []` is a post we READ that carried no subject; `topics: null` was
    // never opened. Only the first counts toward what the themes rest on.
    expect(res.totals.postsRead).toBe(1);
    expect(res.themes).toEqual([]);
  });

  test("the per-month rate carries the window before it, so the tab can say 'up from'", async () => {
    const id = await seedCompetitor();
    for (let i = 0; i < 6; i++) await seedItem(id, { sourceType: "blog", publishedAt: daysAgo(10 + i) });
    for (let i = 0; i < 3; i++) await seedItem(id, { sourceType: "blog", publishedAt: daysAgo(100 + i) });

    const res = await summary(id);
    expect(res.totals.published).toBe(6);
    expect(res.totals.previousPublished).toBe(3);
    expect(res.totals.perMonth).toBeGreaterThan(res.totals.previousPerMonth);
  });

  test("totals.allTime counts what the cadence window cannot reach", async () => {
    const id = await seedCompetitor();
    // Their newest post predates the 12-month cadence: everything the summary
    // otherwise reports is legitimately zero.
    await seedItem(id, { sourceType: "blog", publishedAt: daysAgo(500) });
    await seedItem(id, { sourceType: "blog", publishedAt: daysAgo(900) });

    const res = await summary(id);
    expect(res.cadence.reduce((n: number, m: { total: number }) => n + m.total, 0)).toBe(0);
    expect(res.totals.published).toBe(0);
    // OUT-246: the tab's "they have never published anything" empty state is an
    // ALL-TIME claim and renders in place of the period toggle. Reading it off the
    // cadence made this competitor a dead end at every period, "All" included.
    expect(res.totals.allTime).toBe(2);
  });

  test("totals.allTime is zero on a competitor we hold nothing for", async () => {
    const res = await summary(await seedCompetitor());
    expect(res.totals.allTime).toBe(0);
  });
});

describe("editorial_pivot facts", () => {
  test("the block names both windows, their post counts and the divergence", async () => {
    const competitorId = await seedCompetitor();
    const n = ++seq;
    await testDb
      .insert(monitors)
      .values({ id: `mon-${n}`, competitorId, sourceType: "editorial_shift" });
    await testDb
      .insert(snapshots)
      .values({ id: `snp-${n}`, monitorId: `mon-${n}`, r2Key: `k-${n}`, contentHash: `h-${n}` });

    const detectedAt = new Date(Date.UTC(2026, 5, 1, 9, 0, 0));
    await testDb.insert(changes).values({
      id: `chg-${n}`,
      monitorId: `mon-${n}`,
      snapshotAfterId: `snp-${n}`,
      diffText: "editorial shift",
      rawDiff: {
        kind: "editorial_pivot",
        divergence: 0.41,
        windowDays: 90,
        currentPosts: 13,
        previousPosts: 9,
        currentTopics: [
          { topic: "ai agents", count: 6 },
          { topic: "security", count: 4 },
        ],
        previousTopics: [{ topic: "onboarding", count: 4 }],
        rising: [{ topic: "ai agents", now: 6, then: 1 }],
        declining: [{ topic: "onboarding", now: 1, then: 4 }],
      },
      detectedAt,
    });
    await testDb.insert(signals).values({
      id: `sig-${n}`,
      changeId: `chg-${n}`,
      orgId: org.orgId,
      competitorId,
      severity: "medium",
      category: "content",
      insight: "Editorial shift — rising: ai agents · declining: onboarding",
      createdAt: detectedAt,
    });

    const res = await app.request(`/api/signals/sig-${n}/detail`, asUser(org.userId));
    expect(res.status).toBe(200);
    const f = (await res.json()).signal.facts;

    expect(f.kind).toBe("editorial");
    expect(f.divergence).toBeCloseTo(0.41, 5);
    // Both denominators travel with the claim: a divergence over 13 posts and one
    // over 130 are different kinds of statement.
    expect(f.currentPosts).toBe(13);
    expect(f.previousPosts).toBe(9);
    expect(f.rising[0]).toMatchObject({ topic: "ai agents", now: 6, then: 1 });
    expect(f.declining[0]).toMatchObject({ topic: "onboarding", now: 1, then: 4 });
    expect(f.currentTopics).toHaveLength(2);
  });

  test("a change on the anchor with no pivot kind renders no block rather than a broken one", async () => {
    const competitorId = await seedCompetitor();
    const n = ++seq;
    await testDb
      .insert(monitors)
      .values({ id: `mon-${n}`, competitorId, sourceType: "editorial_shift" });
    await testDb
      .insert(snapshots)
      .values({ id: `snp-${n}`, monitorId: `mon-${n}`, r2Key: `k-${n}`, contentHash: `h-${n}` });

    const detectedAt = new Date(Date.UTC(2026, 5, 2, 9, 0, 0));
    await testDb.insert(changes).values({
      id: `chg-${n}`,
      monitorId: `mon-${n}`,
      snapshotAfterId: `snp-${n}`,
      diffText: "something else",
      rawDiff: { kind: "something_else" },
      detectedAt,
    });
    await testDb.insert(signals).values({
      id: `sig-${n}`,
      changeId: `chg-${n}`,
      orgId: org.orgId,
      competitorId,
      severity: "low",
      category: "content",
      insight: "unrelated",
      createdAt: detectedAt,
    });

    const res = await app.request(`/api/signals/sig-${n}/detail`, asUser(org.userId));
    expect((await res.json()).signal.facts).toBeNull();
  });
});
