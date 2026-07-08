import crypto from "node:crypto";
import { describe, expect, test } from "bun:test";
import { isSafeWebhookUrl, signBody } from "./sign";

// signBody + isSafeWebhookUrl are single-sourced here so apps/api and
// apps/workers (which can't import each other) share one signer instead of
// hand-copied divergent implementations. These cases lock the signature
// format and the SSRF host filter that both call sites rely on.
describe("signBody", () => {
  test("returns a sha256=<hex> signature", () => {
    const sig = signBody("secret", "body");
    expect(sig).toMatch(/^sha256=[0-9a-f]+$/);
  });

  test("matches a known-good HMAC computed inline", () => {
    const expected = `sha256=${crypto.createHmac("sha256", "my-secret").update("hello world").digest("hex")}`;
    expect(signBody("my-secret", "hello world")).toBe(expected);
  });

  test("is deterministic for the same inputs", () => {
    expect(signBody("s", "b")).toBe(signBody("s", "b"));
  });

  test("differs when the secret differs", () => {
    expect(signBody("s1", "b")).not.toBe(signBody("s2", "b"));
  });

  test("differs when the body differs", () => {
    expect(signBody("s", "b1")).not.toBe(signBody("s", "b2"));
  });
});

describe("isSafeWebhookUrl", () => {
  test("accepts an https public URL", () => {
    expect(isSafeWebhookUrl("https://example.com/hooks/outrival")).toBe(true);
  });

  test("rejects http (non-https)", () => {
    expect(isSafeWebhookUrl("http://example.com/hooks")).toBe(false);
  });

  test("rejects localhost", () => {
    expect(isSafeWebhookUrl("https://localhost/hooks")).toBe(false);
  });

  test("rejects 127.0.0.1", () => {
    expect(isSafeWebhookUrl("https://127.0.0.1/hooks")).toBe(false);
  });

  test("rejects a 10.x private address", () => {
    expect(isSafeWebhookUrl("https://10.0.0.5/hooks")).toBe(false);
  });

  test("rejects a 192.168.x private address", () => {
    expect(isSafeWebhookUrl("https://192.168.1.1/hooks")).toBe(false);
  });

  test("rejects a 169.254.x link-local address", () => {
    expect(isSafeWebhookUrl("https://169.254.169.254/hooks")).toBe(false);
  });

  test("rejects a 172.16-31.x private address", () => {
    expect(isSafeWebhookUrl("https://172.20.0.1/hooks")).toBe(false);
  });

  test("accepts a 172.x address outside the 16-31 private range", () => {
    expect(isSafeWebhookUrl("https://172.32.0.1/hooks")).toBe(true);
  });

  test("rejects an unparseable url", () => {
    expect(isSafeWebhookUrl("not a url")).toBe(false);
  });
});
