import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { makeTestDb, schema, type TestDb } from "./db-harness";

/**
 * `ai_visibility_shift`, end to end — Positioning Intelligence v2 P5.
 *
 * The unit tests in `ai-visibility-shift.test.ts` hold the arithmetic. This file
 * runs the actual job against a real (in-process) Postgres and asserts what the
 * reader ends up seeing: the anchor change, its rawDiff (which is what the fact
 * block reads back), and the classification handed to the signal pipeline.
 *
 * Three things are asserted that only show themselves here. The severity is MEDIUM
 * and comes from the emitter, not from a model. The window is measured over the
 * rows the run just joined, not against the previous run. And a subject that
 * signalled inside the cooldown produces nothing on the next sweep, however far
 * its rate has moved since.
 *
 * The engine client and the extraction are stubbed: the phase reads what the runs
 * wrote, it does not orchestrate them. No real model is called, here or in the code
 * under test's new paths.
 */

let testDb: TestDb;
let closeDb: () => Promise<void>;
let runScrapeAiVisibility: (payload: {
  orgId: string;
  productId?: string;
}) => Promise<Record<string, unknown>>;

interface Enqueued {
  changeId: string;
  classification: {
    category: string;
    severity: string;
    reason: string;
    humanChangeBefore: string;
    humanChangeAfter: string;
  };
}
let enqueued: Enqueued[] = [];

/** The answer every stubbed engine call returns this test. */
let engineAnswer = "";

const DAY = 86_400_000;

beforeAll(async () => {
  const realQueue = await import("@outrival/queue");
  const realShared = await import("@outrival/shared");
  const realAi = await import("@outrival/ai");
  const realAnalytics = await import("../src/lib/analytics");
  const harness = await makeTestDb();
  testDb = harness.db;
  closeDb = harness.close;

  mock.module("@outrival/db", () => ({ ...schema, db: harness.db }));
  mock.module("@outrival/queue", () => ({
    ...realQueue,
    NonRetriable: realQueue.NonRetriable,
    generateSignal: {
      queue: "generate-signal",
      enqueue: async (payload: Enqueued) => {
        enqueued.push(payload);
        return "job-id";
      },
    },
  }));
  // Spread the REAL modules: these mocks are process-global and outlive the file,
  // so a partial one breaks whatever later file imports them, depending only on
  // the order bun picked.
  mock.module("@outrival/shared", () => ({
    ...realShared,
    uploadToR2: async () => undefined,
  }));
  mock.module("@outrival/ai", () => ({
    ...realAi,
    // Names every roster subject present in the answer text. The job re-checks
    // that verdict against the answer itself, so this cannot invent mentions.
    extractAiVisibility: async (answer: string, subjects: string[]) => ({
      mentions: subjects.map((name) => ({
        name,
        mentioned: answer.toLowerCase().includes(name.toLowerCase()),
        rank: answer.toLowerCase().includes(name.toLowerCase()) ? 1 : null,
        cited: false,
        sentiment: 70,
      })),
    }),
  }));
  mock.module("../src/lib/analytics", () => ({
    ...realAnalytics,
    // The insight/extraction accounting writes ai_runs; the phase's claim is that it
    // adds no CALL, not that it rewires the ledger. Pass the work through untouched.
    loggedAi: async <T>(_task: string, _cfg: unknown, fn: () => Promise<T>) => await fn(),
  }));
  mock.module("../src/lib/ai-visibility/engines", () => ({
    EngineQuotaError: class extends Error {},
    queryEngine: async () => ({ answer: engineAnswer, engine: "gemini", model: "stub" }),
  }));

  ({ runScrapeAiVisibility } = await import("../src/core/scrape-ai-visibility"));
});

afterAll(() => closeDb());
beforeEach(() => {
  enqueued = [];
  engineAnswer = "";
});

let seq = 0;

/**
 * A workspace whose rival was named in every answer of the PREVIOUS window and in
 * none of the current one so far. The sweep the test then runs adds this run's own
 * rows to the current window.
 */
async function seedWorkspace(opts: { previousMentions: number; previousRuns: number }) {
  const n = ++seq;
  const orgId = `org-${n}`;
  const selfId = `self-${n}`;
  const rivalId = `rival-${n}`;
  const productId = `prd-${n}`;
  const promptId = `prm-${n}`;

  await testDb.insert(schema.organizations).values({ id: orgId, name: `Org ${n}`, slug: orgId });
  await testDb
    .insert(schema.competitors)
    .values({ id: selfId, orgId, name: "Our Product", type: "self", url: "https://us.com" });
  await testDb
    .insert(schema.competitors)
    .values({ id: rivalId, orgId, name: "Acme CRM", url: "https://acme.com" });
  await testDb
    .insert(schema.products)
    .values({ id: productId, orgId, name: "Main", selfCompetitorId: selfId, isPrimary: true });
  await testDb.insert(schema.productCompetitors).values({ productId, competitorId: rivalId });
  await testDb
    .insert(schema.aiVisibilityPrompts)
    .values({ id: promptId, orgId, productId, prompt: "best CRM for startups", isActive: true });

  const now = Date.now();
  // Previous window (29-40 days back).
  for (let i = 0; i < opts.previousRuns; i++) {
    await testDb.insert(schema.aiVisibilityResults).values({
      orgId,
      productId,
      promptId,
      competitorId: rivalId,
      engine: "gemini",
      mentioned: i < opts.previousMentions ? 1 : 0,
      promptNamed: 0,
      rank: i < opts.previousMentions ? 1 : null,
      runId: `prev-${n}-${i}`,
      recordedAt: new Date(now - (29 + i) * DAY),
    });
  }
  // Current window, before this sweep: never named.
  for (let i = 0; i < 11; i++) {
    await testDb.insert(schema.aiVisibilityResults).values({
      orgId,
      productId,
      promptId,
      competitorId: rivalId,
      engine: "gemini",
      mentioned: 0,
      promptNamed: 0,
      runId: `curr-${n}-${i}`,
      recordedAt: new Date(now - (1 + i) * DAY),
    });
  }

  return { orgId, selfId, rivalId, productId };
}

