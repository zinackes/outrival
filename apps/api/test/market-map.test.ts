import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { changes, competitors, monitors, namedCompetitors, signals, snapshots } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

/**
 * Positioning Intelligence v2 P2, read side: the market map and the fact block
 * behind `new_comparison_target`.
 *
 * The test that must never be deleted is the last one. "Who names this competitor"
 * is a CROSS REFERENCE over a table every workspace writes into, and decision 2 of
 * the card is that it stays intra-workspace STRICT. The failure mode is silent —
 * the shape of the answer does not change, only whose data is in it — so this file
 * seeds two workspaces holding the same rival and breaks if a foreign row ever
 * comes out.
 */
let app: Hono;
let competitorsApp: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let org: { orgId: string; userId: string; email: string };

let seq = 0;
const T = (h: number) => new Date(Date.UTC(2026, 0, 10, h, 0, 0));

async function seedCompetitor(opts: { orgId?: string; name?: string; url?: string } = {}) {
  const n = ++seq;
  const competitorId = `cmp-${n}`;
  const monitorId = `mon-${n}`;
  const snapshotId = `snp-${n}`;
  await testDb.insert(competitors).values({
    id: competitorId,
    orgId: opts.orgId ?? org.orgId,
    name: opts.name ?? `C${n}`,
    url: opts.url ?? null,
  });
  await testDb
    .insert(monitors)
    .values({ id: monitorId, competitorId, sourceType: "comparison_page" });
  await testDb
    .insert(snapshots)
    .values({ id: snapshotId, monitorId, r2Key: `k-${n}`, contentHash: `h-${n}` });
  return { competitorId, monitorId, snapshotId };
}

