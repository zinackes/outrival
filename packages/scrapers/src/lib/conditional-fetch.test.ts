import { afterEach, beforeEach, expect, test } from "bun:test";
import { conditionalFetch } from "./conditional-fetch";
import { OUTRIVAL_UA } from "./fingerprint";
import { __clearRobotsCache } from "./robots";
import { __clearRateLimitState } from "./rate-limit";

// code:COR-03 — the conditional pre-flight is a real GET, but it went straight to
// safeFetch: no robots.txt check, no per-domain slot, and a hardcoded User-Agent
// that had drifted from OUTRIVAL_UA. The package's own doctrine says robots.txt is
// checked before ANY request. globalThis.fetch is stubbed — never a real call.

const realFetch = globalThis.fetch;

beforeEach(() => {
  __clearRobotsCache();
  __clearRateLimitState();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function response(status: number, body = "", headers: Record<string, string> = {}): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    body: null,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => body,
  } as unknown as Response;
}

/** Serve `robotsBody` for /robots.txt, 200 for anything else. Records every URL. */
function installFetch(robotsBody: string): {
  urls: () => string[];
  headers: () => Record<string, string>[];
} {
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    headers.push((init?.headers ?? {}) as Record<string, string>);
    if (url.endsWith("/robots.txt")) return response(200, robotsBody);
    return response(200, "", { etag: 'W/"abc"' });
  }) as unknown as typeof fetch;
  return { urls: () => [...urls], headers: () => [...headers] };
}

const TARGET = "https://example.com/changelog";

test("a Disallow on the target path stops the pre-flight before the GET", async () => {
  const stub = installFetch("User-agent: *\nDisallow: /changelog");

  const res = await conditionalFetch(TARGET, 'W/"old"');

  // Fail-open on the RESULT (the caller still falls through), but the request
  // itself never went out — only robots.txt did.
  expect(res.notModified).toBe(false);
  expect(stub.urls()).toEqual(["https://example.com/robots.txt"]);
});

test("an allowed path still runs the conditional GET, with the canonical UA", async () => {
  const stub = installFetch("User-agent: *\nDisallow: /admin");

  const res = await conditionalFetch(TARGET, 'W/"old"', "Mon, 01 Jan 2024 00:00:00 GMT");

  expect(stub.urls()).toEqual(["https://example.com/robots.txt", TARGET]);
  expect(res.etag).toBe('W/"abc"');

  const sent = stub.headers()[1] as Record<string, string>;
  expect(sent["User-Agent"]).toBe(OUTRIVAL_UA);
  expect(sent["If-None-Match"]).toBe('W/"old"');
});

test("an OutrivalBot-specific Disallow is honoured over the wildcard group", async () => {
  const stub = installFetch(
    "User-agent: *\nDisallow:\n\nUser-agent: OutrivalBot\nDisallow: /",
  );

  await conditionalFetch(TARGET);

  expect(stub.urls()).toEqual(["https://example.com/robots.txt"]);
});
