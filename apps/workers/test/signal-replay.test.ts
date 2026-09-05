import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import * as ai from "@outrival/ai";
import { eq } from "drizzle-orm";
import { makeTestDb, schema, type TestDb } from "./db-harness";
import { clearQueueOverrides, setQueueOverrides } from "./queue-mock";
import { runGenerateSignal } from "../src/core/generate-signal";
import { runClassifyChange } from "../src/core/classify-change";

let db: TestDb;
let insightSpy: ReturnType<typeof spyOn<typeof ai, "generateInsight">>;
const classification: ai.Classification = {
  category: "pricing", severity: "medium", is_significant: true,
  reason: "Team price changed", humanChangeBefore: "$49", humanChangeAfter: "$79",
  materiality: { decision_impact: 1, urgency: 1, corroboration: 1 },
};

beforeAll(async () => {
  db = (await makeTestDb()).db;
  // Archive fixtures take the real signal insert/dispatch path without sending
  // alerts, evaluating conditions or contacting any external provider.
  setQueueOverrides({ sendAlert: { enqueue: async () => { throw new Error("Unexpected alert"); } } });
  insightSpy = spyOn(ai, "generateInsight").mockResolvedValue(ai.attachQuality({
    insight: "Team price changed from $49 to $79.", so_what: "Review the competing offer.",
    recommended_action: "Compare the Team plan.",
  }, ai.emptyQuality()));
  for (const org of ["a", "b"]) {
    await db.insert(schema.organizations).values({ id: `replay-${org}`, name: org, slug: `replay-${org}` });
    await db.insert(schema.competitors).values({ id: `cmp-${org}`, orgId: `replay-${org}`, name: org });
    await db.insert(schema.monitors).values({ id: `mon-${org}`, competitorId: `cmp-${org}`, sourceType: "pricing" });
    for (const phase of ["before", "after"]) {
      await db.insert(schema.snapshots).values({
        id: `snp-${org}-${phase}`, monitorId: `mon-${org}`, r2Key: `test/${org}/${phase}`,
        contentHash: `${org}-${phase}`, origin: "archive",
      });
    }
    await db.insert(schema.changes).values({
      id: `chg-${org}`, monitorId: `mon-${org}`, snapshotBeforeId: `snp-${org}-before`,
      snapshotAfterId: `snp-${org}-after`, diffText: "- Team $49\n+ Team $79", diffType: "text",
    });
  }
}, 30_000);

afterAll(() => {
  insightSpy?.mockRestore();
  clearQueueOverrides();
});

describe("OUT-278 signal replay against migrated Postgres", () => {
  test("failed generation leaves a replayable change; duplicate replays stay in its organization", async () => {
    const payload = { changeId: "chg-a", classification, skipVerification: true };
    insightSpy.mockRejectedValueOnce(new ai.AIUnavailableError("all_providers_failed: injected 503"));
    await expect(runGenerateSignal(payload)).rejects.toThrow("all_providers_failed");
    expect(await db.select().from(schema.signals)).toHaveLength(0);
    expect(await db.query.changes.findFirst({ where: eq(schema.changes.id, "chg-a") })).toBeDefined();

    // Even a stale/foreign envelope must not determine ownership: the worker
    // resolves it from change -> monitor -> competitor, and Zod strips extras.
    const replay = { ...payload, orgId: "replay-b", competitorId: "cmp-b" };
    await Promise.all([runGenerateSignal(replay), runGenerateSignal(replay)]);
    await runGenerateSignal(replay);
    const rows = await db.select().from(schema.signals);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.changeId).toBe("chg-a");
    expect(rows[0]?.orgId).toBe("replay-a");
    expect(rows[0]?.competitorId).toBe("cmp-a");
    expect(rows[0]?.dispatchedChannel).toBe("in_app_only");
    expect(await db.select().from(schema.signals).where(eq(schema.signals.orgId, "replay-b"))).toHaveLength(0);
    const result = await runClassifyChange({ changeId: "chg-a" });
    expect(result).toMatchObject({ skipped: true, signalId: rows[0]?.id });
  });
});
