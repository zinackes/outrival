import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import {
  audiencePages,
  caseStudies,
  changes,
  competitors,
  monitors,
  signals,
  snapshots,
} from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

/**
 * Positioning Intelligence v2 P3, read side: the ICP profile and the fact block
 * behind `new_persona_page`.
 *
 * The test that carries the phase is "declared meets proven". Both sides of that
 * intersection go through the SAME industry-catalog resolver — an audience page
 * slug and a case study's `customer_industry` — and if either ever stops, the
 * failure is silent: `both` simply comes back empty and the tab shows a company
 * with no overlap between what it sells and who it has sold to.
 */
let app: Hono;
let competitorsApp: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let org: { orgId: string; userId: string; email: string };

let seq = 0;
const T = (h: number) => new Date(Date.UTC(2026, 0, 10, h, 0, 0));

async function seedCompetitor() {
  const n = ++seq;
  const competitorId = `cmp-${n}`;
  const monitorId = `mon-${n}`;
  const snapshotId = `snp-${n}`;
  await testDb
    .insert(competitors)
    .values({ id: competitorId, orgId: org.orgId, name: `C${n}`, url: "https://rival.com" });
  await testDb.insert(monitors).values({ id: monitorId, competitorId, sourceType: "audience_page" });
  await testDb
    .insert(snapshots)
    .values({ id: snapshotId, monitorId, r2Key: `k-${n}`, contentHash: `h-${n}` });
  return { competitorId, monitorId, snapshotId };
}

async function seedPage(
  competitorId: string,
  row: {
    kind: string;
    slug: string;
    displayName?: string;
    isCanonical?: number;
    evidenceUrl?: string;
    firstSeenAt?: Date;
  },
) {
  await testDb.insert(audiencePages).values({
    competitorId,
    kind: row.kind,
    slug: row.slug,
    displayName: row.displayName ?? row.slug,
    isCanonical: row.isCanonical ?? 0,
    evidenceUrl: row.evidenceUrl ?? `https://rival.com/${row.kind}/${row.slug}`,
    ...(row.firstSeenAt ? { firstSeenAt: row.firstSeenAt } : {}),
  });
}

async function seedStory(competitorId: string, industry: string, isCanonical = 1) {
  const n = ++seq;
  await testDb.insert(caseStudies).values({
    competitorId,
    url: `https://rival.com/customers/acme-${n}`,
    customerIndustry: industry,
    isCanonicalIndustry: isCanonical,
  });
}

async function seedSignal(
  src: { competitorId: string; monitorId: string; snapshotId: string },
  detectedAt: Date,
  rawDiff: Record<string, unknown>,
): Promise<string> {
  const n = ++seq;
  await testDb.insert(changes).values({
    id: `chg-${n}`,
    monitorId: src.monitorId,
    snapshotAfterId: src.snapshotId,
    diffText: "audience pages",
    rawDiff,
    detectedAt,
  });
  await testDb.insert(signals).values({
    id: `sig-${n}`,
    changeId: `chg-${n}`,
    orgId: org.orgId,
    competitorId: src.competitorId,
    severity: "medium",
    category: "content",
    insight: `insight ${n}`,
    createdAt: detectedAt,
  });
  return `sig-${n}`;
}

async function profile(competitorId: string) {
  const res = await competitorsApp.request(
    `/api/competitors/${competitorId}/audience-profile`,
    asUser(org.userId),
  );
  expect(res.status).toBe(200);
  return await res.json();
}

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  const { signalsRouter } = await import("../src/routes/signals");
  const { competitorsRouter } = await import("../src/routes/competitors");
  app = mountApp("/api/signals", signalsRouter);
  competitorsApp = mountApp("/api/competitors", competitorsRouter);
  org = await seedOrg(testDb);
});

describe("the three kinds are split", () => {
  test("personas, use cases and industries land in their own lists", async () => {
    const src = await seedCompetitor();
    await seedPage(src.competitorId, { kind: "persona", slug: "agencies", displayName: "Agencies" });
    await seedPage(src.competitorId, {
      kind: "use_case",
      slug: "onboarding",
      displayName: "Onboarding",
    });
    await seedPage(src.competitorId, {
      kind: "industry",
      slug: "fintech",
      displayName: "Fintech",
      isCanonical: 1,
    });

    const p = await profile(src.competitorId);

    expect(p.personas.map((x: { slug: string }) => x.slug)).toEqual(["agencies"]);
    expect(p.useCases.map((x: { slug: string }) => x.slug)).toEqual(["onboarding"]);
    expect(p.industries.declared.map((x: { slug: string }) => x.slug)).toEqual(["fintech"]);
    expect(p.industries.declared[0].isCanonical).toBe(true);
  });
});

