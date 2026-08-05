import { describe, expect, test } from "bun:test";
import {
  independentPassDelayMin,
  isLivePageCapture,
  severityInScope,
  shouldVerifyEmission,
  QUICK_CHECK_DELAY_MIN,
  VERIFY_DELAY_MIN,
  VOLATILE_SOURCES,
  type EmissionScopeInput,
} from "../src/lib/verification-scope";

// The perimeter of the double capture (Véracité Intelligence v2 P2). Pure, so the
// policy is asserted without a queue, a page or a clock.

const live = (over: Partial<EmissionScopeInput> = {}): EmissionScopeInput => ({
  severity: "critical",
  sourceType: "pricing",
  snapshotStatus: "success",
  captureMethod: "rendered",
  hasUrl: true,
  hasEvidence: true,
  flapMatch: false,
  ...over,
});

describe("isLivePageCapture", () => {
  test("accepts a successful static or rendered capture with a URL", () => {
    expect(isLivePageCapture({ snapshotStatus: "success", captureMethod: "static", hasUrl: true })).toBeNull();
    expect(isLivePageCapture({ snapshotStatus: "success", captureMethod: "rendered", hasUrl: true })).toBeNull();
  });

  test("rejects a synthetic anchor: no capture_method means no page was fetched", () => {
    expect(isLivePageCapture({ snapshotStatus: "success", captureMethod: null, hasUrl: true })).toBe(
      "not_replayable",
    );
  });

  test("rejects feed and api captures — neither is a page to re-capture", () => {
    for (const method of ["feed", "api"]) {
      expect(isLivePageCapture({ snapshotStatus: "success", captureMethod: method, hasUrl: true })).toBe(
        "not_replayable",
      );
    }
  });

  test("rejects a partial capture: a second look cannot vouch for a degraded first one", () => {
    expect(
      isLivePageCapture({ snapshotStatus: "partial", captureMethod: "rendered", hasUrl: true }),
    ).toBe("partial_capture");
  });

  test("rejects a capture with no URL to go back to", () => {
    expect(
      isLivePageCapture({ snapshotStatus: "success", captureMethod: "static", hasUrl: false }),
    ).toBe("no_url");
  });
});

describe("severityInScope", () => {
  test("critical is in scope on every source", () => {
    for (const source of ["pricing", "homepage", "blog", "news", "changelog", "comparison_page"]) {
      expect(severityInScope("critical", source)).toBe(true);
    }
  });

  test("high is in scope only on a volatile source", () => {
    expect(severityInScope("high", "pricing")).toBe(true);
    expect(severityInScope("high", "homepage")).toBe(true);
    expect(severityInScope("high", "blog")).toBe(false);
    expect(severityInScope("high", "jobs")).toBe(false);
  });

  test("medium and low are never in scope, whatever the source", () => {
    for (const source of [...VOLATILE_SOURCES, "blog", "news"]) {
      expect(severityInScope("medium", source)).toBe(false);
      expect(severityInScope("low", source)).toBe(false);
    }
  });
});

describe("shouldVerifyEmission", () => {
  test("verifies a critical on a live capture", () => {
    expect(shouldVerifyEmission(live())).toEqual({ verify: true, reason: "critical" });
  });

  test("verifies a high on a volatile source", () => {
    expect(shouldVerifyEmission(live({ severity: "high" }))).toEqual({
      verify: true,
      reason: "volatile_high",
    });
  });

  test("never defers a high on a non-volatile source", () => {
    expect(shouldVerifyEmission(live({ severity: "high", sourceType: "blog" }))).toEqual({
      verify: false,
      reason: "out_of_scope",
    });
  });

  test("never defers a medium or a low", () => {
    expect(shouldVerifyEmission(live({ severity: "medium" })).verify).toBe(false);
    expect(shouldVerifyEmission(live({ severity: "low" })).verify).toBe(false);
  });

  test("never verifies a synthetic anchor, even at critical", () => {
    expect(shouldVerifyEmission(live({ captureMethod: null }))).toEqual({
      verify: false,
      reason: "not_replayable",
    });
  });

  test("never verifies a partial capture", () => {
    expect(shouldVerifyEmission(live({ snapshotStatus: "partial" })).verify).toBe(false);
  });

  test("does not verify a change whose delta carries no distinctive excerpt", () => {
    expect(shouldVerifyEmission(live({ hasEvidence: false }))).toEqual({
      verify: false,
      reason: "no_evidence",
    });
  });

  describe("flap override", () => {
    test("routes a medium into verification when the delta already failed to reproduce", () => {
      expect(shouldVerifyEmission(live({ severity: "medium", flapMatch: true }))).toEqual({
        verify: true,
        reason: "flap",
      });
    });

    test("does NOT override the live-capture test — an unreplayable page stays unverified", () => {
      expect(
        shouldVerifyEmission(live({ severity: "medium", flapMatch: true, captureMethod: null })),
      ).toEqual({ verify: false, reason: "not_replayable" });
    });

    test("does NOT override the evidence test", () => {
      expect(
        shouldVerifyEmission(live({ severity: "medium", flapMatch: true, hasEvidence: false })),
      ).toEqual({ verify: false, reason: "no_evidence" });
    });
  });
});

describe("delays", () => {
  test("the independent pass waits out the remainder of the total delay", () => {
    expect(independentPassDelayMin()).toBe(VERIFY_DELAY_MIN - QUICK_CHECK_DELAY_MIN);
  });

  test("the quick check comes first", () => {
    expect(QUICK_CHECK_DELAY_MIN).toBeLessThan(VERIFY_DELAY_MIN);
  });
});
