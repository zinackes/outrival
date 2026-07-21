import { describe, expect, test } from "bun:test";
import { verifyFaithfulness, type FaithfulnessDeps } from "./verify";
import { AI_CONFIG } from "../config";
import type { Claim } from "./types";

// The whole chain, with the two model calls injected. What is proven here is the
// wiring and the arithmetic: which claim reaches the judge, what the ratio becomes,
// and which outputs get blocked. The judge's own accuracy on real prose is a model
// property — it belongs to the labelled eval (`pnpm --filter @outrival/ai
// eval:faithfulness`), not to a test with a stubbed verdict.

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

/** A battle card as the generator produces it, plus one sentence nothing backs. */
const CARD_WITH_INVENTION = {
  their_strengths: ["Acme Analytics is a product analytics platform for B2B SaaS teams."],
  our_strengths: [],
  their_weaknesses: [
    "Reviewers report the dashboard is slow with large datasets.",
    "Acme Analytics has no SOC 2 certification.", // ← invented: absent from the evidence
  ],
  common_objections: [],
  when_we_win: [],
  when_we_lose: [],
};

const SOURCED_CLAIMS: Claim[] = [
  { text: "Acme Analytics starts at $49 per month.", citedQuote: "Starter — $49/month" },
  {
    text: "Reviewers report the dashboard is slow with large datasets.",
    citedQuote: "The dashboard is slow with large datasets.",
  },
];

const INVENTED_CLAIM: Claim = {
  text: "Acme Analytics has no SOC 2 certification.",
  citedQuote: "",
};

const PARAPHRASE_CLAIM: Claim = {
  text: "Acme's cheapest paid plan costs forty-nine dollars a month.",
  // A real fact, quoted loosely — the fuzzy validator cannot settle this one.
  citedQuote: "the cheapest plan is priced at forty-nine dollars per month",
};

function deps(claims: Claim[] | null, judgeFaithful: boolean | null): FaithfulnessDeps {
  return {
    extractClaims: async () => claims,
    judgeClaim: async (claim) =>
      judgeFaithful === null
        ? null
        : { faithful: judgeFaithful, reason: `stub verdict for "${claim.text.slice(0, 20)}"` },
  };
}

const params = { output: CARD_WITH_INVENTION, sourceText: EVIDENCE, outputKind: "sales battle card" };

describe("verifyFaithfulness — blocked output (a)", () => {
  test("an invented sentence is caught, blocks, and is named in the report", async () => {
    const report = await verifyFaithfulness(params, deps([...SOURCED_CLAIMS, INVENTED_CLAIM], false));

    expect(report.verdict).toBe("blocked");
    expect(report.unfaithfulClaims).toHaveLength(1);
    expect(report.unfaithfulClaims[0]?.claim.text).toBe(
      "Acme Analytics has no SOC 2 certification.",
    );
    expect(report.unfaithfulClaims[0]?.reason).toBeTruthy();
    expect(report.reason).toContain("SOC 2");
    // Only the unquotable claim cost a judge call; the two sourced ones were free.
    expect(report.judgeCalls).toBe(1);
    expect(report.ratio).toBeCloseTo(2 / 3);
  });
});

describe("verifyFaithfulness — clean output (b)", () => {
  test("a fully sourced output publishes with a ratio of 1.0 and costs no judge call", async () => {
    const report = await verifyFaithfulness(
      { ...params, output: { their_strengths: ["Starter costs $49/month."] } },
      deps(SOURCED_CLAIMS, null),
    );

    expect(report.verdict).toBe("pass");
    expect(report.ratio).toBe(1);
    expect(report.verbatimRatio).toBe(1);
    expect(report.unfaithfulClaims).toEqual([]);
    expect(report.judgeCalls).toBe(0);
    expect(report.claims.every((c) => c.status === "verbatim")).toBe(true);
  });

  test("an output with nothing verifiable passes vacuously", async () => {
    const report = await verifyFaithfulness(params, deps([], null));
    expect(report.verdict).toBe("pass");
    expect(report.ratio).toBe(1);
  });
});

describe("binary judge, both directions (c)", () => {
  test("a legitimate paraphrase the fuzzy pass cannot settle is ACCEPTED", async () => {
    const report = await verifyFaithfulness(params, deps([PARAPHRASE_CLAIM], true));

    expect(report.judgeCalls).toBe(1); // the fuzzy pass did not settle it
    expect(report.claims[0]?.status).toBe("paraphrase");
    expect(report.verdict).toBe("pass");
    expect(report.ratio).toBe(1);
    // The audit number still records that nothing matched verbatim.
    expect(report.verbatimRatio).toBe(0);
  });

  test("an invention the fuzzy pass cannot settle is REJECTED", async () => {
    const report = await verifyFaithfulness(params, deps([INVENTED_CLAIM], false));

    expect(report.judgeCalls).toBe(1);
    expect(report.claims[0]?.status).toBe("unfaithful");
    expect(report.verdict).toBe("blocked");
    expect(report.ratio).toBe(0);
  });

  test("FAIL OPEN: an unavailable judge marks the claim unverified, never blocks", async () => {
    const report = await verifyFaithfulness(params, deps([INVENTED_CLAIM], null));

    expect(report.claims[0]?.status).toBe("unverified");
    expect(report.verdict).toBe("pass");
  });

  test("FAIL OPEN: a judge that throws does not block either", async () => {
    const report = await verifyFaithfulness(params, {
      extractClaims: async () => [INVENTED_CLAIM],
      judgeClaim: async () => {
        throw new Error("429 rate limit");
      },
    });

    expect(report.claims[0]?.status).toBe("unverified");
    expect(report.verdict).toBe("pass");
  });
});

describe("extraction failures fail open", () => {
  test("a parse miss skips verification instead of blocking", async () => {
    const report = await verifyFaithfulness(params, deps(null, false));
    expect(report.verdict).toBe("skipped");
    expect(report.reason).toContain("parse miss");
  });

  test("a thrown extraction skips verification instead of blocking", async () => {
    const report = await verifyFaithfulness(params, {
      extractClaims: async () => {
        throw new Error("circuit breaker open");
      },
      judgeClaim: async () => null,
    });
    expect(report.verdict).toBe("skipped");
    expect(report.reason).toContain("circuit breaker open");
  });
});

describe("cost and latency are recorded (d)", () => {
  test("the report carries the chain's timings and call count", async () => {
    const report = await verifyFaithfulness(params, deps([...SOURCED_CLAIMS, INVENTED_CLAIM], false));

    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.extractionMs).toBeGreaterThanOrEqual(0);
    expect(report.judgeMs).toBeGreaterThanOrEqual(0);
    expect(report.durationMs).toBeGreaterThanOrEqual(report.extractionMs);
    expect(report.judgeCalls).toBe(1);
  });

  test("the chain runs on the pool's FAST model", () => {
    // Both calls take AI_CONFIG.classificationFast — `tier` is what actually routes
    // on the pool path (AI_CONFIG.model is ignored there).
    expect(AI_CONFIG.classificationFast.tier).toBe("fast");
  });
});
