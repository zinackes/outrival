import { describe, expect, test } from "bun:test";
import { canonicalizeEmail, emailSchema, isDisposableEmailDomain } from "./email";

describe("emailSchema", () => {
  test("accepts a normal address and normalizes case/whitespace", () => {
    const r = emailSchema.safeParse("  Founder@Acme.com ");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("founder@acme.com");
  });

  test("rejects an address without @", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
  });

  test("rejects an address without a TLD", () => {
    expect(emailSchema.safeParse("user@localhost").success).toBe(false);
  });

  test("rejects a disposable domain", () => {
    const r = emailSchema.safeParse("burner@mailinator.com");
    expect(r.success).toBe(false);
  });

  test("rejects an over-long address", () => {
    const long = `${"a".repeat(250)}@x.com`;
    expect(emailSchema.safeParse(long).success).toBe(false);
  });
});

describe("isDisposableEmailDomain", () => {
  test("flags known disposable domains (case-insensitive)", () => {
    expect(isDisposableEmailDomain("x@YOPMAIL.com")).toBe(true);
  });

  test("does not flag a real domain", () => {
    expect(isDisposableEmailDomain("x@stripe.com")).toBe(false);
  });
});

describe("canonicalizeEmail", () => {
  test("strips +tag on any domain", () => {
    expect(canonicalizeEmail("user+newsletter@fastmail.com")).toBe("user@fastmail.com");
  });

  test("keeps dots on non-Google domains", () => {
    expect(canonicalizeEmail("first.last@acme.com")).toBe("first.last@acme.com");
  });

  test("strips dots and +tag on gmail, folds googlemail into gmail", () => {
    expect(canonicalizeEmail("j.o.h.n@gmail.com")).toBe("john@gmail.com");
    expect(canonicalizeEmail("john+promo@gmail.com")).toBe("john@gmail.com");
    expect(canonicalizeEmail("John.Doe+test@googlemail.com")).toBe("johndoe@gmail.com");
  });

  test("lowercases and trims", () => {
    expect(canonicalizeEmail("  Founder@Acme.com ")).toBe("founder@acme.com");
  });

  test("all four Gmail variants collapse to one key", () => {
    const variants = [
      "john.doe@gmail.com",
      "johndoe@gmail.com",
      "john.doe+a@gmail.com",
      "J.O.H.N.D.O.E@googlemail.com",
    ];
    const keys = new Set(variants.map(canonicalizeEmail));
    expect(keys.size).toBe(1);
  });
});