async function seedTarget(
  competitorId: string,
  row: {
    displayName: string;
    nameNormalized?: string;
    namedDomain?: string | null;
    source?: string;
    evidenceUrl?: string;
    signalledAt?: Date | null;
  },
) {
  await testDb.insert(namedCompetitors).values({
    competitorId,
    nameNormalized: row.nameNormalized ?? row.displayName.toLowerCase(),
    displayName: row.displayName,
    namedDomain: row.namedDomain ?? null,
    source: row.source ?? "vs_page",
    evidenceUrl: row.evidenceUrl ?? `https://rival.com/vs/${row.displayName.toLowerCase()}`,
    signalledAt: row.signalledAt ?? null,
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
    diffText: "comparison target",
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

async function marketMap(competitorId: string, userId = org.userId) {
  const res = await competitorsApp.request(
    `/api/competitors/${competitorId}/market-map`,
    asUser(userId),
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

describe("who they attack", () => {
  test("targets fold across every page that names them", async () => {
    const src = await seedCompetitor();
    await seedTarget(src.competitorId, {
      displayName: "Aviso",
      source: "vs_page",
      evidenceUrl: "https://rival.com/vs/aviso",
    });
    await seedTarget(src.competitorId, {
      displayName: "Aviso",
      source: "blog",
      evidenceUrl: "https://rival.com/blog/aviso",
    });

    const map = await marketMap(src.competitorId);

    expect(map.targetsTotal).toBe(1);
    expect(map.targets[0].name).toBe("Aviso");
    expect(map.targets[0].sources.sort()).toEqual(["blog", "vs_page"]);
    expect(map.targets[0].evidenceUrls).toHaveLength(2);
    // The page is the front; the post that also names them is evidence for it, not
    // a second entry.
    expect(map.mentions).toEqual([]);
  });

  // OUT-180. A blog post naming a company used to render exactly like a `/vs/` page
  // built against them, so a registry read as lining up against the airline its own
  // launch post named. The evidence differs, so the two lists have to.
  test("a name only a post carries is a mention, never a front", async () => {
    const src = await seedCompetitor();
    await seedTarget(src.competitorId, {
      displayName: "Solvex",
      source: "vs_page",
      evidenceUrl: "https://rival.com/vs/solvex",
    });
    await seedTarget(src.competitorId, {
      displayName: "Airavia",
      source: "blog",
      evidenceUrl: "https://rival.com/blog/launch",
    });
    await seedTarget(src.competitorId, {
      displayName: "Chipworks",
      source: "docs",
      evidenceUrl: "https://rival.com/docs/gpu",
    });

    const map = await marketMap(src.competitorId);

    expect(map.targets.map((t: { name: string }) => t.name)).toEqual(["Solvex"]);
    expect(map.targetsTotal).toBe(1);
    expect(map.mentions.map((t: { name: string }) => t.name).sort()).toEqual([
      "Airavia",
      "Chipworks",
    ]);
    expect(map.mentionsTotal).toBe(2);
  });
});

describe("the fact block behind new_comparison_target", () => {
  test("names the rivals the emitter decided on, with their pages and dates", async () => {
    const src = await seedCompetitor();
    await seedTarget(src.competitorId, {
      displayName: "Cognism",
      evidenceUrl: "https://rival.com/vs/cognism",
    });
    await seedTarget(src.competitorId, {
      displayName: "Lusha",
      evidenceUrl: "https://rival.com/vs/lusha",
    });
    // Recorded by the same run and NOT part of this signal — a window would sweep
    // it in and render a two-target front as three.
    await seedTarget(src.competitorId, { displayName: "Apollo" });

    const signalId = await seedSignal(src, T(9), {
      kind: "new_comparison_target",
      targets: ["cognism", "lusha"],
    });

    const res = await app.request(`/api/signals/${signalId}/detail`, asUser(org.userId));
    expect(res.status).toBe(200);
    const f = (await res.json()).signal.facts;

    expect(f.kind).toBe("comparison_targets");
    expect(f.targetsTotal).toBe(2);
    expect(f.targets.map((t: { name: string }) => t.name).sort()).toEqual(["Cognism", "Lusha"]);
    expect(f.targets[0].evidenceUrl).toMatch(/\/vs\//);
    expect(f.targets[0].firstSeenAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("a plain sitemap change on the same anchor still renders no block", async () => {
    // The comparison_page anchor carries three kinds of change now. A change with
    // no `kind` is the sitemap detector's own, and it must fall through to null
    // exactly as it did before this phase.
    const src = await seedCompetitor();
    const signalId = await seedSignal(src, T(11), {
      added: ["https://rival.com/compare"],
      removed: [],
    });

    const res = await app.request(`/api/signals/${signalId}/detail`, asUser(org.userId));
    const f = (await res.json()).signal.facts;
    expect(f).toBeNull();
  });
});

describe("who names them — intra-workspace STRICT", () => {
  test("another competitor of the SAME workspace is reported", async () => {
    const rival = await seedCompetitor({ name: "Klue", url: "https://klue.com" });
    const attacker = await seedCompetitor({ name: "Crayon" });
    await seedTarget(attacker.competitorId, {
      displayName: "Klue",
      evidenceUrl: "https://crayon.co/vs/klue",
    });

    const map = await marketMap(rival.competitorId);

    expect(map.namedBy).toHaveLength(1);
    expect(map.namedBy[0].competitorName).toBe("Crayon");
    expect(map.namedBy[0].matchedOn).toBe("brand");
    expect(map.namedBy[0].evidenceUrls).toEqual(["https://crayon.co/vs/klue"]);
  });

  test("a domain match outranks a brand match", async () => {
    const rival = await seedCompetitor({ name: "Kompyte", url: "https://kompyte.com" });
    const attacker = await seedCompetitor({ name: "Crayon" });
    await seedTarget(attacker.competitorId, {
      displayName: "Kompyte",
      namedDomain: "kompyte.com",
      evidenceUrl: "https://crayon.co/vs/kompyte.com",
    });

    const map = await marketMap(rival.competitorId);
    expect(map.namedBy[0].matchedOn).toBe("domain");
  });

  test("a row belonging to ANOTHER workspace never comes out", async () => {
    // This is decision 2 of the card. Two workspaces track the same rival; the
    // other one's competitor has published a page against it. If this ever fails,
    // one customer is being shown another customer's intelligence.
    const other = await seedOrg(testDb);
    const rival = await seedCompetitor({ name: "Gong", url: "https://gong.io" });
    const foreignAttacker = await seedCompetitor({ orgId: other.orgId, name: "Chorus" });
    await seedTarget(foreignAttacker.competitorId, {
      displayName: "Gong",
      namedDomain: "gong.io",
      evidenceUrl: "https://chorus.ai/vs/gong",
    });

    const map = await marketMap(rival.competitorId);

    expect(map.namedBy).toEqual([]);

    // And the row IS there — the query is what excludes it, not an empty table.
    const seededForOther = await marketMap(foreignAttacker.competitorId, other.userId);
    expect(seededForOther.targets.map((t: { name: string }) => t.name)).toEqual(["Gong"]);
  });

  test("a competitor naming itself is not reported", async () => {
    const rival = await seedCompetitor({ name: "Klarity", url: "https://klarity.io" });
    await seedTarget(rival.competitorId, { displayName: "Klarity" });

    const map = await marketMap(rival.competitorId);
    expect(map.namedBy).toEqual([]);
  });

  test("a brand that is an ordinary word needs the domain", async () => {
    const rival = await seedCompetitor({ name: "Flow", url: null });
    const attacker = await seedCompetitor({ name: "Crayon" });
    await seedTarget(attacker.competitorId, {
      displayName: "Flow",
      evidenceUrl: "https://crayon.co/compare/flow",
    });

    const map = await marketMap(rival.competitorId);
    // Without this, every /compare/flow page on the internet is reported as
    // naming this workspace's rival.
    expect(map.namedBy).toEqual([]);
  });
});
