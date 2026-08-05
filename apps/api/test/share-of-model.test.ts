import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import {
  aiVisibilityPrompts,
  aiVisibilityResults,
  competitors,
  messagingVersions,
  monitors,
  numericClaims,
  products,
} from "@outrival/db";
import { VISIBILITY_MIN_RUNS } from "@outrival/shared";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

/**
 * Positioning Intelligence v2 P5 — Share of Model, the real read.
 *
 * The property this file exists to hold: the endpoint NEVER prints a rate it
 * cannot stand behind. An answer engine asked the same buyer question twice does
 * not answer it the same way, so a mention rate computed off two runs is the
 * engine's mood dressed as a market position. Below the run minimum the response
 * says `insufficient_data` and carries no statistics at all — there is nothing for
 * the front to accidentally render.
 *
 * The second property is the extracts. "How AIs describe them" is allowed to exist
 * only because the answers were persisted: every line it prints is a verbatim
 * substring of a stored answer, and when nothing was stored the sub-section is
 * empty rather than reconstructed.
 */
let competitorsApp: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let org: { orgId: string; userId: string; email: string };

let seq = 0;
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

async function seedCompetitor(name: string, orgId = org.orgId) {
  const n = ++seq;
  const competitorId = `cmp-${n}`;
  await testDb.insert(competitors).values({ id: competitorId, orgId, name });
  await testDb.insert(monitors).values({ id: `mon-${n}`, competitorId, sourceType: "homepage" });
  return competitorId;
}

/** A workspace with a self product and one tracked rival, wired as a SKU. */
async function seedWorkspace() {
  const selfId = await seedCompetitor("Our Product");
  await testDb
    .update(competitors)
    .set({ type: "self" })
    .where(await eqId(selfId));
  const rivalId = await seedCompetitor("Acme CRM");
  const productId = `prd-${++seq}`;
  await testDb.insert(products).values({
    id: productId,
    orgId: org.orgId,
    name: "Main",
    selfCompetitorId: selfId,
    isPrimary: true,
  });
  return { selfId, rivalId, productId };
}

// Tiny helper so the seeder can update by id without importing drizzle operators
// into every test file.
async function eqId(id: string) {
  const { eq } = await import("drizzle-orm");
  return eq(competitors.id, id);
}

async function seedPrompt(productId: string, prompt: string) {
  const id = `prm-${++seq}`;
  await testDb
    .insert(aiVisibilityPrompts)
    .values({ id, orgId: org.orgId, productId, prompt, isActive: true });
  return id;
}

interface AnswerSeed {
  competitorId: string;
  productId: string;
  promptId: string;
  runId: string;
  recordedAt: Date;
  engine?: string;
  mentioned?: boolean;
  promptNamed?: boolean;
  rank?: number | null;
  cited?: boolean | null;
  sentiment?: number | null;
  excerpt?: string | null;
}

async function seedAnswer(a: AnswerSeed) {
  await testDb.insert(aiVisibilityResults).values({
    orgId: org.orgId,
    promptId: a.promptId,
    competitorId: a.competitorId,
    productId: a.productId,
    engine: a.engine ?? "gemini",
    mentioned: a.mentioned ? 1 : 0,
    promptNamed: a.promptNamed ? 1 : 0,
    rank: a.rank ?? null,
    cited: a.cited == null ? null : a.cited ? 1 : 0,
    sentimentScore: a.sentiment ?? null,
    answerExcerpt: a.excerpt ?? null,
    runId: a.runId,
    recordedAt: a.recordedAt,
  });
}

/**
 * `runs` runs, one per day back from `startDaysAgo`, each answering one prompt.
 * `mentionEvery` controls the rate: 1 = every run mentions, 2 = every other.
 */
async function seedRuns(opts: {
  competitorId: string;
  productId: string;
  promptId: string;
  runs: number;
  startDaysAgo: number;
  mentionEvery: number;
  rank?: number;
  tag?: string;
  excerpt?: (i: number) => string | null;
  engine?: string;
}) {
  for (let i = 0; i < opts.runs; i++) {
    const mentioned = i % opts.mentionEvery === 0;
    await seedAnswer({
      competitorId: opts.competitorId,
      productId: opts.productId,
      promptId: opts.promptId,
      runId: `${opts.tag ?? "run"}-${++seq}`,
      recordedAt: daysAgo(opts.startDaysAgo + i),
      engine: opts.engine,
      mentioned,
      rank: mentioned ? (opts.rank ?? 2) : null,
      cited: mentioned ? true : null,
      sentiment: mentioned ? 70 : null,
      excerpt: opts.excerpt?.(i) ?? null,
    });
  }
}

