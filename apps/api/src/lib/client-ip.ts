import { isIP } from "node:net";
import type { Context } from "hono";
import { getConnInfo } from "hono/bun";

// The ONE place that answers "who is calling". Every public rate limit, the
// signup IP cap and the Turnstile remoteip key off this, so a single lie
// accepted here voids all of them at once (audit 2026-09-02, S-03).
//
// TOPOLOGY, verified 2026-09-04 and not what the audit assumed. `api.outrival.app`
// and the apex resolve to 151.80.58.65 (OVH, DNS-only); only `www` is proxied by
// Cloudflare. So a request reaches Bun as:
//
//     client --443--> Traefik (coolify-proxy, 10.0.1.2) --> this process (10.0.1.6)
//
// Two consequences drive the rules below:
//
//  1. `cf-connecting-ip` is NEVER read. Cloudflare is not in this path, so the
//     header can only ever be attacker-written here. The audit's proposed fix
//     ("trust it when the peer is a Cloudflare range") would have trusted a
//     header nothing produces.
//  2. `x-forwarded-for` is read, but only its LAST element. Coolify's Traefik runs
//     with no `forwardedheaders.insecure` and no `trustedIPs`, which is the secure
//     default: X-Forwarded-* arriving from an untrusted client are stripped before
//     the proxy writes its own. The last element is therefore the TCP peer Traefik
//     saw. Reading the first element instead would read whatever the caller put
//     there. Taking the last is also correct if the trust setting is ever loosened,
//     since the proxy appends its own view at the end either way.
//
// Returns null when no identity can be established. Callers must FAIL CLOSED on
// null (429), never fall back to a shared constant: one bucket shared by every
// unidentified caller is a bucket any single caller can exhaust for everyone.
//
// IF `api.outrival.app` IS EVER PUT BEHIND CLOUDFLARE (orange cloud), this
// function must change in the same commit: the last XFF element becomes a
// Cloudflare edge address, which would collapse every visitor into a handful of
// shared buckets and 429 the whole site. `cf-connecting-ip` becomes the source at
// that point, and only then.

function isInfrastructureAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  const v6 = ip.toLowerCase();
  // fc00::/7 (unique local) and fe80::/10 (link local).
  return /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

/** The TCP peer, or null when the runtime can't report one (tests, non-Bun). */
function peerAddress(c: Context): string | null {
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    return null;
  }
}

/** The address Traefik recorded, i.e. the last element it appended to XFF. */
function proxyRecordedAddress(c: Context): string | null {
  const forwarded = c.req.header("x-forwarded-for");
  if (!forwarded) return null;
  const last = forwarded.split(",").pop()?.trim();
  return last && isIP(last) !== 0 ? last : null;
}

export function clientIp(c: Context): string | null {
  const peer = peerAddress(c)?.trim();

  // Direct connection: dev, or anything that reached Bun without the proxy. The
  // peer is the client, and no header can override it.
  if (peer && isIP(peer) !== 0 && !isInfrastructureAddress(peer)) return peer;

  // Behind Traefik: the peer is the proxy, so the honest answer lives in the
  // header the proxy itself wrote.
  return proxyRecordedAddress(c);
}
