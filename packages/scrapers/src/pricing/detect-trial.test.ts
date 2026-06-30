import { expect, test, describe } from "bun:test";
import { detectTrial } from "./detect-trial";

describe("detectTrial", () => {
  test("plain free trial, no duration", () => {
    expect(detectTrial("Start your free trial today")).toEqual({
      hasTrial: true,
      days: null,
      requiresCreditCard: null,
    });
  });

  test("14-day free trial", () => {
    const r = detectTrial("Get started with a 14-day free trial. No credit card required.");
    expect(r.hasTrial).toBe(true);
    expect(r.days).toBe(14);
    expect(r.requiresCreditCard).toBe(false);
  });

  test("trial worded after the duration noun", () => {
    expect(detectTrial("Free trial for 30 days").days).toBe(30);
  });

  test("free for N days phrasing", () => {
    expect(detectTrial("Try it free for 7 days").days).toBe(7);
  });

  test("weeks normalized to days", () => {
    expect(detectTrial("2-week free trial").days).toBe(14);
  });

  test("credit card required", () => {
    expect(detectTrial("Start a free trial — a credit card is required").requiresCreditCard).toBe(
      true,
    );
  });

  test("no credit card wins over a stray 'card required'", () => {
    // "no credit card required" is the marketed promise; prefer it.
    const r = detectTrial("Free trial, no credit card required. Card required only after.");
    expect(r.requiresCreditCard).toBe(false);
  });

  test("freemium free plan is NOT a trial", () => {
    expect(detectTrial("Free plan available. Free forever for individuals.")).toEqual({
      hasTrial: false,
      days: null,
      requiresCreditCard: null,
    });
  });

  test("unrelated money-back guarantee does not leak a duration", () => {
    // No trial phrase → no trial, and the 30-day guarantee must not surface.
    expect(detectTrial("30-day money-back guarantee on all paid plans")).toEqual({
      hasTrial: false,
      days: null,
      requiresCreditCard: null,
    });
  });

  test("absurd durations are rejected", () => {
    // 9999 is out of the 1..365 sanity band → trial yes, days unknown.
    const r = detectTrial("Free trial for 9999 days of fun");
    expect(r.hasTrial).toBe(true);
    expect(r.days).toBeNull();
  });

  test("empty text", () => {
    expect(detectTrial("")).toEqual({ hasTrial: false, days: null, requiresCreditCard: null });
  });
});