describe("runScrapeAiVisibility → ai_visibility_shift", () => {
  test("a window-over-window collapse lands as one MEDIUM signal on a synthetic anchor", async () => {
    const { orgId, rivalId } = await seedWorkspace({ previousMentions: 12, previousRuns: 12 });
    // This sweep's own answer does not name them either.
    engineAnswer = "For small teams, several options exist, none of them named here.";

    const result = await runScrapeAiVisibility({ orgId });
    expect(result.signalled).toBe(1);
    expect(enqueued).toHaveLength(1);

    const c = enqueued[0]!.classification;
    // Never critical, never high: the measurement runs through an LLM's own variance.
    expect(c.severity).toBe("medium");
    expect(c.category).toBe("content");
    expect(c.humanChangeBefore).toBe("Named in 100% of AI answers");
    expect(c.humanChangeAfter).toBe("Named in 0% of AI answers");
    expect(c.reason).toContain("Acme CRM");

    // The anchor: an ai_visibility monitor that is never scheduled, its snapshot,
    // and the change the fact block reads back.
    const [monitor] = await testDb
      .select()
      .from(schema.monitors)
      .where(
        and(
          eq(schema.monitors.competitorId, rivalId),
          eq(schema.monitors.sourceType, "ai_visibility"),
        ),
      );
    expect(monitor).toBeDefined();
    expect(monitor!.isActive).toBe(false);

    const [change] = await testDb
      .select()
      .from(schema.changes)
      .where(eq(schema.changes.monitorId, monitor!.id));
    expect(change!.id).toBe(enqueued[0]!.changeId);
    // The sweep queries both configured engines, so its own two rows join the 11
    // already in the window — 13 answers, on two engines. The engines and the
    // denominator travel with the rate for exactly this reason.
    expect(change!.diffText).toContain(
      "AI visibility — mention rate 100% → 0% (Gemini+Perplexity, 13 answers)",
    );

    const raw = change!.rawDiff as {
      kind: string;
      driver: string;
      isSelf: boolean;
      current: { mentionRate: number; nRuns: number; engines: string[] };
      previous: { mentionRate: number; nRuns: number };
    };
    expect(raw.kind).toBe("ai_visibility_shift");
    expect(raw.driver).toBe("mention_rate");
    expect(raw.isSelf).toBe(false);
    expect(raw.previous.mentionRate).toBe(1);
    expect(raw.previous.nRuns).toBe(12);
    expect(raw.current.mentionRate).toBe(0);
    // 11 seeded runs plus the one this sweep just wrote.
    expect(raw.current.nRuns).toBe(12);
    // Two engines answered this window, so the fact block gets the split.
    expect(raw.current.engines).toEqual(["gemini", "perplexity"]);
  });

  test("the same sweep run twice signals ONCE — the cooldown holds", async () => {
    const { orgId } = await seedWorkspace({ previousMentions: 12, previousRuns: 12 });
    engineAnswer = "For small teams, several options exist, none of them named here.";

    const first = await runScrapeAiVisibility({ orgId });
    expect(first.signalled).toBe(1);

    const second = await runScrapeAiVisibility({ orgId });
    expect(second.signalled).toBe(0);
    expect(enqueued).toHaveLength(1);
  });

  test("a previous window under the run minimum signals nothing", async () => {
    // Same collapse, but only three runs to compare against.
    const { orgId } = await seedWorkspace({ previousMentions: 3, previousRuns: 3 });
    engineAnswer = "For small teams, several options exist, none of them named here.";

    const result = await runScrapeAiVisibility({ orgId });
    expect(result.signalled).toBe(0);
    expect(enqueued).toEqual([]);
  });

  test("a steady picture signals nothing at all", async () => {
    const { orgId } = await seedWorkspace({ previousMentions: 0, previousRuns: 12 });
    engineAnswer = "For small teams, several options exist, none of them named here.";

    const result = await runScrapeAiVisibility({ orgId });
    expect(result.signalled).toBe(0);
    expect(enqueued).toEqual([]);
  });
});
