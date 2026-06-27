import { describe, expect, test } from "bun:test";
import { isDisposableEmail } from "../src/lib/disposable-email";

describe("isDisposableEmail", () => {
  test("flags known throwaway domains", () => {
    expect(isDisposableEmail("foo@mailinator.com")).toBe(true);
    expect(isDisposableEmail("bar@guerrillamail.com")).toBe(true);
    expect(isDisposableEmail("baz@yopmail.com")).toBe(true);
  });

  test("allows real providers and custom domains", () => {
    expect(isDisposableEmail("user@gmail.com")).toBe(false);
    expect(isDisposableEmail("ceo@outrival.io")).toBe(false);
    expect(isDisposableEmail("person@company.co")).toBe(false);
  });

  test("normalizes case and surrounding whitespace", () => {
    expect(isDisposableEmail("  USER@MAILINATOR.COM  ")).toBe(true);
  });

  test("covers far more than the curated client-side set", () => {
    // Regression guard: if the dependency ever shrinks to a stub, this trips.
    const { disposableEmailBlocklistSet } = require("disposable-email-domains-js");
    expect(disposableEmailBlocklistSet().size).toBeGreaterThan(1000);
  });
});
