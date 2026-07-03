import { afterEach, describe, expect, it } from "bun:test";
import { scrapeDirect } from "../scrape-direct";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(status: number, body: string) {
  globalThis.fetch = (async () =>
    ({
      status,
      url: "https://example.com/pricing",
      text: async () => body,
      headers: { get: () => null },
    }) as unknown as Response) as typeof fetch;
}

const BIG = "<html><body>" + "real visible pricing content ".repeat(50) + "</body></html>";

describe("scrapeDirect — HTTP status handling", () => {
  it("rejects a 404 as a non-escalating http_error (not needs_render)", async () => {
    // The codebenders bug: an apex /pricing 404 with a tiny 'Not Found' body used to
    // fall through to needs_render → get browser-rendered → land as a success.
    mockFetch(404, `<html><head><title>Not Found</title></head><body>HTTP Status: 404</body></html>`);
    const r = await scrapeDirect("https://example.com/pricing");
    expect(r.ok).toBe(false);
    expect(r.failureReason).toBe("http_error");
    expect(r.statusCode).toBe(404);
  });

  it("rejects a 500 as http_error", async () => {
    mockFetch(500, BIG);
    const r = await scrapeDirect("https://example.com/pricing");
    expect(r.ok).toBe(false);
    expect(r.failureReason).toBe("http_error");
  });

  it("keeps 403 as a block (escalates to a proxy, unchanged)", async () => {
    mockFetch(403, "blocked");
    const r = await scrapeDirect("https://example.com/pricing");
    expect(r.failureReason).toBe("blocked_403");
  });

  it("a 200 with a tiny body is still needs_render (SPA shell)", async () => {
    mockFetch(200, `<html><body><div id="root"></div></body></html>`);
    const r = await scrapeDirect("https://example.com/");
    expect(r.failureReason).toBe("needs_render");
  });

  it("a 200 with real content succeeds", async () => {
    mockFetch(200, BIG);
    const r = await scrapeDirect("https://example.com/");
    expect(r.ok).toBe(true);
  });
});
