import { describe, expect, it } from "bun:test";
import { detectFreePlan } from "./detect-free-plan";

describe("detectFreePlan", () => {
  it("detects a named free plan / tier / version", () => {
    expect(detectFreePlan("Our Free plan includes 3 projects")).toBe(true);
    expect(detectFreePlan("Start on the free tier, upgrade anytime")).toBe(true);
    expect(detectFreePlan("A free version is available for personal use")).toBe(true);
    expect(detectFreePlan("Create a free account to get started")).toBe(true);
  });

  it("detects forever/always free", () => {
    expect(detectFreePlan("Free forever for individuals")).toBe(true);
    expect(detectFreePlan("Forever free, no card needed")).toBe(true);
    expect(detectFreePlan("Always free for open-source projects")).toBe(true);
  });

  it("detects 'free for <permanent audience>'", () => {
    expect(detectFreePlan("Free for individuals")).toBe(true);
    expect(detectFreePlan("Free for students and teachers")).toBe(true);
    expect(detectFreePlan("Free for up to 5 users")).toBe(true);
    expect(detectFreePlan("Free for 3 seats, then $10/seat")).toBe(true);
  });

  it("detects a recurring $0 price", () => {
    expect(detectFreePlan("Basic — $0/mo")).toBe(true);
    expect(detectFreePlan("€0 / month for the starter tier")).toBe(true);
    expect(detectFreePlan("$0 per user, billed monthly")).toBe(true);
    expect(detectFreePlan("£0/year")).toBe(true);
  });

  it("detects a 'Free' column header in a plan lineup (decktopus)", () => {
    // Flattened comparison-table headers: "Free" has no price token, only the paid
    // columns do — the exact case the priced-card extractor misses.
    expect(
      detectFreePlan(
        "50% discount code for students: SUPPORTEDUCATION Free PRO AI Business AI Deck Creation Features Number of Presentations Unlimited",
      ),
    ).toBe(true);
    expect(detectFreePlan("Free Starter Pro Enterprise Compare plans")).toBe(true);
  });

  it("does NOT fire on a free trial (that's detect-trial's job)", () => {
    expect(detectFreePlan("Start your 14-day free trial")).toBe(false);
    expect(detectFreePlan("Try it free for 7 days")).toBe(false);
    expect(detectFreePlan("Free for 30 days, then $29/mo")).toBe(false);
  });

  it("does NOT fire on generic marketing 'free'", () => {
    expect(detectFreePlan("Risk-free money-back guarantee")).toBe(false);
    expect(detectFreePlan("Feel free to contact sales")).toBe(false);
    expect(detectFreePlan("Toll-free support line")).toBe(false);
    expect(detectFreePlan("Free up your team's time")).toBe(false);
    expect(detectFreePlan("Hassle-free onboarding")).toBe(false);
  });

  it("does NOT fire on a 'start free' CTA next to paid plans (a trial, not a plan)", () => {
    expect(detectFreePlan("Try it free — compare Pro and Business")).toBe(false);
    expect(detectFreePlan("Get started free with our Pro and Business plans")).toBe(false);
  });

  it("does NOT fire on a $0 hook without a period", () => {
    expect(detectFreePlan("$0 setup fee on all plans")).toBe(false);
    expect(detectFreePlan("Pay $0 today, cancel anytime")).toBe(false);
  });

  it("returns false on empty / priced-only pages", () => {
    expect(detectFreePlan("")).toBe(false);
    expect(detectFreePlan("Pro $29/mo · Business $99/mo · Enterprise: contact us")).toBe(false);
  });
});
