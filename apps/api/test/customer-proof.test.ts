import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import {
  caseStudies,
  changes,
  competitors,
  knownCustomers,
  monitors,
  signals,
  snapshots,
} from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

/**
 * Content Intelligence v2 P3, read side: what a customer signal SHOWS, and what
 * the deterministic battle-card section is built from.
 *
 * Both are read off rows the ingest job wrote, so what is worth pinning here is
 * that neither can render something the competitor did not publish: an anonymised
 * story shows no name, a free-text market never becomes a vertical, and a win
 * block names the exact customers the emitter decided on rather than whoever else
 * the same run happened to record.
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
  await testDb.insert(competitors).values({ id: competitorId, orgId: org.orgId, name: `C${n}` });
  await testDb.insert(monitors).values({ id: monitorId, competitorId, sourceType: "customer_proof" });
  await testDb
    .insert(snapshots)
    .values({ id: snapshotId, monitorId, r2Key: `k-${n}`, contentHash: `h-${n}` });
  return { competitorId, monitorId, snapshotId };
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
    diffText: "customer proof",
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

async function facts(signalId: string) {
  const res = await app.request(`/api/signals/${signalId}/detail`, asUser(org.userId));
  expect(res.status).toBe(200);
  return (await res.json()).signal.facts;
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

describe("case_study facts", () => {
  test("the story is named with its market and its VERBATIM metrics", async () => {
    const src = await seedCompetitor();
    const [study] = await testDb
      .insert(caseStudies)
      .values({
        competitorId: src.competitorId,
        url: "https://rival.com/customers/northwind",
        title: "How Northwind cut claims handling",
        customerName: "Northwind Assurance",
        customerIndustry: "insurance",
        customerIndustryLabel: "insurance broker",
        isCanonicalIndustry: 1,
        metricsClaimed: ["cut claims handling by 40%"],
      })
      .returning({ id: caseStudies.id });

    const signalId = await seedSignal(src, T(9), {
      kind: "case_study_published",
      caseStudyId: study!.id,
      sameMarket: true,
    });

    const f = await facts(signalId);
    expect(f.kind).toBe("case_study");
    expect(f.customerName).toBe("Northwind Assurance");
    // A canonical slug renders as the shared label, so two competitors' stories in
    // the same market read the same way.
    expect(f.industry).toBe("insurance");
    expect(f.sameMarket).toBe(true);
    expect(f.metrics).toEqual(["cut claims handling by 40%"]);
  });

  test("an anonymised story shows no name, and a free-text market shows the page's wording", async () => {
    const src = await seedCompetitor();
    const [study] = await testDb
      .insert(caseStudies)
      .values({
        competitorId: src.competitorId,
        url: "https://rival.com/customers/anonymous",
        title: "A leading European bank",
        customerName: null,
        customerIndustry: "particle_physics_lab",
        customerIndustryLabel: "particle physics lab",
        isCanonicalIndustry: 0,
        metricsClaimed: [],
      })
      .returning({ id: caseStudies.id });

    const signalId = await seedSignal(src, T(10), {
      kind: "case_study_published",
      caseStudyId: study!.id,
      sameMarket: false,
    });

    const f = await facts(signalId);
    expect(f.customerName).toBe(null);
    expect(f.industry).toBe("particle physics lab");
    expect(f.sameMarket).toBe(false);
  });
});

describe("customer_win facts", () => {
  test("the block names the customers the signal was about, and nobody else", async () => {
    const src = await seedCompetitor();
    await testDb.insert(knownCustomers).values([
      {
        competitorId: src.competitorId,
        nameNormalized: "acme",
        displayName: "Acme",
        source: "customers_page",
        evidenceUrl: "https://rival.com/customers",
        firstSeenAt: T(1),
      },
      {
        competitorId: src.competitorId,
        nameNormalized: "northwind",
        displayName: "Northwind",
        source: "customers_page",
        evidenceUrl: "https://rival.com/customers",
        firstSeenAt: T(9),
      },
      {
        competitorId: src.competitorId,
        nameNormalized: "vandelay",
        displayName: "Vandelay",
        source: "case_study",
        evidenceUrl: "https://rival.com/customers/vandelay",
        firstSeenAt: T(9),
      },
    ]);

    // The emitter decided on two names. Acme was in the registry long before and
    // must not be swept in by a window over the same competitor.
    const signalId = await seedSignal(src, T(9), {
      kind: "customer_win",
      names: ["Northwind", "Vandelay"],
      evidenceUrl: "https://rival.com/customers",
    });

    const f = await facts(signalId);
    expect(f.kind).toBe("customer_win");
    expect(f.customersTotal).toBe(2);
    expect(f.customers.map((c: { name: string }) => c.name).sort()).toEqual([
      "Northwind",
      "Vandelay",
    ]);
    expect(f.evidenceUrl).toBe("https://rival.com/customers");
  });
});

describe("GET /:id/customers", () => {
  test("verticals count canonical markets only, and every list states its n", async () => {
    const src = await seedCompetitor();
    await testDb.insert(caseStudies).values([
      {
        competitorId: src.competitorId,
        url: "https://rival.com/c/1",
        customerIndustry: "insurance",
        isCanonicalIndustry: 1,
      },
      {
        competitorId: src.competitorId,
        url: "https://rival.com/c/2",
        customerIndustry: "insurance",
        isCanonicalIndustry: 1,
      },
      // Free text: one page's own wording, so it is not a market anybody shares.
      {
        competitorId: src.competitorId,
        url: "https://rival.com/c/3",
        customerIndustry: "particle_physics_lab",
        customerIndustryLabel: "particle physics lab",
        isCanonicalIndustry: 0,
      },
    ]);
    await testDb.insert(knownCustomers).values([
      {
        competitorId: src.competitorId,
        nameNormalized: "old customer",
        displayName: "Old Customer",
        source: "customers_page",
        // Long before the window: on their wall when we arrived, not a win.
        firstSeenAt: new Date(Date.UTC(2025, 0, 1)),
      },
      {
        competitorId: src.competitorId,
        nameNormalized: "fresh win",
        displayName: "Fresh Win",
        source: "customers_page",
        firstSeenAt: new Date(),
      },
    ]);

    const res = await competitorsApp.request(
      `/api/competitors/${src.competitorId}/customers`,
      asUser(org.userId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.verticals).toEqual([{ slug: "insurance", label: "insurance", count: 2 }]);
    expect(body.storiesTotal).toBe(3);
    expect(body.customersTotal).toBe(2);
    expect(body.wins.map((w: { name: string }) => w.name)).toEqual(["Fresh Win"]);
    expect(body.marquee[0].name).toBe("Old Customer");
  });

  test("another org's competitor is not readable", async () => {
    const other = await seedOrg(testDb);
    const src = await seedCompetitor();
    const res = await competitorsApp.request(
      `/api/competitors/${src.competitorId}/customers`,
      asUser(other.userId),
    );
    expect(res.status).toBe(404);
  });
});