async function summary(competitorId: string) {
  const res = await competitorsApp.request(
    `/api/competitors/${competitorId}/positioning`,
    asUser(org.userId),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as {
    shareOfModel: Record<string, unknown> & { status: string };
  };
}

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  const { competitorsRouter } = await import("../src/routes/competitors");
  competitorsApp = mountApp("/api/competitors", competitorsRouter);
  org = await seedOrg(testDb, { plan: "pro" });
});

afterAll(async () => {
  await closeDb();
});

describe("share of model — states", () => {
  test("nothing collected → the P4 placeholder shape, unchanged", async () => {
    const id = await seedCompetitor("Never Measured");
    const { shareOfModel } = await summary(id);
    expect(shareOfModel.status).toBe("not_ready");
    expect(shareOfModel).toHaveProperty("prompts");
    expect(shareOfModel).toHaveProperty("answers", 0);
    expect(shareOfModel).toHaveProperty("lastRunAt", null);
    // The placeholder must not gain statistics: there is nothing to have stats about.
    expect(shareOfModel).not.toHaveProperty("competitor");
  });

  test("answers exist but too few runs → insufficient_data, and NO statistics", async () => {
    const { rivalId, productId } = await seedWorkspace();
    const promptId = await seedPrompt(productId, "best CRM for startups");
    await seedRuns({
      competitorId: rivalId,
      productId,
      promptId,
      runs: VISIBILITY_MIN_RUNS - 1,
      startDaysAgo: 1,
      mentionEvery: 1,
      tag: "thin",
    });

    const { shareOfModel } = await summary(rivalId);
    expect(shareOfModel.status).toBe("insufficient_data");
    expect(shareOfModel.nRuns).toBe(VISIBILITY_MIN_RUNS - 1);
    expect(shareOfModel.minRuns).toBe(VISIBILITY_MIN_RUNS);
    // The whole point: a rate over seven runs is never sent to the front, so it can
    // never be rendered by accident.
    expect(shareOfModel).not.toHaveProperty("competitor");
    expect(shareOfModel).not.toHaveProperty("series");
    // It still says what IS running, which is what the honest placeholder needs.
    expect(shareOfModel.answers).toBe(VISIBILITY_MIN_RUNS - 1);
  });

  test("enough runs → ready, with the rate the rows actually support", async () => {
    const { selfId, rivalId, productId } = await seedWorkspace();
    const promptId = await seedPrompt(productId, "best CRM for startups");
    // 12 runs, mentioned on every other one → 50%.
    await seedRuns({
      competitorId: rivalId,
      productId,
      promptId,
      runs: 12,
      startDaysAgo: 1,
      mentionEvery: 2,
      rank: 3,
      tag: "cur",
    });
    // The self is named in every one → 100%, so it outranks them.
    await seedRuns({
      competitorId: selfId,
      productId,
      promptId,
      runs: 12,
      startDaysAgo: 1,
      mentionEvery: 1,
      rank: 1,
      tag: "cur-self",
    });

    const { shareOfModel } = await summary(rivalId);
    expect(shareOfModel.status).toBe("ready");
    const competitor = shareOfModel.competitor as Record<string, never> & {
      metrics: { mentionRate: number; nRuns: number; avgRank: number; engines: string[] };
    };
    expect(competitor.metrics.mentionRate).toBeCloseTo(0.5, 6);
    expect(competitor.metrics.nRuns).toBe(12);
    expect(competitor.metrics.avgRank).toBe(3);
    expect(competitor.metrics.engines).toEqual(["gemini"]);

    const self = shareOfModel.self as { name: string; metrics: { mentionRate: number } };
    expect(self.name).toBe("Our Product");
    expect(self.metrics.mentionRate).toBe(1);

    // #2 of the two tracked subjects: the self is named twice as often.
    expect(shareOfModel.position).toBe(2);
    expect(shareOfModel.tracked).toBe(2);
    expect(shareOfModel.windowDays).toBe(28);
  });

  test("a prompt that NAMES them is excluded from their rate", async () => {
    const { rivalId, productId } = await seedWorkspace();
    const organic = await seedPrompt(productId, "best CRM for startups");
    const seeded = await seedPrompt(productId, "Acme CRM vs the rest");
    await seedRuns({
      competitorId: rivalId,
      productId,
      promptId: organic,
      runs: 10,
      startDaysAgo: 1,
      mentionEvery: 10, // mentioned once in ten
      tag: "org",
    });
    for (let i = 0; i < 10; i++) {
      await seedAnswer({
        competitorId: rivalId,
        productId,
        promptId: seeded,
        runId: `org-seeded-${i}`,
        recordedAt: daysAgo(1 + i),
        mentioned: true,
        promptNamed: true,
      });
    }

    const { shareOfModel } = await summary(rivalId);
    const competitor = shareOfModel.competitor as { metrics: { mentionRate: number; answers: number } };
    // 1 of 10 organic answers, NOT 11 of 20 — being handed your own name is not
    // evidence an engine surfaced you.
    expect(competitor.metrics.answers).toBe(10);
    expect(competitor.metrics.mentionRate).toBeCloseTo(0.1, 6);
  });
});

