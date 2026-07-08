import { afterEach, describe, expect, it } from "bun:test";
import { safeFetch } from "./guarded-fetch";

// safeFetch guards worker-side fetches on competitor-derived URLs. It must reject
// an internal host before any network call AND re-validate every redirect hop, so
// an initially-public host can't 3xx toward an internal IP. globalThis.fetch is
// stubbed (never a real network call) and restored after each test.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Minimal Response stand-in: status + a headers.get() over a lower-cased map. */
function mockResponse(status: number, headers: Record<string, string> = {}): Response {
  return {
    status,
    url: "https://public.example.com/",
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => "",
    json: async () => ({}),
  } as unknown as Response;
}

/** Install a fetch stub that counts calls and yields the given response each call. */
function installFetch(handler: (call: number) => Response): { calls: () => number } {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return handler(calls);
  }) as typeof fetch;
  return { calls: () => calls };
}

describe("safeFetch SSRF guard", () => {
  it.each(["http://169.254.169.254/", "http://localhost/"])(
    "throws unsafe_url on internal host %s without fetching",
    async (url) => {
      const stub = installFetch(() => mockResponse(200));
      await expect(safeFetch(url)).rejects.toThrow("unsafe_url");
      expect(stub.calls()).toBe(0);
    },
  );

  it("throws on a redirect from a public host toward an internal host (per-hop re-validation)", async () => {
    // First hop: public host → 302 pointing at the metadata IP. The second hop must
    // be rejected by validatePublicUrl before it is ever fetched.
    const stub = installFetch((call) =>
      call === 1
        ? mockResponse(302, { location: "http://169.254.169.254/latest/meta-data/" })
        : mockResponse(200),
    );
    await expect(safeFetch("https://public.example.com/")).rejects.toThrow("unsafe_url");
    expect(stub.calls()).toBe(1); // internal hop never fetched
  });

  it("returns the Response for a public host that answers 200", async () => {
    installFetch(() => mockResponse(200));
    const res = await safeFetch("https://public.example.com/");
    expect(res.status).toBe(200);
  });

  it("throws too_many_redirects past MAX_REDIRECTS public→public hops", async () => {
    // Every hop 302s to another public host, so validation always passes and the
    // redirect cap is what stops the loop.
    installFetch(() => mockResponse(302, { location: "https://redirect-target.example.com/" }));
    await expect(safeFetch("https://public.example.com/")).rejects.toThrow("too_many_redirects");
  });
});
