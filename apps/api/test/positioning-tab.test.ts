import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import {
  aiVisibilityPrompts,
  audiencePages,
  caseStudies,
  competitors,
  messagingVersions,
  monitors,
  namedCompetitors,
} from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

/**
 * Positioning Intelligence v2 P4 — the two endpoints the tab and the battle card
 * added, and only those. The four section reads are P1/P2/P3 and are covered by
 * their own files.
 *
 * Two properties carry this phase and are asserted below.
 *
 * A competitor with ONE captured wording has not repositioned — they have been
 * captured once. Dating their story to the day we started watching would put a
 * "changed 3 days ago" badge on every competitor added this week, which is the
 * single most misleading thing this tab could say.
 *
 * And every field of the fact set is independently absent. The battle-card section
 * renders one line per fact and drops the line when the fact is missing, so a
 * competitor holding only an ICP must produce exactly one line rather than four
 * placeholders — the failure mode the customer-proof block was built to avoid.
 */
let competitorsApp: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let org: { orgId: string; userId: string; email: string };

let seq = 0;
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

async function seedCompetitor(opts: { orgId?: string; name?: string; url?: string } = {}) {
  const n = ++seq;
  const competitorId = `cmp-${n}`;
  await testDb.insert(competitors).values({
    id: competitorId,
    orgId: opts.orgId ?? org.orgId,
    name: opts.name ?? `C${n}`,
    url: opts.url ?? null,
  });
  await testDb
    .insert(monitors)
    .values({ id: `mon-${n}`, competitorId, sourceType: "homepage" });
  return competitorId;
}

async function seedVersion(
  competitorId: string,
  row: { h1: string; capturedAt: Date; primaryCta?: string | null },
) {
  await testDb.insert(messagingVersions).values({
    competitorId,
    h1: row.h1,
    subheadline: null,
    primaryCta: row.primaryCta ?? null,
    valueProps: [],
    capturedAt: row.capturedAt,
  });
}

async function summary(competitorId: string, userId = org.userId) {
  const res = await competitorsApp.request(
    `/api/competitors/${competitorId}/positioning`,
    asUser(userId),
  );
  expect(res.status).toBe(200);
  return await res.json();
}

async function facts(competitorId: string, userId = org.userId) {
  const res = await competitorsApp.request(
    `/api/competitors/${competitorId}/positioning-facts`,
    asUser(userId),
  );
  expect(res.status).toBe(200);
  return await res.json();
}

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  const { competitorsRouter } = await import("../src/routes/competitors");
  competitorsApp = mountApp("/api/competitors", competitorsRouter);
  org = await seedOrg(testDb);
});

describe("the identity line", () => {
  test("a single captured wording is not a repositioning", async () => {
    const id = await seedCompetitor();
    await seedVersion(id, { h1: "Only wording we ever saw", capturedAt: daysAgo(3) });

    const body = await summary(id);
    expect(body.versionsTotal).toBe(1);
    // The date exists in the table; it must not reach the badge.
    expect(body.lastRepositionedAt).toBeNull();
  });

  test("a second wording dates the rewrite to the NEW one", async () => {
    const id = await seedCompetitor();
    await seedVersion(id, { h1: "Old story", capturedAt: daysAgo(60) });
    await seedVersion(id, { h1: "New story", capturedAt: daysAgo(4) });

    const body = await summary(id);
    expect(body.versionsTotal).toBe(2);
    const days = (Date.now() - new Date(body.lastRepositionedAt).getTime()) / DAY;
    expect(days).toBeGreaterThan(3);
    expect(days).toBeLessThan(5);
  });

  test("a competitor with nothing captured answers, it does not 404", async () => {
    const id = await seedCompetitor();
    const body = await summary(id);
    expect(body.versionsTotal).toBe(0);
    expect(body.lastRepositionedAt).toBeNull();
    expect(body.pricingModel).toBeNull();
  });

  test("share of model reports the prompts this workspace runs", async () => {
    const id = await seedCompetitor();
    await testDb.insert(aiVisibilityPrompts).values([
      { id: `p-${++seq}`, orgId: org.orgId, prompt: "best tool for X", isActive: true },
      { id: `p-${++seq}`, orgId: org.orgId, prompt: "alternatives to Y", isActive: true },
      { id: `p-${++seq}`, orgId: org.orgId, prompt: "retired", isActive: false },
    ]);

    const body = await summary(id);
    expect(body.shareOfModel.status).toBe("not_ready");
    // Active only: a retired prompt is not a promise of data.
    expect(body.shareOfModel.prompts).toBe(2);
  });
});

