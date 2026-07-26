import crypto from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import { isSafeWebhookUrl, sendWebhook, signBody } from "./sign";

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

  // Regression: new URL(...).hostname keeps the brackets on an IPv6 literal
  // ("[::1]", not "::1"), which used to defeat both an equality check and a
  // startsWith prefix check outright — every IPv6 branch was dead code.
  test("rejects the IPv6 loopback", () => {
    expect(isSafeWebhookUrl("https://[::1]/hook")).toBe(false);
  });

  test("rejects an IPv6 unique-local address", () => {
    expect(isSafeWebhookUrl("https://[fd00::1]/hook")).toBe(false);
  });

  test("rejects an IPv4-mapped IPv6 loopback", () => {
    expect(isSafeWebhookUrl("https://[::ffff:127.0.0.1]/hook")).toBe(false);
  });

  test("rejects a .internal host", () => {
    expect(isSafeWebhookUrl("https://foo.internal/hook")).toBe(false);
  });

  test("rejects a CGNAT (100.64.0.0/10) address", () => {
    expect(isSafeWebhookUrl("https://100.64.0.1/hook")).toBe(false);
  });

  test("rejects a single-label intranet host", () => {
    expect(isSafeWebhookUrl("https://intranet/hook")).toBe(false);
  });

  test("still accepts a normal public https URL", () => {
    expect(isSafeWebhookUrl("https://hooks.example.com/x")).toBe(true);
  });
});

// globalThis.fetch is stubbed (never a real network call) and restored after
// each test — same technique as packages/scrapers/src/lib/guarded-fetch.test.ts,
// a plain global reassignment rather than Bun's process-global mock.module.
describe("sendWebhook", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function mockResponse(status: number, headers: Record<string, string> = {}): Response {
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    } as unknown as Response;
  }

  function installFetch(handler: (call: number) => Response): { calls: () => number } {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return handler(calls);
    }) as typeof fetch;
    return { calls: () => calls };
  }

  test("does not follow a 3xx toward a private host", async () => {
    // First hop: public host → 302 pointing at the metadata IP. The redirect
    // must be rejected by isSafeWebhookUrl before the second hop is fetched.
    const stub = installFetch((call) =>
      call === 1
        ? mockResponse(302, { location: "http://169.254.169.254/latest/meta-data/" })
        : mockResponse(200),
    );
    const delivered = await sendWebhook("https://public.example.com/", null, { a: 1 });
    expect(delivered).toBe(false);
    expect(stub.calls()).toBe(1); // internal hop never fetched
  });

  test("returns true when the destination answers 2xx", async () => {
    installFetch(() => mockResponse(200));
    expect(await sendWebhook("https://public.example.com/", null, { a: 1 })).toBe(true);
  });

  test("returns false when the destination answers non-ok", async () => {
    installFetch(() => mockResponse(500));
    expect(await sendWebhook("https://public.example.com/", null, { a: 1 })).toBe(false);
  });

  test("returns false past MAX_REDIRECTS public->public hops instead of throwing", async () => {
    installFetch(() => mockResponse(302, { location: "https://redirect-target.example.com/" }));
    expect(await sendWebhook("https://public.example.com/", null, { a: 1 })).toBe(false);
  });

  test("follows a public->public redirect and returns true on the final 2xx", async () => {
    const stub = installFetch((call) =>
      call === 1
        ? mockResponse(302, { location: "https://redirect-target.example.com/" })
        : mockResponse(200),
    );
    expect(await sendWebhook("https://public.example.com/", null, { a: 1 })).toBe(true);
    expect(stub.calls()).toBe(2);
  });
});