describe("declared vs proven", () => {
  test("a vertical they publish AND have stories in lands in both", async () => {
    const src = await seedCompetitor();
    // Declared: two verticals they built a page for.
    await seedPage(src.competitorId, {
      kind: "industry",
      slug: "fintech",
      displayName: "Fin Tech",
      isCanonical: 1,
      evidenceUrl: "https://rival.com/industries/fin-tech",
    });
    await seedPage(src.competitorId, {
      kind: "industry",
      slug: "healthcare",
      displayName: "Healthcare",
      isCanonical: 1,
    });
    // Proven: three stories in one of them, one in a vertical they never claimed.
    await seedStory(src.competitorId, "fintech");
    await seedStory(src.competitorId, "fintech");
    await seedStory(src.competitorId, "fintech");
    await seedStory(src.competitorId, "logistics");

    const p = await profile(src.competitorId);

    expect(p.industries.declared.map((x: { slug: string }) => x.slug).sort()).toEqual([
      "fintech",
      "healthcare",
    ]);
    // Counted in SQL, ordered by how much proof there is.
    expect(p.industries.proven.map((x: { slug: string; count: number }) => [x.slug, x.count])).toEqual(
      [
        ["fintech", 3],
        ["logistics", 1],
      ],
    );
    // The intersection: aiming AND landing. Healthcare is aim-only, logistics is
    // land-only, and neither belongs here.
    expect(p.industries.both).toHaveLength(1);
    expect(p.industries.both[0]).toMatchObject({
      slug: "fintech",
      declaredName: "Fin Tech",
      provenCount: 3,
      evidenceUrl: "https://rival.com/industries/fin-tech",
    });
  });

  test("a story with no vertical at all is not counted as one", async () => {
    const src = await seedCompetitor();
    await testDb.insert(caseStudies).values({
      competitorId: src.competitorId,
      url: "https://rival.com/customers/anonymous",
      customerIndustry: null,
    });

    const p = await profile(src.competitorId);
    expect(p.industries.proven).toHaveLength(0);
  });

  test("a competitor with nothing at all answers empty, never an error", async () => {
    const src = await seedCompetitor();
    const p = await profile(src.competitorId);
    expect(p).toMatchObject({
      personas: [],
      useCases: [],
      industries: { declared: [], proven: [], both: [] },
      newCount: 0,
    });
  });
});

describe("the new badge", () => {
  test("a page from last week is new, one from last year is not", async () => {
    const src = await seedCompetitor();
    await seedPage(src.competitorId, {
      kind: "persona",
      slug: "recent",
      firstSeenAt: new Date(Date.now() - 5 * 86_400_000),
    });
    await seedPage(src.competitorId, {
      kind: "persona",
      slug: "ancient",
      firstSeenAt: new Date(Date.now() - 400 * 86_400_000),
    });

    const p = await profile(src.competitorId);

    const bySlug = new Map(
      p.personas.map((x: { slug: string; isNew: boolean }) => [x.slug, x.isNew]),
    );
    expect(bySlug.get("recent")).toBe(true);
    expect(bySlug.get("ancient")).toBe(false);
    expect(p.newCount).toBe(1);
    expect(p.windowDays).toBe(30);
  });
});

describe("the fact block behind new_persona_page", () => {
  test("names the segments the emitter decided on, with their pages and dates", async () => {
    const src = await seedCompetitor();
    await seedPage(src.competitorId, {
      kind: "persona",
      slug: "enterprise",
      displayName: "Enterprise",
      evidenceUrl: "https://rival.com/for/enterprise",
    });
    await seedPage(src.competitorId, {
      kind: "industry",
      slug: "fintech",
      displayName: "Fintech",
      isCanonical: 1,
      evidenceUrl: "https://rival.com/industries/fintech",
    });
    // Recorded by the same run and NOT part of this signal — a window would sweep it
    // in and render a two-segment expansion as three.
    await seedPage(src.competitorId, { kind: "use_case", slug: "kyc" });

    const signalId = await seedSignal(src, T(9), {
      kind: "new_persona_page",
      pages: [
        { kind: "persona", slug: "enterprise" },
        { kind: "industry", slug: "fintech" },
      ],
    });

    const res = await app.request(`/api/signals/${signalId}/detail`, asUser(org.userId));
    expect(res.status).toBe(200);
    const f = (await res.json()).signal.facts;

    expect(f.kind).toBe("audience_pages");
    expect(f.pagesTotal).toBe(2);
    expect(f.pages.map((p: { displayName: string }) => p.displayName).sort()).toEqual([
      "Enterprise",
      "Fintech",
    ]);
    expect(f.pages[0].firstSeenAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("one slug under two kinds only brings back the kind that was named", async () => {
    // `/industries/fintech` and `/solutions/fintech` are two rows sharing a slug.
    // The SQL narrows on the slug; the (kind, slug) pair is what actually matches.
    const src = await seedCompetitor();
    await seedPage(src.competitorId, {
      kind: "industry",
      slug: "fintech",
      displayName: "Fintech",
      isCanonical: 1,
    });
    await seedPage(src.competitorId, {
      kind: "use_case",
      slug: "fintech",
      displayName: "Fintech Ops",
    });

    const signalId = await seedSignal(src, T(10), {
      kind: "new_persona_page",
      pages: [{ kind: "use_case", slug: "fintech" }],
    });

    const res = await app.request(`/api/signals/${signalId}/detail`, asUser(org.userId));
    const f = (await res.json()).signal.facts;
    expect(f.pagesTotal).toBe(1);
    expect(f.pages[0].displayName).toBe("Fintech Ops");
  });

  test("a change with no kind on the same anchor renders no block", async () => {
    const src = await seedCompetitor();
    const signalId = await seedSignal(src, T(11), { added: [], removed: [] });

    const res = await app.request(`/api/signals/${signalId}/detail`, asUser(org.userId));
    expect((await res.json()).signal.facts).toBeNull();
  });
});
