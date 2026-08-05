import { describe, test, expect } from "bun:test";
import {
  computeCompleteness,
  countCaptureAnchors,
  isPartialScore,
  PARTIAL_SCORE_THRESHOLD,
  type CompletenessInput,
} from "../completeness";

/** A healthy pricing capture: every check passes. Override one field per test. */
const healthy: CompletenessInput = {
  textLength: 4200,
  historicalMedian: 4000,
  sourceType: "pricing",
  anchorsFound: 1,
  httpStatus: 200,
  renderLevelReached: 0,
  renderLevelExpected: 0,
};

describe("computeCompleteness — a healthy capture", () => {
  test("scores 1 with no reasons", () => {
    const v = computeCompleteness(healthy);
    expect(v.score).toBe(1);
    expect(v.reasons).toEqual([]);
    expect(isPartialScore(v.score)).toBe(false);
  });

  test("a first capture (no median) is complete when its anchor is there", () => {
    const v = computeCompleteness({ ...healthy, historicalMedian: 0, textLength: 3000 });
    expect(v.reasons).toEqual([]);
    expect(isPartialScore(v.score)).toBe(false);
  });

  test("a legitimately short page whose median is equally short stays complete", () => {
    // 480 chars sits INSIDE the dead band, but this monitor always serves ~500:
    // the band must not fire, or the source is silenced forever.
    const v = computeCompleteness({
      ...healthy,
      textLength: 480,
      historicalMedian: 500,
    });
    expect(v.reasons).toEqual([]);
    expect(isPartialScore(v.score)).toBe(false);
  });

  test("a page that merely shrank a little is complete", () => {
    const v = computeCompleteness({ ...healthy, textLength: 2600, historicalMedian: 4000 });
    expect(v.reasons).toEqual([]);
    expect(isPartialScore(v.score)).toBe(false);
  });
});

describe("computeCompleteness — degraded captures", () => {
  test("an SPA shell (dead band, no anchor, far below median) is partial", () => {
    const v = computeCompleteness({
      ...healthy,
      textLength: 350,
      anchorsFound: 0,
      historicalMedian: 8000,
    });
    expect(v.reasons).toContain("dead_band");
    expect(v.reasons).toContain("no_anchor");
    expect(v.reasons).toContain("below_median_band");
    expect(v.score).toBe(0);
    expect(isPartialScore(v.score)).toBe(true);
  });

  test("the 100-600 char dead band alone is enough to grade partial", () => {
    for (const textLength of [100, 300, 600]) {
      const v = computeCompleteness({ ...healthy, textLength, historicalMedian: 0 });
      expect(v.reasons).toContain("dead_band");
      expect(isPartialScore(v.score)).toBe(true);
    }
  });

  test("just outside the dead band, with no other evidence, stays complete", () => {
    const v = computeCompleteness({ ...healthy, textLength: 601, historicalMedian: 0 });
    expect(v.reasons).toEqual([]);
    expect(isPartialScore(v.score)).toBe(false);
  });

  test("under 100 chars is below the band — the cascade's collapse guard owns it", () => {
    // Not this module's job: isContentCollapsed already throws there. Grading it
    // here too would double-count, and the median check still catches it.
    const v = computeCompleteness({ ...healthy, textLength: 60, historicalMedian: 0 });
    expect(v.reasons).not.toContain("dead_band");
  });

  test("half the usual size trips the median band", () => {
    const v = computeCompleteness({ ...healthy, textLength: 1900, historicalMedian: 4000 });
    expect(v.reasons).toEqual(["below_median_band"]);
    expect(v.score).toBeCloseTo(0.6, 5);
    // 0.6 is the threshold itself: the median band alone is a warning, not a verdict.
    expect(isPartialScore(v.score)).toBe(false);
  });

  test("a missing anchor on a size-normal page is partial on its own", () => {
    // The exact SCR-4 shape: SSR marketing copy, full length, zero prices.
    const v = computeCompleteness({ ...healthy, anchorsFound: 0 });
    expect(v.reasons).toEqual(["no_anchor"]);
    expect(isPartialScore(v.score)).toBe(true);
  });

  test("a 4xx body captured as content scores 0 whatever else passed", () => {
    const v = computeCompleteness({ ...healthy, httpStatus: 404 });
    expect(v.reasons).toEqual(["http_error"]);
    expect(v.score).toBe(0);
    expect(isPartialScore(v.score)).toBe(true);
  });

  test("serving below the learned render level is flagged but not fatal alone", () => {
    const v = computeCompleteness({
      ...healthy,
      renderLevelReached: 0,
      renderLevelExpected: 2,
    });
    expect(v.reasons).toEqual(["under_rendered"]);
    expect(isPartialScore(v.score)).toBe(false);
  });

  test("under-render plus a missing anchor is partial", () => {
    const v = computeCompleteness({
      ...healthy,
      anchorsFound: 0,
      renderLevelReached: 1,
      renderLevelExpected: 2,
    });
    expect(isPartialScore(v.score)).toBe(true);
  });

  test("score never leaves [0,1]", () => {
    const v = computeCompleteness({
      textLength: 200,
      historicalMedian: 9000,
      sourceType: "pricing",
      anchorsFound: 0,
      httpStatus: 503,
      renderLevelReached: 0,
      renderLevelExpected: 2,
    });
    expect(v.score).toBe(0);
    expect(v.reasons.length).toBe(5);
  });
});