describe("the battle-card facts", () => {
  test("nothing captured yields an empty fact set, never placeholders", async () => {
    const id = await seedCompetitor();
    const body = await facts(id);
    expect(body.tagline).toBeNull();
    expect(body.claims).toEqual([]);
    expect(body.comparison).toBeNull();
    expect(body.icp).toBeNull();
    expect(body.namedByCount).toBe(0);
  });

  test("the tagline carries the wording it replaced", async () => {
    const id = await seedCompetitor();
    await seedVersion(id, { h1: "Before", capturedAt: daysAgo(90) });
    await seedVersion(id, { h1: "After", capturedAt: daysAgo(10), primaryCta: "Book a demo" });

    const body = await facts(id);
    expect(body.tagline.h1).toBe("After");
    expect(body.tagline.previousH1).toBe("Before");
    expect(body.tagline.primaryCta).toBe("Book a demo");
  });

  test("comparison counts every target, and names only the recent ones", async () => {
    const id = await seedCompetitor();
    await testDb.insert(namedCompetitors).values([
      {
        competitorId: id,
        nameNormalized: "klue",
        displayName: "Klue",
        source: "vs_page",
        firstSeenAt: daysAgo(5),
      },
      {
        competitorId: id,
        nameNormalized: "kompyte",
        displayName: "Kompyte",
        source: "vs_page",
        firstSeenAt: daysAgo(400),
      },
    ]);

    const body = await facts(id);
    expect(body.comparison.total).toBe(2);
    // Outside the 90-day window: it is on the map, it is not news.
    expect(body.comparison.recent).toEqual(["Klue"]);
  });

  test("one rival on two page shapes is one target, not two", async () => {
    const id = await seedCompetitor();
    await testDb.insert(namedCompetitors).values([
      {
        competitorId: id,
        nameNormalized: "klue",
        displayName: "Klue",
        source: "vs_page",
        firstSeenAt: daysAgo(20),
      },
      {
        competitorId: id,
        nameNormalized: "klue",
        displayName: "Klue",
        source: "alternatives_page",
        firstSeenAt: daysAgo(10),
      },
    ]);

    const body = await facts(id);
    expect(body.comparison.total).toBe(1);
    expect(body.comparison.recent).toEqual(["Klue"]);
  });

  test("industries prefer the verticals their stories prove", async () => {
    const id = await seedCompetitor();
    await testDb.insert(audiencePages).values([
      {
        competitorId: id,
        kind: "industry",
        slug: "fintech",
        displayName: "Fintech",
        isCanonical: 1,
      },
      {
        competitorId: id,
        kind: "industry",
        slug: "healthcare",
        displayName: "Healthcare",
        isCanonical: 1,
      },
      { competitorId: id, kind: "persona", slug: "agencies", displayName: "Agencies" },
    ]);
    await testDb.insert(caseStudies).values({
      id: `cs-${++seq}`,
      competitorId: id,
      url: `https://rival.com/customers/story-${seq}`,
      customerIndustry: "fintech",
      isCanonicalIndustry: 1,
    });

    const body = await facts(id);
    expect(body.icp.personas).toEqual(["Agencies"]);
    expect(body.icp.industriesProven).toBe(true);
    // Healthcare is declared with nothing behind it — a page, not a proof.
    expect(body.icp.industries).toHaveLength(1);
  });

  test("declared verticals still answer when no story proves one", async () => {
    const id = await seedCompetitor();
    await testDb.insert(audiencePages).values({
      competitorId: id,
      kind: "industry",
      slug: "healthcare",
      displayName: "Healthcare",
      isCanonical: 1,
    });

    const body = await facts(id);
    expect(body.icp.industriesProven).toBe(false);
    expect(body.icp.industries).toHaveLength(1);
    expect(body.icp.personas).toEqual([]);
  });

  test("namedByCount never leaves the workspace", async () => {
    const target = await seedCompetitor({ name: "Crayon", url: "https://crayon.co" });
    const mine = await seedCompetitor({ name: "Klue" });
    const foreign = await seedOrg(testDb);
    const theirs = await seedCompetitor({ orgId: foreign.orgId, name: "Someone else" });

    // Both workspaces hold a competitor that names Crayon; only ours may count.
    await testDb.insert(namedCompetitors).values([
      {
        competitorId: mine,
        nameNormalized: "crayon",
        displayName: "Crayon",
        namedDomain: "crayon.co",
        source: "vs_page",
        firstSeenAt: daysAgo(2),
      },
      {
        competitorId: theirs,
        nameNormalized: "crayon",
        displayName: "Crayon",
        namedDomain: "crayon.co",
        source: "vs_page",
        firstSeenAt: daysAgo(2),
      },
    ]);

    const body = await facts(target);
    expect(body.namedByCount).toBe(1);
  });
});