describe("share of model — trend and series", () => {
  test("trend compares the current window to the previous one", async () => {
    const { rivalId, productId } = await seedWorkspace();
    const promptId = await seedPrompt(productId, "best CRM for startups");
    // Current window: named in all 10.
    await seedRuns({
      competitorId: rivalId,
      productId,
      promptId,
      runs: 10,
      startDaysAgo: 1,
      mentionEvery: 1,
      tag: "now",
    });
    // Previous window (29-38 days ago): named in half.
    await seedRuns({
      competitorId: rivalId,
      productId,
      promptId,
      runs: 10,
      startDaysAgo: 29,
      mentionEvery: 2,
      tag: "then",
    });

    const { shareOfModel } = await summary(rivalId);
    const competitor = shareOfModel.competitor as {
      trend: { mentionRate: number | null };
      metrics: { mentionRate: number };
    };
    expect(competitor.metrics.mentionRate).toBe(1);
    expect(competitor.trend.mentionRate).toBeCloseTo(0.5, 6);
  });

  test("a window under the run minimum draws no point on the sparkline", async () => {
    const { rivalId, productId } = await seedWorkspace();
    const promptId = await seedPrompt(productId, "best CRM for startups");
    await seedRuns({
      competitorId: rivalId,
      productId,
      promptId,
      runs: 10,
      startDaysAgo: 1,
      mentionEvery: 1,
      tag: "now",
    });
    // Two lonely runs a couple of windows back — a real quota-starved fortnight.
    await seedRuns({
      competitorId: rivalId,
      productId,
      promptId,
      runs: 2,
      startDaysAgo: 60,
      mentionEvery: 5,
      tag: "starved",
    });

    const { shareOfModel } = await summary(rivalId);
    const series = shareOfModel.series as Array<{ mentionRate: number | null; nRuns: number }>;
    expect(series).toHaveLength(6);
    // Newest bucket carries the real rate…
    expect(series[5]!.mentionRate).toBe(1);
    // …and the starved one draws nothing rather than a 0% nosedive.
    const starved = series.find((s) => s.nRuns === 2);
    expect(starved).toBeDefined();
    expect(starved!.mentionRate).toBeNull();
  });
});

