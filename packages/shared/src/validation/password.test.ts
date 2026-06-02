import { describe, expect, test } from "bun:test";
import { isPasswordPwned, passwordSchema } from "./password";

describe("passwordSchema", () => {
  test("rejects passwords under 12 characters", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
  });

  test("accepts a 12+ character passphrase", () => {
    expect(passwordSchema.safeParse("correct horse battery").success).toBe(true);
  });
});

describe("isPasswordPwned (hits the live HIBP range API)", () => {
  test("flags a famously breached password", async () => {
    expect(await isPasswordPwned("password")).toBe(true);
  });

  test("does not flag a random strong password", async () => {
    const random = `zX9q-${Math.random().toString(36).slice(2)}-${Date.now()}-uvw`;
    expect(await isPasswordPwned(random)).toBe(false);
  });
});
