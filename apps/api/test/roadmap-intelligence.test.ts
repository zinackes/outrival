import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import {
  changes,
  competitors,
  contentItems,
  knownIntegrations,
  monitors,
  roadmapStatusEvents,
  signals,
  snapshots,
} from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

/**
 * Content Intelligence v2 P5, read side: what the battle-card section is built
 * from, and what the two new signal blocks show.
 *
 * Everything here is read off rows the ingest jobs wrote, so what is worth pinning
 * is that none of it can state something the competitor did not publish: a delivered
 * count that excludes the baseline pass (or a competitor added last week would read
 * as having shipped its whole history since), a top-requested list that drops what
 * they have already delivered, and fact blocks that name the exact set the emitter
 * decided on rather than whatever else the same run recorded.
 */
let app: Hono;
let competitorsApp: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let org: { orgId: string; userId: string; email: string };

let seq = 0;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function seedCompetitor(sourceType = "roadmap") {
  const n = ++seq;
  const competitorId = `cmp-${n}`;
  const monitorId = `mon-${n}`;
  const snapshotId = `snp-${n}`;
  await testDb.insert(competitors).values({ id: competitorId, orgId: org.orgId, name: `C${n}` });
  await testDb.insert(monitors).values({
    id: monitorId,
    competitorId,
    sourceType,
    lastRunAt: new Date(Date.UTC(2026, 6, 20, 9, 0, 0)),
  });
  await testDb
    .insert(snapshots)
    .values({ id: snapshotId, monitorId, r2Key: `k-${n}`, contentHash: `h-${n}` });
  return { competitorId, monitorId, snapshotId };
}

