import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { desc, eq } from "drizzle-orm";
import { makeTestDb, schema, type TestDb } from "./db-harness";
import { verifyFaithfulness, type Claim, type FaithfulnessReport } from "@outrival/ai";
import {
  blockedReviewEntry,
  checkFaithfulness,
  groundableDigestLayer,
  groundableSignalLayer,
  isBlocked,
  publishableAfterRepair,
} from "../src/lib/faithfulness-gate";

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

describe("per-task enablement (P5)", () => {
  const publishable = {
    output: CARD,
    sourceText: EVIDENCE,
    outputKind: "sales battle card",
    context: {},
  };

  afterEach(() => {
    delete process.env.FAITHFULNESS_GATE_TASKS;
    delete process.env.FAITHFULNESS_GATE_ENABLED;
  });

  test("an ungated task never enters the chain", async () => {
    // No flag set — the repository default. A null return is the whole contract:
    // no extraction call, no judge call, no ai_runs row, caller publishes as before.
    expect(await checkFaithfulness({ task: "battle_card", ...publishable })).toBeNull();
  });

  test("signal insights stay out while battle cards and digests are gated", async () => {
    process.env.FAITHFULNESS_GATE_TASKS = "battle_card,digest";
    // The scope plan 017 decided. No provider is reachable from a test, so the
    // null return is also the proof that this task never reached one.
    expect(await checkFaithfulness({ task: "signal_insight", ...publishable })).toBeNull();
  });

  test("the legacy boolean alone still leaves an unlisted task ungated", async () => {
    process.env.FAITHFULNESS_GATE_ENABLED = "true";
    process.env.FAITHFULNESS_GATE_TASKS = "digest";
    expect(await checkFaithfulness({ task: "signal_insight", ...publishable })).toBeNull();
  });
});

describe("what a signal submits to the gate", () => {
  // The production failure, reduced: a price move the diff states outright, an
  // implication for OUR product, and advice to us. Nothing in a competitor's diff
  // can support the last two, so submitting them blocked the signal over sentences
  // the judge had no evidence to rule on (docs/faithfulness-rollout.md §9).
  const DIFF = `<competitor_pricing_after>
Growth — $249/month
</competitor_pricing_after>`;

  const published = {
    insight: "Acme Analytics now lists Growth — $249/month.",
    soWhat: "This narrows the price gap with our own mid tier.",
    recommendedAction: "Refresh the pricing battle card before the next renewal wave.",
  };

  const KIND = "competitive intelligence signal insight";

  /** One claim per submitted field. Only the insight can cite the diff. */
  function perField(output: Record<string, string>) {
    return {
      extractClaims: async (): Promise<Claim[]> =>
        Object.values(output).map((text) => ({
          text,
          citedQuote: text === published.insight ? "Growth — $249/month" : "",
        })),
      judgeClaim: async () => ({
        faithful: false,
        reason: "the diff says nothing about our own product",
      }),
    };
  }

  test("the whole signal blocks on advice the diff cannot support", async () => {
    const wide = {
      insight: published.insight,
      so_what: published.soWhat,
      recommended_action: published.recommendedAction,
    };
    const report = await verifyFaithfulness(
      { output: wide, sourceText: DIFF, outputKind: KIND },
      perField(wide),
    );

    expect(report.verdict).toBe("blocked");
    expect(report.unfaithfulClaims.map((c) => c.claim.text)).toEqual([
      published.soWhat,
      published.recommendedAction,
    ]);
  });

  test("the factual layer alone publishes — same signal, same diff", async () => {
    const narrow = groundableSignalLayer(published);
    expect(narrow).toEqual({ insight: published.insight });

    const report = await verifyFaithfulness(
      { output: narrow, sourceText: DIFF, outputKind: KIND },
      perField(narrow),
    );

    expect(report.verdict).toBe("pass");
    // The insight quotes the diff, so the judge is never called: the narrowing
    // also removes the two smart-tier calls those two fields were paying for.
    expect(report.judgeCalls).toBe(0);
  });

  test("an invented fact in the insight still blocks", async () => {
    // The narrowing is not a loosening. What the gate exists to stop lives in the
    // insight, and it is still stopped there.
    const narrow = groundableSignalLayer({
      ...published,
      insight: "Acme Analytics discontinued its Starter plan.",
    });
    const report = await verifyFaithfulness(
      { output: narrow, sourceText: DIFF, outputKind: KIND },
      {
        extractClaims: async (): Promise<Claim[]> => [
          { text: narrow.insight, citedQuote: "" },
        ],
        judgeClaim: async () => ({
          faithful: false,
          reason: "the diff shows no plan removal",
        }),
      },
    );

    expect(report.verdict).toBe("blocked");
    expect(report.unfaithfulClaims[0]?.claim.text).toBe(narrow.insight);
  });
});

