import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { desc, eq } from "drizzle-orm";
import { makeTestDb, schema, type TestDb } from "./db-harness";
import { verifyFaithfulness, type Claim, type FaithfulnessReport } from "@outrival/ai";
import { blockedReviewEntry, isBlocked } from "../src/lib/faithfulness-gate";

// What a blocked publication actually produces, against a real (in-process)
// Postgres migrated from the versioned migrations: the review-queue row a human
// will open, and the report stored alongside a published output.
//
// The chain's arithmetic is unit-tested in @outrival/ai; what is pinned here is the
// consequence — the offending sentence is named in the row a reviewer reads, and a
// clean output stores its 1.0 ratio on the entity. Deliberately mock-free: bun's
// mock.module is process-global and this file shares a process with the job-level
// test, so it touches its own PGlite instance and nothing else.

let testDb: TestDb;
let closeDb: () => Promise<void>;

const EVIDENCE = `<competitor_summary>
Acme Analytics is a product analytics platform for B2B SaaS teams.
</competitor_summary>
<competitor_pricing>
Starter — $49/month
Growth — $199/month
</competitor_pricing>
<competitor_reviews>
Complaint: "The dashboard is slow with large datasets."
</competitor_reviews>`;

const CARD = {
  their_strengths: ["Acme Analytics is a product analytics platform for B2B SaaS teams."],
  our_strengths: [],
  their_weaknesses: [
    "Reviewers report the dashboard is slow with large datasets.",
    // The injected invention: nothing in the evidence says anything about SOC 2.
    "Acme Analytics has no SOC 2 certification.",
  ],
  common_objections: [],
  when_we_win: [],
  when_we_lose: [],
};

const INVENTED_SENTENCE = "Acme Analytics has no SOC 2 certification.";

const SOURCED: Claim[] = [
  {
    text: "Acme Analytics is a product analytics platform for B2B SaaS teams.",
    citedQuote: "Acme Analytics is a product analytics platform for B2B SaaS teams.",
  },
  {
    text: "Reviewers report the dashboard is slow with large datasets.",
    citedQuote: "The dashboard is slow with large datasets.",
  },
];

const INVENTED: Claim = { text: INVENTED_SENTENCE, citedQuote: "" };

/** The extractor and the judge, stubbed — no provider call in a test. */
function deps(claims: Claim[], faithful: boolean) {
  return {
    extractClaims: async () => claims,
    judgeClaim: async () => ({
      faithful,
      reason: faithful ? "restates the source" : "the source says nothing about certifications",
    }),
  };
}

/**
 * Mirrors the field mapping of packages/db `insertAiQualityCheck` (which binds the
 * real postgres client and can't be pointed at PGlite). The mapping itself is
 * typechecked; what this exercises is the migration and the round-trip.
 */
async function persist(entry: ReturnType<typeof blockedReviewEntry>) {
  await testDb.insert(schema.aiQualityChecks).values({
    aiTask: entry.aiTask,
    targetType: entry.targetType,
    targetId: entry.targetId ?? null,
    orgId: entry.orgId ?? null,
    confidence: entry.quality.confidence,
    citations: entry.quality.citations,
    groundingValidation: entry.quality.groundingValidation as object,
    selfCheckResult: entry.quality.selfCheck as object,
    faithfulness: entry.faithfulness as object,
    flaggedForHumanReview: entry.quality.flaggedForHumanReview,
    flaggedAt: entry.quality.flaggedForHumanReview ? new Date() : null,
  });
}

const neutralQuality = {
  confidence: "medium",
  citations: [],
  groundingValidation: { passed: true, score: 1, failedCitations: [], validCitations: [] },
  selfCheck: null,
  selfCheckTriggeredBy: null,
  flaggedForHumanReview: false,
};

beforeAll(async () => {
  const harness = await makeTestDb();
  testDb = harness.db;
  closeDb = harness.close;
  await testDb.insert(schema.organizations).values({ id: "org-f", name: "Org F", slug: "org-f" });
  await testDb
    .insert(schema.competitors)
    .values({ id: "cmp-f", orgId: "org-f", name: "Acme Analytics" });
});

afterAll(async () => {
  await closeDb();
});

describe("a battle card with an invented sentence", () => {
  test("is blocked, and the offending claim is named in the review-queue row", async () => {
    const report = await verifyFaithfulness(
      { output: CARD, sourceText: EVIDENCE, outputKind: "sales battle card" },
      deps([...SOURCED, INVENTED], false),
    );

    expect(isBlocked(report)).toBe(true);
    expect(report.ratio).toBeCloseTo(2 / 3);

    // The card is NOT written — the job aborts before the upsert, so an existing
    // card is never overwritten by an unfaithful one.
    const entry = blockedReviewEntry({
      aiTask: "generate_battle_card",
      targetType: "battle_card",
      targetId: null,
      orgId: "org-f",
      quality: neutralQuality,
      report,
    });
    expect(entry.quality.flaggedForHumanReview).toBe(true);

    await persist(entry);

    // The review queue's own filter: flagged, newest first.
    const [row] = await testDb
      .select()
      .from(schema.aiQualityChecks)
      .where(eq(schema.aiQualityChecks.flaggedForHumanReview, true))
      .orderBy(desc(schema.aiQualityChecks.flaggedAt))
      .limit(1);

    expect(row).toBeDefined();
    expect(row?.aiTask).toBe("generate_battle_card");
    const stored = row?.faithfulness as FaithfulnessReport;
    expect(stored.verdict).toBe("blocked");
    expect(stored.unfaithfulClaims).toHaveLength(1);
    expect(stored.unfaithfulClaims[0]?.claim.text).toBe(INVENTED_SENTENCE);
    expect(stored.unfaithfulClaims[0]?.reason).toContain("certifications");
    // The two sourced sentences are NOT dragged into the reviewer's face.
    expect(stored.unfaithfulClaims.map((c) => c.claim.text)).not.toContain(
      "Reviewers report the dashboard is slow with large datasets.",
    );
  });
});

describe("a fully sourced battle card", () => {
  test("publishes, and stores a ratio of 1.0 on the card", async () => {
    const report = await verifyFaithfulness(
      { output: CARD, sourceText: EVIDENCE, outputKind: "sales battle card" },
      deps(SOURCED, false),
    );

    expect(report.verdict).toBe("pass");
    expect(report.ratio).toBe(1);
    expect(isBlocked(report)).toBe(false);

    await testDb.insert(schema.battleCards).values({
      id: "bc-f",
      competitorId: "cmp-f",
      orgId: "org-f",
      content: CARD,
      faithfulness: report,
    });

    const [card] = await testDb
      .select()
      .from(schema.battleCards)
      .where(eq(schema.battleCards.id, "bc-f"));
    const stored = card?.faithfulness as FaithfulnessReport;
    expect(stored.ratio).toBe(1);
    expect(stored.verdict).toBe("pass");
    expect(stored.judgeCalls).toBe(0);
    expect(stored.durationMs).toBeGreaterThanOrEqual(0);
  });
});
