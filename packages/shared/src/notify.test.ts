import { afterEach, describe, expect, test } from "bun:test";
import { sendSlackMessage, sendSlackMessageOrThrow } from "./notify";

// code:SEC-04 — the Slack sender used a bare fetch with the default
// redirect:"follow" and no host check, so a webhook URL that passed save-time
// validation but later 3xx'd toward an internal address was followed with the
// alert text as the POST body. These cases lock the guard its package-mate
// sendWebhook has always had. globalThis.fetch is stubbed — never a real call.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockResponse(status: number, headers: Record<string, string> = {}): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => "",
  } as unknown as Response;
}

function installFetch(handler: (call: number, url: string) => Response): {
  calls: () => number;
  urls: () => string[];
} {
  let calls = 0;
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    calls += 1;
    const url = String(input);
    urls.push(url);
    return handler(calls, url);
  }) as unknown as typeof fetch;
  return { calls: () => calls, urls: () => [...urls] };
}

const OK = "https://hooks.slack.test/services/T/B/x";

describe("sendSlackMessageOrThrow", () => {
  test("posts to a safe https webhook", async () => {
    const stub = installFetch(() => mockResponse(200));
    await sendSlackMessageOrThrow(OK, "hello");
    expect(stub.calls()).toBe(1);
  });

  test.each([
    "http://hooks.slack.test/services/T/B/x", // not https
    "https://localhost/hook",
    "https://redis/hook",
    "https://x.corp.internal/hook",
    "https://169.254.169.254/hook",
  ])("refuses %s without any network call", async (url) => {
    const stub = installFetch(() => mockResponse(200));
    await expect(sendSlackMessageOrThrow(url, "hello")).rejects.toThrow("unsafe_url");
    expect(stub.calls()).toBe(0);
  });

  test("re-validates every redirect hop instead of following blindly", async () => {
    const stub = installFetch((call) =>
      call === 1
        ? mockResponse(302, { location: "http://169.254.169.254/latest/meta-data/" })
        : mockResponse(200),
    );
    await expect(sendSlackMessageOrThrow(OK, "hello")).rejects.toThrow("unsafe_url");
    // Hop 1 went out; the internal redirect target never did.
    expect(stub.calls()).toBe(1);
  });

  test("bounds a redirect loop between safe hosts", async () => {
    const stub = installFetch(() => mockResponse(302, { location: OK }));
    await expect(sendSlackMessageOrThrow(OK, "hello")).rejects.toThrow("too_many_redirects");
    expect(stub.calls()).toBe(6); // initial + MAX_REDIRECTS
  });

  test("surfaces a non-2xx so a job can retry", async () => {
    installFetch(() => mockResponse(500));
    await expect(sendSlackMessageOrThrow(OK, "hello")).rejects.toThrow("Slack webhook failed");
  });
});

describe("sendSlackMessage (best effort)", () => {
  test("swallows the same rejections instead of failing the caller", async () => {
    const stub = installFetch(() => mockResponse(200));
    await sendSlackMessage("https://x.corp.internal/hook", "hello");
    await sendSlackMessage("", "hello");
    expect(stub.calls()).toBe(0);
  });
});
