import { describe, expect, test } from "bun:test";
import { abstainFromUnverified, deterministicInsight } from "./abstention";
import { verifyFieldsAgainstSource } from "./posthoc-grounding";
import type { PostHocGrounding } from "./types";

const prose = {
  insight: "They cut the Pro plan to $99.",
  so_what: "That is 41% below our own price.",
  recommended_action: "Review our Pro tier.",
};
const fallbackInsight = 'Acme changed "$149/mo" to "$99/mo".';

const check = (over: Partial<PostHocGrounding> = {}): PostHocGrounding => ({
  status: "unverified",
  unverified: [],
  checked: 3,
  ...over,
});

describe("abstainFromUnverified", () => {
  test("withholds only the field that carries the unsupported figure", () => {
    const r = abstainFromUnverified({
      prose,
      postHoc: check({ unverified: [{ kind: "percentage", text: "41%", field: "so_what" }] }),
      fallbackInsight,
    });
    expect(r.insight).toBe(prose.insight);
    expect(r.soWhat).toBeNull();
    expect(r.recommendedAction).toBe(prose.recommended_action);
    expect(r.withheld).toEqual(["so_what"]);
  });

  test("a withheld insight falls back to the deterministic sentence, never to model text", () => {
    const r = abstainFromUnverified({
      prose,
      postHoc: check({ unverified: [{ kind: "amount", text: "$99", field: "insight" }] }),
      fallbackInsight,
    });
    expect(r.insight).toBe(fallbackInsight);
    expect(r.insight).not.toContain("$99.");
    expect(r.withheld).toEqual(["insight"]);
  });

  test("verified and skipped both publish everything", () => {
    for (const status of ["verified", "skipped"] as const) {
      const r = abstainFromUnverified({ prose, postHoc: check({ status }), fallbackInsight });
      expect(r.withheld).toEqual([]);
      expect(r.insight).toBe(prose.insight);
      expect(r.soWhat).toBe(prose.so_what);
    }
  });

  test("no check at all publishes everything", () => {
    const r = abstainFromUnverified({ prose, postHoc: null, fallbackInsight });
    expect(r.withheld).toEqual([]);
  });

  test("an unattributed token withholds all three — we cannot tell which lied", () => {
    const r = abstainFromUnverified({
      prose,
      postHoc: check({ unverified: [{ kind: "number", text: "10,000" }] }),
      fallbackInsight,
    });
    expect(r).toEqual({
      insight: fallbackInsight,
      soWhat: null,
      recommendedAction: null,
      withheld: ["insight", "so_what", "recommended_action"],
    });
  });
});

// The P3 decision as the worker runs it: check the generated fields against the diff
// the model was shown, then withhold what the diff cannot support. Composed here in
// full because the guarantee is about the CHAIN — a signal that still ships, minus
// the sentence that invented a figure.
describe("check → abstain, as generate-signal runs it", () => {
  const source = `<added>\nPro — $99 per month\n</added>\n<removed>\nPro — $149 per month\n</removed>`;
  const generated = {
    insight: "Acme cut the Pro plan from $149 to $99 per month.",
    so_what: "They now undercut us by 34%, our biggest gap yet.",
    recommended_action: "Review our Pro tier.",
  };

  const run = () => {
    const check = verifyFieldsAgainstSource(
      [
        { field: "insight", text: generated.insight },
        { field: "so_what", text: generated.so_what },
        { field: "recommended_action", text: generated.recommended_action ?? "" },
      ],
      source,
    );
    const postHoc: PostHocGrounding = {
      status: check.verified ? "verified" : "unverified",
      unverified: check.unverified,
      checked: check.checked,
    };
    return {
      postHoc,
      published: abstainFromUnverified({
        prose: generated,
        postHoc,
        fallbackInsight: deterministicInsight({
          competitorName: "Acme",
          humanChangeBefore: "$149/mo",
          humanChangeAfter: "$99/mo",
        }),
      }),
    };
  };

  test("the invented percentage is caught and its sentence is withheld", () => {
    const { postHoc, published } = run();
    expect(postHoc.status).toBe("unverified");
    expect(postHoc.unverified.map((t) => t.text)).toEqual(["34%"]);
    expect(published.soWhat).toBeNull();
  });

  test("the signal still ships: the supported insight survives untouched", () => {
    const { published } = run();
    expect(published.insight).toBe(generated.insight);
    expect(published.recommendedAction).toBe("Review our Pro tier.");
    expect(published.withheld).toEqual(["so_what"]);
  });
});

describe("deterministicInsight", () => {
  test("states the extracted before/after when both sides are known", () => {
    expect(
      deterministicInsight({
        competitorName: "Acme",
        humanChangeBefore: "$149/mo",
        humanChangeAfter: "$99/mo",
      }),
    ).toBe('Acme changed "$149/mo" to "$99/mo".');
  });

  test("degrades to the after side, then to the bare fact", () => {
    expect(
      deterministicInsight({
        competitorName: "Acme",
        humanChangeBefore: null,
        humanChangeAfter: "AI-powered intelligence",
      }),
    ).toBe('Acme now states "AI-powered intelligence".');
    expect(
      deterministicInsight({ competitorName: "Acme", humanChangeBefore: null, humanChangeAfter: null }),
    ).toBe("Acme changed this page.");
  });
});
