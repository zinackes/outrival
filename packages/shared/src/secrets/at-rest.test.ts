process.env.OAUTH_TOKEN_ENCRYPTION_KEY = "a".repeat(64);

import { afterEach, describe, expect, test } from "bun:test";
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
  isSecretEncryptionConfigured,
  readStoredSecret,
} from "./at-rest";

const KEY = "a".repeat(64);

afterEach(() => {
  process.env.OAUTH_TOKEN_ENCRYPTION_KEY = KEY;
});

describe("encryptSecret / decryptSecret", () => {
  test("round-trips a signing secret", () => {
    const secret = "whsec_2f9c1d4b8a";
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  test("never returns the plaintext, and carries the v1 scheme prefix", () => {
    const payload = encryptSecret("whsec_2f9c1d4b8a");
    expect(payload).not.toContain("whsec_2f9c1d4b8a");
    expect(payload.startsWith("v1.")).toBe(true);
    expect(payload.split(".")).toHaveLength(4);
  });

  test("a fresh IV per call, so two identical secrets are not correlatable", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  test("a tampered payload fails the auth tag instead of yielding a wrong secret", () => {
    const payload = encryptSecret("whsec_2f9c1d4b8a");
    const tampered = `${payload.slice(0, -4)}AAAA`;
    expect(() => decryptSecret(tampered)).toThrow("secret_undecryptable");
    expect(() => decryptSecret("not-a-payload")).toThrow("secret_undecryptable");
    expect(() => decryptSecret("v2.a.b.c")).toThrow("secret_undecryptable");
  });

  test("the error never echoes the payload — it lands in logs next to the org id", () => {
    const payload = encryptSecret("whsec_2f9c1d4b8a");
    const tampered = `${payload.slice(0, -4)}AAAA`;
    expect(() => decryptSecret(tampered)).toThrow(/^secret_undecryptable$/);
  });
});

describe("readStoredSecret: the plaintext rows written before encryption", () => {
  test("passes a legacy plaintext secret straight through", () => {
    expect(readStoredSecret("whsec_legacy_plaintext")).toBe("whsec_legacy_plaintext");
  });

  test("decrypts a row written by encryptSecret", () => {
    expect(readStoredSecret(encryptSecret("whsec_new"))).toBe("whsec_new");
  });

  test("a destination with no secret reads as null", () => {
    expect(readStoredSecret(null)).toBeNull();
    expect(readStoredSecret("")).toBeNull();
    expect(readStoredSecret(undefined)).toBeNull();
  });

  test("a v1-prefixed value that will not decrypt throws — corruption is not plaintext", () => {
    expect(() => readStoredSecret("v1.a.b.c")).toThrow("secret_undecryptable");
  });
});

describe("isEncryptedSecret / isSecretEncryptionConfigured", () => {
  test("tells a backfilled row from a legacy one", () => {
    expect(isEncryptedSecret(encryptSecret("x"))).toBe(true);
    expect(isEncryptedSecret("whsec_legacy")).toBe(false);
  });

  test("reads the env on every call, so a route can refuse before it throws", () => {
    expect(isSecretEncryptionConfigured()).toBe(true);
    delete process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
    expect(isSecretEncryptionConfigured()).toBe(false);
  });
});
