import { afterEach, expect, test } from "bun:test";
import { discoverCommerceCandidates } from "../discover-url";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Route GETs by URL → body. Anything unmatched is a non-2xx (dropped). */
function mockFetch(bodies: Record<string, string>) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push(url);
    const body = Object.entries(bodies).find(([k]) => url.includes(k))?.[1];
    return {
      ok: body != null,
      status: body != null ? 200 : 404,
      url,
      text: async () => body ?? "",
    } as Response;
  }) as typeof fetch;
  return calls;
}

const PRICED = (n: number) => `<html><body><h3>Plan</h3><p>€${n}/mo</p></body></html>`;
const NO_PRICE = `<html><body><p>Feature page, no prices.</p></body></html>`;

test("ranks catalog product pages by price-token density, most first", async () => {
  mockFetch({
    "/vps-hosting": `<html><body><p>€5/mo</p><p>€9/mo</p><p>€19/mo</p></body></html>`,
    "/game-hosting": PRICED(3),
    "/status": NO_PRICE,
  });
  const html = `<body>
    <a href="/vps-hosting">VPS</a>
    <a href="/game-hosting">Game hosting</a>
    <a href="/status">Status</a>
  </body>`;
  const got = await discoverCommerceCandidates("https://host.com/", html);
  // /status has no prices → dropped. VPS (3 prices) ranks above game (1 price).
  expect(got.map((c) => c.url)).toEqual([
    "https://host.com/vps-hosting",
    "https://host.com/game-hosting",
  ]);
  expect(got.every((c) => c.source === "commerce")).toBe(true);
});

test("follows a same-registrable-domain store subdomain", async () => {
  mockFetch({
    "boutique.heberghub.fr/products/vps": PRICED(4),
    "boutique.heberghub.fr/products/web": PRICED(2),
  });
  const html = `<body>
    <a href="https://boutique.heberghub.fr/products/vps">VPS</a>
    <a href="https://boutique.heberghub.fr/products/web">Web</a>
  </body>`;
  const got = await discoverCommerceCandidates("https://heberghub.fr/", html);
  expect(got.map((c) => c.url).sort()).toEqual([
    "https://boutique.heberghub.fr/products/vps",
    "https://boutique.heberghub.fr/products/web",
  ]);
});

test("never leaves the registrable domain (tenant safety)", async () => {
  const calls = mockFetch({ "/vps": PRICED(5) });
  const html = `<body>
    <a href="https://evil.com/vps-hosting">Cheap VPS</a>
    <a href="https://other-store.net/vps">More VPS</a>
  </body>`;
  const got = await discoverCommerceCandidates("https://host.com/", html);
  expect(got).toEqual([]);
  // No cross-domain link was ever fetched.
  expect(calls.every((u) => u.includes("host.com"))).toBe(true);
});

test("< 2 commerce links → no network probes at all (not a catalog)", async () => {
  const calls = mockFetch({ "/vps": PRICED(5) });
  const html = `<body><a href="/vps-hosting">VPS</a><a href="/about">About</a></body>`;
  const got = await discoverCommerceCandidates("https://host.com/", html);
  expect(got).toEqual([]);
  expect(calls).toHaveLength(0);
});
