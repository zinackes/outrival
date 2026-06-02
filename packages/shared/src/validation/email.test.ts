import { describe, expect, test } from "bun:test";
import { emailSchema, isDisposableEmailDomain } from "./email";

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