describe("computeCompleteness — sources without expected anchors", () => {
  test("a changelog with nothing new is never flagged for a missing anchor", () => {
    const v = computeCompleteness({ ...healthy, sourceType: "changelog", anchorsFound: 0 });
    expect(v.reasons).not.toContain("no_anchor");
  });

  test("an unknown source type is not anchor-checked", () => {
    const v = computeCompleteness({ ...healthy, sourceType: "wellknown", anchorsFound: 0 });
    expect(v.reasons).not.toContain("no_anchor");
  });

  test("the threshold is the documented constant", () => {
    expect(PARTIAL_SCORE_THRESHOLD).toBe(0.6);
    expect(isPartialScore(PARTIAL_SCORE_THRESHOLD)).toBe(false);
    expect(isPartialScore(PARTIAL_SCORE_THRESHOLD - 0.001)).toBe(true);
  });
});

describe("countCaptureAnchors", () => {
  test("pricing — a currency amount counts", () => {
    expect(countCaptureAnchors("<div class='card'>€29 / month</div>", "pricing")).toBe(1);
    expect(countCaptureAnchors("<p>Starts at $10/mo</p>", "pricing")).toBe(1);
    expect(countCaptureAnchors("<p>USD 1200 per year</p>", "pricing")).toBe(1);
  });

  test("pricing — a pricing-model statement counts even with no amount", () => {
    expect(countCaptureAnchors("<h1>Pricing</h1><p>Contact sales</p>", "pricing")).toBe(1);
    expect(countCaptureAnchors("<p>Usage-based billing</p>", "pricing")).toBe(1);
    expect(countCaptureAnchors("<p>Billed annually, per seat</p>", "pricing")).toBe(1);
  });

  test("pricing — an SSR marketing shell with no price and no model has no anchor", () => {
    const shell =
      "<main><h1>Plans that grow with you</h1><p>Thousands of teams trust us to " +
      "keep their work moving. Start today and see the difference.</p></main>";
    expect(countCaptureAnchors(shell, "pricing")).toBe(0);
  });

  test("pricing — a price inside a stripped <script> is not an anchor", () => {
    expect(countCaptureAnchors('<script>var p = "$49";</script><p>Hello</p>', "pricing")).toBe(0);
  });

  test("jobs — a posting marker counts", () => {
    expect(countCaptureAnchors('<a href="/careers/senior-dev">Apply now</a>', "jobs")).toBe(1);
    expect(countCaptureAnchors("<h2>Open positions</h2>", "jobs")).toBe(1);
  });

  test("jobs — an explicit empty state is an ANSWER, so it counts as an anchor", () => {
    expect(countCaptureAnchors("<p>No open positions right now.</p>", "jobs")).toBe(1);
    expect(countCaptureAnchors("<p>We are not currently hiring.</p>", "jobs")).toBe(1);
  });

  test("jobs — a bare loading shell has no anchor", () => {
    expect(countCaptureAnchors("<div id='root'>Loading…</div>", "jobs")).toBe(0);
  });

  test("homepage — a heading counts, including role=heading", () => {
    expect(countCaptureAnchors("<h1>Ship faster</h1>", "homepage")).toBe(1);
    expect(countCaptureAnchors('<div role="heading">Ship faster</div>', "homepage")).toBe(1);
    expect(countCaptureAnchors("<div class='x'>Ship faster</div>", "homepage")).toBe(0);
  });

  test("a source with no expected anchor always returns 0", () => {
    expect(countCaptureAnchors("<h1>anything</h1>", "changelog")).toBe(0);
  });
});