async function seedEntry(
  competitorId: string,
  entry: { title: string; votes: number | null; status: string; normalized: string },
): Promise<string> {
  const n = ++seq;
  await testDb.insert(contentItems).values({
    id: `itm-${n}`,
    competitorId,
    sourceType: "roadmap",
    externalId: `ext-${n}`,
    title: entry.title,
    url: `https://rival.com/p/${n}`,
    votes: entry.votes,
    status: entry.status,
    statusNormalized: entry.normalized,
    itemType: "roadmap_entry",
  });
  return `itm-${n}`;
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
    diffText: "roadmap",
    rawDiff,
    detectedAt,
  });
  await testDb.insert(signals).values({
    id: `sig-${n}`,
    changeId: `chg-${n}`,
    orgId: org.orgId,
    competitorId: src.competitorId,
    severity: "medium",
    category: "product",
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

async function roadmap(competitorId: string) {
  const res = await competitorsApp.request(
    `/api/competitors/${competitorId}/roadmap`,
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

describe("GET /:id/roadmap — top requested, not delivered", () => {
  test("their open requests come back in vote order, with the portal's own labels", async () => {
    const { competitorId } = await seedCompetitor();
    await seedEntry(competitorId, {
      title: "SSO / SAML",
      votes: 142,
      status: "under review",
      normalized: "under_review",
    });
    await seedEntry(competitorId, {
      title: "Public API",
      votes: 90,
      status: "up next",
      normalized: "planned",
    });

    const body = await roadmap(competitorId);

    expect(body.topRequested.map((r: { title: string }) => r.title)).toEqual([
      "SSO / SAML",
      "Public API",
    ]);
    // Their word, not our vocabulary.
    expect(body.topRequested[1].status).toBe("up next");
    expect(body.asOf).toContain("2026-07-20");
  });

  test("what they have delivered or refused is not a request anymore", async () => {
    const { competitorId } = await seedCompetitor();
    await seedEntry(competitorId, {
      title: "Shipped thing",
      votes: 900,
      status: "complete",
      normalized: "delivered",
    });
    await seedEntry(competitorId, {
      title: "Refused thing",
      votes: 800,
      status: "won't do",
      normalized: "closed",
    });
    await seedEntry(competitorId, {
      title: "Still open",
      votes: 10,
      status: "planned",
      normalized: "planned",
    });

    const body = await roadmap(competitorId);

    expect(body.topRequested.map((r: { title: string }) => r.title)).toEqual(["Still open"]);
  });

  test("an entry whose portal publishes no count cannot be ranked", async () => {
    const { competitorId } = await seedCompetitor();
    await seedEntry(competitorId, {
      title: "Uncounted",
      votes: null,
      status: "planned",
      normalized: "planned",
    });

    expect((await roadmap(competitorId)).topRequested).toEqual([]);
  });

  test("a column we do not recognise still counts as open", async () => {
    const { competitorId } = await seedCompetitor();
    await seedEntry(competitorId, {
      title: "Needs design",
      votes: 30,
      status: "needs design",
      normalized: "other",
    });

    expect((await roadmap(competitorId)).topRequested).toHaveLength(1);
  });
});

describe("GET /:id/roadmap — delivered in the window", () => {
  test("counts the moves we WATCHED, never the baseline pass", async () => {
    const { competitorId } = await seedCompetitor();
    const itemId = await seedEntry(competitorId, {
      title: "Thing",
      votes: 5,
      status: "complete",
      normalized: "delivered",
    });
    await testDb.insert(roadmapStatusEvents).values([
      // The first read of the portal: years of history, arriving at once.
      {
        id: `evt-b-${++seq}`,
        contentItemId: itemId,
        competitorId,
        fromStatus: null,
        toStatus: "delivered",
        toRaw: "complete",
        occurredAt: daysAgo(3),
        isBaseline: 1,
      },
      // One move we actually saw happen.
      {
        id: `evt-a-${++seq}`,
        contentItemId: itemId,
        competitorId,
        fromStatus: "in_progress",
        toStatus: "delivered",
        fromRaw: "in progress",
        toRaw: "complete",
        occurredAt: daysAgo(10),
        isBaseline: 0,
      },
      // And one from before the window.
      {
        id: `evt-o-${++seq}`,
        contentItemId: itemId,
        competitorId,
        fromStatus: "planned",
        toStatus: "delivered",
        toRaw: "complete",
        occurredAt: daysAgo(200),
        isBaseline: 0,
      },
    ]);

    const body = await roadmap(competitorId);

    expect(body.deliveredLast90d).toBe(1);
    expect(body.windowDays).toBe(90);
  });

  test("a competitor with no portal answers empty rather than 404", async () => {
    const { competitorId } = await seedCompetitor("homepage");
    const body = await roadmap(competitorId);
    expect(body.topRequested).toEqual([]);
    expect(body.deliveredLast90d).toBe(0);
    expect(body.asOf).toBeNull();
  });
});

describe("top_request_planned facts", () => {
  test("the block quotes the counts as the portal published them at the move", async () => {
    const src = await seedCompetitor("roadmap_shift");
    const signalId = await seedSignal(src, daysAgo(1), {
      kind: "top_request_planned",
      itemId: "itm-x",
      title: "SSO / SAML",
      url: "https://rival.com/p/sso",
      votes: 142,
      rank: 1,
      fromRaw: "under review",
      toRaw: "planned",
      alsoMoved: [
        {
          title: "Public API",
          url: null,
          votes: 90,
          rank: 2,
          fromRaw: "under review",
          toRaw: "planned",
        },
      ],
    });

    const block = await facts(signalId);

    expect(block.kind).toBe("roadmap_request");
    expect(block.request).toMatchObject({ title: "SSO / SAML", votes: 142, rank: 1 });
    expect(block.request.fromRaw).toBe("under review");
    expect(block.alsoMoved).toHaveLength(1);
    expect(block.alsoMoved[0].title).toBe("Public API");
  });

  test("a roadmap change with no deterministic move shows no block", async () => {
    const src = await seedCompetitor("roadmap");
    const signalId = await seedSignal(src, daysAgo(2), { added: ["x"], removed: [] });
    expect(await facts(signalId)).toBeNull();
  });
});

describe("integration_published facts", () => {
  test("the block names exactly the set the emitter decided on", async () => {
    const src = await seedCompetitor("integration_catalog");
    await testDb.insert(knownIntegrations).values([
      {
        id: `int-${++seq}`,
        competitorId: src.competitorId,
        nameNormalized: "zapier",
        displayName: "Zapier",
        evidenceUrl: "https://rival.com/integrations/zapier",
      },
      {
        id: `int-${++seq}`,
        competitorId: src.competitorId,
        nameNormalized: "linear",
        displayName: "Linear",
        evidenceUrl: "https://rival.com/integrations/linear",
      },
      // Recorded by the same run, but NOT part of this signal.
      {
        id: `int-${++seq}`,
        competitorId: src.competitorId,
        nameNormalized: "segment",
        displayName: "Segment",
        evidenceUrl: null,
      },
    ]);
    const signalId = await seedSignal(src, daysAgo(1), {
      kind: "integration_published",
      names: ["Zapier", "Linear"],
      evidenceUrl: "https://rival.com/integrations",
    });

    const block = await facts(signalId);

    expect(block.kind).toBe("integrations");
    expect(block.integrationsTotal).toBe(2);
    expect(block.integrations.map((i: { name: string }) => i.name).sort()).toEqual([
      "Linear",
      "Zapier",
    ]);
    expect(block.evidenceUrl).toBe("https://rival.com/integrations");
  });
});
