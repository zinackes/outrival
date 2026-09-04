import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { clientIp } from "../src/lib/client-ip";

// Audit 2026-09-02, S-03. Every public rate limit, the signup IP cap and the
// Turnstile remoteip are keyed on this one function, so a single accepted lie
// voids all of them at once.
//
// Production is client -> Traefik -> Bun, with no Cloudflare on the api host
// (verified 2026-09-04). So the two rules under test are: `cf-connecting-ip` is
// never read at all, and of `x-forwarded-for` only the last element counts —
// the one Traefik wrote, not the ones the caller supplied.

/** A one-route app that answers with whatever clientIp() decided. */
const app = new Hono().get("/", (c) => c.json({ ip: clientIp(c) }));

/** Bun's getConnInfo reads the server off the fetch env — this fakes the peer. */
function peerEnv(address: string) {
  return { server: { requestIP: () => ({ address, family: "IPv4", port: 4242 }) } };
}

/** The production shape: the TCP peer is the coolify-proxy container. */
const BEHIND_PROXY = peerEnv("10.0.1.2");

async function resolve(
  headers: Record<string, string>,
  env: unknown = {},
): Promise<string | null> {
  const res = await app.request("/", { headers }, env);
  return ((await res.json()) as { ip: string | null }).ip;
}

describe("clientIp", () => {
  test("1. behind the proxy, the address Traefik appended is the identity", async () => {
    expect(await resolve({ "x-forwarded-for": "203.0.113.7" }, BEHIND_PROXY)).toBe("203.0.113.7");
  });

  test("2. regression: only the LAST x-forwarded-for element is read", async () => {
    // Traefik strips a client-supplied XFF before writing its own, so a list can
    // only arrive from a caller trying to prepend a bucket key. Reading the first
    // element — the usual mistake — would hand out one fresh bucket per request.
    expect(
      await resolve({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.7" }, BEHIND_PROXY),
    ).toBe("203.0.113.7");
  });

  test("3. regression: cf-connecting-ip is never trusted", async () => {
    // Cloudflare does not front api.outrival.app, so this header can only be
    // attacker-written here. It must not create an identity of its own.
    expect(await resolve({ "cf-connecting-ip": "203.0.113.7" }, BEHIND_PROXY)).toBeNull();
  });

  test("4. cf-connecting-ip cannot override what the proxy recorded", async () => {
    expect(
      await resolve(
        { "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.9" },
        BEHIND_PROXY,
      ),
    ).toBe("198.51.100.9");
  });

  test("5. a malformed forwarded address is dropped, not used as a key", async () => {
    // An unbounded key space is itself the bypass: one forged value per request
    // means one fresh bucket per request.
    expect(await resolve({ "x-forwarded-for": "not-an-ip" }, BEHIND_PROXY)).toBeNull();
  });

  test("6. a proxy peer with no forwarded header means no identity", async () => {
    expect(await resolve({}, BEHIND_PROXY)).toBeNull();
  });

  test("7. a public peer is the identity and no header can override it", async () => {
    expect(await resolve({ "x-forwarded-for": "203.0.113.7" }, peerEnv("198.51.100.9"))).toBe(
      "198.51.100.9",
    );
  });

  test("8. loopback is a real identity (dev calls the API directly)", async () => {
    expect(await resolve({}, peerEnv("127.0.0.1"))).toBe("127.0.0.1");
  });

  test("9. no peer and no header at all resolves to null", async () => {
    expect(await resolve({})).toBeNull();
  });
});