describe("what a digest submits to the gate", () => {
  // The week as the gate sees it: digestSourceText serialises the input signals,
  // so a section insight that restates one of them cites it verbatim.
  const WEEK = JSON.stringify(
    [
      {
        competitor: "Acme Analytics",
        category: "pricing",
        severity: "high",
        insight: "Acme Analytics raised Growth from $199 to $249 per month.",
        so_what: "Their mid tier is now priced above ours.",
      },
    ],
    null,
    2,
  );

  // The production shape of a blocked digest: one real section, one tldr line
  // the prompt asked to be a non-event, and the labels the model assigns itself.
  const digest = {
    temperature: "moderate",
    tldr: ["No direct threat was identified this week."],
    sections: [
      {
        urgency: "watch",
        competitor: "Acme Analytics",
        category: "pricing",
        insight: "Acme Analytics raised Growth from $199 to $249 per month.",
        so_what: "An opportunity to reinforce our own pricing clarity.",
      },
    ],
  };

  const KIND = "weekly competitive-intelligence digest";
  const SECTION_INSIGHT = digest.sections[0]!.insight;

  const judgeRefuses = async () => ({
    faithful: false,
    reason: "the week's signals say nothing of the sort",
  });

  function extracting(claims: Claim[]) {
    return { extractClaims: async () => claims, judgeClaim: judgeRefuses };
  }

  test("the whole digest blocks on its tldr, its so_what and its own labels", async () => {
    const report = await verifyFaithfulness(
      { output: digest, sourceText: WEEK, outputKind: KIND },
      extracting([
        { text: SECTION_INSIGHT, citedQuote: SECTION_INSIGHT },
        { text: digest.tldr[0]!, citedQuote: "" },
        { text: digest.sections[0]!.so_what, citedQuote: "" },
        { text: "The urgency assigned to the insight is watch.", citedQuote: "" },
      ]),
    );

    expect(report.verdict).toBe("blocked");
    expect(report.unfaithfulClaims).toHaveLength(3);
  });

  test("the section insights alone publish — same digest, same week", async () => {
    const narrow = groundableDigestLayer(digest);
    expect(narrow).toEqual({ sections: [{ insight: SECTION_INSIGHT }] });

    const report = await verifyFaithfulness(
      { output: narrow, sourceText: WEEK, outputKind: KIND },
      extracting([{ text: SECTION_INSIGHT, citedQuote: SECTION_INSIGHT }]),
    );

    expect(report.verdict).toBe("pass");
    expect(report.judgeCalls).toBe(0);
  });

  test("an invented figure in a section insight still blocks", async () => {
    const invented = "Acme Analytics also discontinued its Starter plan.";
    const narrow = groundableDigestLayer({
      sections: [...digest.sections, { insight: invented }],
    });
    expect(narrow.sections).toHaveLength(2);

    const report = await verifyFaithfulness(
      { output: narrow, sourceText: WEEK, outputKind: KIND },
      extracting([
        { text: SECTION_INSIGHT, citedQuote: SECTION_INSIGHT },
        { text: invented, citedQuote: "" },
      ]),
    );

    expect(report.verdict).toBe("blocked");
    expect(report.unfaithfulClaims[0]?.claim.text).toBe(invented);
  });

  test("a week with no sections is not a block", async () => {
    // Nothing to extract, nothing to refuse. An org with a quiet week must get
    // its email, not a review-queue row.
    const report = await verifyFaithfulness(
      { output: groundableDigestLayer({ sections: [] }), sourceText: WEEK, outputKind: KIND },
      extracting([]),
    );
    expect(report.verdict).toBe("pass");
    expect(report.ratio).toBe(1);
  });
});

describe("what a block leaves served", () => {
  const input = { output: CARD, sourceText: EVIDENCE, outputKind: "sales battle card" };

  test("a repaired card publishes ONLY on a clean re-verification", async () => {
    const clean = await verifyFaithfulness(input, deps(SOURCED, false));
    expect(clean.verdict).toBe("pass");
    expect(publishableAfterRepair(CARD, clean)).toBe(CARD);
  });

  test("no repair to show → the previous card stays served", () => {
    expect(publishableAfterRepair(null, null)).toBeNull();
  });

  test("FAIL CLOSED on this path: an unavailable re-verification does not publish", async () => {
    // The one place in the system where a provider outage withholds instead of
    // publishing. This content was already refused once; a `skipped` recheck must
    // not become the way it gets through, so the job aborts and the customer keeps
    // reading yesterday's card rather than a repaired-but-unverified one.
    const unavailable = await verifyFaithfulness(input, {
      extractClaims: async () => {
        throw new Error("pool down");
      },
      judgeClaim: async () => null,
    });
    expect(unavailable.verdict).toBe("skipped");
    expect(publishableAfterRepair(CARD, unavailable)).toBeNull();
  });

  test("a repair that is itself blocked does not publish", async () => {
    const stillBlocked = await verifyFaithfulness(input, deps([...SOURCED, INVENTED], false));
    expect(stillBlocked.verdict).toBe("blocked");
    expect(publishableAfterRepair(CARD, stillBlocked)).toBeNull();
  });
});
