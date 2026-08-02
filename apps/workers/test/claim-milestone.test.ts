import { describe, expect, test } from "bun:test";
import { crossesRoundMilestone } from "../src/lib/claim-milestone";

/**
 * Positioning Intelligence v2 P1. The claim detector already fires on any move
 * past 20%; this is what separates "they keep growing" from "they just passed
 * 10,000 customers", which is the one a reader wants named.
 *
 * There is no cooldown to test and that is deliberate: the detector compares each
 * claim to its LAST OBSERVED value, so a figure that moves once fires once and the
 * new value immediately becomes the baseline. A claim sitting at 12,000 cannot
 * re-announce crossing 10,000 next week, because 10,000 is no longer behind it.
 */

describe("crossesRoundMilestone", () => {
  test("names the round number a rising claim passed", () => {
    expect(crossesRoundMilestone(8_000, 12_000, "customers")).toBe(10_000);
  });

  test("drift inside a decade crosses nothing", () => {
    expect(crossesRoundMilestone(12_000, 18_000, "customers")).toBeNull();
  });

  test("a fall past a round number is news too", () => {
    // Signed on purpose: a company that drops back under 10,000 users has said
    // something about itself, and it is the same size of statement.
    expect(crossesRoundMilestone(12_000, 8_000, "users")).toBe(10_000);
  });

  test("landing exactly ON the number counts as reaching it", () => {
    expect(crossesRoundMilestone(9_500, 10_000, "teams")).toBe(10_000);
  });

  test("a claim already sitting on the number does not re-announce it", () => {
    expect(crossesRoundMilestone(10_000, 14_000, "teams")).toBeNull();
  });

  test("a jump across several decades names the highest one reached", () => {
    expect(crossesRoundMilestone(900, 1_200_000, "developers")).toBe(1_000_000);
  });

  test("percentages have no milestones", () => {
    // "99.9% uptime passed 1,000" cannot happen, and a satisfaction score
    // crossing 100 would be a parse bug announcing itself as news.
    expect(crossesRoundMilestone(50, 99.9, "%")).toBeNull();
  });

  test("a non-finite value never produces a milestone", () => {
    expect(crossesRoundMilestone(0, Number.POSITIVE_INFINITY, "customers")).toBeNull();
    expect(crossesRoundMilestone(Number.NaN, 10_000, "customers")).toBeNull();
  });
});