describe("share of model — evidence", () => {
  test("the per-prompt table is the window's LAST run, not the whole window", async () => {
    const { rivalId, productId } = await seedWorkspace();
    const promptId = await seedPrompt(productId, "best CRM for startups");
    await seedRuns({
      competitorId: rivalId,
      productId,
      promptId,
      runs: 10,
      startDaysAgo: 2,
      mentionEvery: 1,
      tag: "older",
    });
    // Yesterday's run, on two engines — the one the table shows.
    for (const engine of ["gemini", "perplexity"]) {
      await seedAnswer({
        competitorId: rivalId,
        productId,
        promptId,
        runId: "latest-run",
        recordedAt: daysAgo(0),
        engine,
        mentioned: true,
        rank: 1,
        cited: false,
        sentiment: 90,
      });
    }

    const { shareOfModel } = await summary(rivalId);
    const outcomes = shareOfModel.promptOutcomes as Array<{
      prompt: string;
      engine: string;
      rank: number | null;
      cited: boolean | null;
      sentiment: number | null;
    }>;
    // Exactly the two rows of `latest-run`, never the 10 runs behind it.
    expect(outcomes).toHaveLength(2);
    expect(outcomes.map((o) => o.engine).sort()).toEqual(["gemini", "perplexity"]);
    expect(outcomes[0]!.prompt).toBe("best CRM for startups");
    expect(outcomes[0]!.rank).toBe(1);
    expect(outcomes[0]!.cited).toBe(false);
    expect(outcomes[0]!.sentiment).toBe(90);
  });

  test("extracts are EXACT substrings of the stored answers", async () => {
    const { rivalId, productId } = await seedWorkspace();
    const promptId = await seedPrompt(productId, "best CRM for startups");
    const stored =
      "Several tools compete here. Acme CRM is widely regarded as the simplest option for small teams. Others are heavier.";
    await seedRuns({
      competitorId: rivalId,
      productId,
      promptId,
      runs: 10,
      startDaysAgo: 1,
      mentionEvery: 1,
      tag: "quoted",
      excerpt: () => stored,
    });

    const { shareOfModel } = await summary(rivalId);
    const extracts = shareOfModel.extracts as Array<{ text: string; engine: string }>;
    expect(extracts).toHaveLength(1); // ten identical answers, one line
    expect(extracts[0]!.text).toBe(
      "Acme CRM is widely regarded as the simplest option for small teams.",
    );
    expect(stored.includes(extracts[0]!.text)).toBe(true);
    expect(extracts[0]!.engine).toBe("gemini");
  });

  test("answers never persisted → NO extracts, and nothing invented", async () => {
    const { rivalId, productId } = await seedWorkspace();
    const promptId = await seedPrompt(productId, "best CRM for startups");
    await seedRuns({
      competitorId: rivalId,
      productId,
      promptId,
      runs: 10,
      startDaysAgo: 1,
      mentionEvery: 1,
      tag: "silent",
      excerpt: () => null,
    });

    const { shareOfModel } = await summary(rivalId);
    expect(shareOfModel.status).toBe("ready");
    // The rates still stand — they are computed off the verdicts, not the text.
    expect((shareOfModel.competitor as { metrics: { mentionRate: number } }).metrics.mentionRate)
      .toBe(1);
    expect(shareOfModel.extracts).toEqual([]);
  });

  test("the narrative gap carries their own words beside the engines'", async () => {
    const { rivalId, productId } = await seedWorkspace();
    const promptId = await seedPrompt(productId, "best CRM for startups");
    await seedRuns({
      competitorId: rivalId,
      productId,
      promptId,
      runs: 10,
      startDaysAgo: 1,
      mentionEvery: 4,
      tag: "gap",
    });
    await testDb.insert(messagingVersions).values({
      competitorId: rivalId,
      h1: "The CRM every team already knows",
      subheadline: null,
      primaryCta: null,
      valueProps: [],
      capturedAt: daysAgo(5),
    });
    await testDb.insert(numericClaims).values({
      competitorId: rivalId,
      monitorId: "mon-x",
      pattern: "user_count",
      unit: "teams",
      context: "customers",
      value: 15000,
      rawText: "15,000+ teams",
      observedAt: daysAgo(4),
    });

    const { shareOfModel } = await summary(rivalId);
    const narrative = shareOfModel.narrative as {
      h1: string | null;
      claim: { rawText: string } | null;
    };
    expect(narrative.h1).toBe("The CRM every team already knows");
    expect(narrative.claim?.rawText).toBe("15,000+ teams");
    // And the other column is a measurement, not a sentence about it.
    const competitor = shareOfModel.competitor as { metrics: { mentions: number; answers: number } };
    expect(competitor.metrics.answers).toBe(10);
    expect(competitor.metrics.mentions).toBe(3);
  });
});
