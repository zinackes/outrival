import crypto from "node:crypto";
import { validatePublicUrl } from "../monitor-url";

// Outbound webhook helper (Phase C). Single-sourced here so apps/api and
// apps/workers (which can't import each other) share one signer/sender
// instead of hand-copied divergent implementations. See docs/distribution-team.md.

export function signBody(secret: string, body: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** True if `hostname` (from `URL.hostname`) is an IPv4 or bracketed IPv6 literal. */
function isIpLiteralHostname(hostname: string): boolean {
  return (hostname.startsWith("[") && hostname.endsWith("]")) ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

const CGNAT = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./; // 100.64.0.0/10

/**
 * Accept/reject an IP-literal host on its own — `validatePublicUrl` rejects
 * every IP literal unconditionally, which is right for a monitor URL but too
 * strict for a webhook destination (a bare public IP, e.g. 172.32.0.1, is a
 * legitimate customer endpoint; `sign.test.ts` locks that in). Takes the
 * already-parsed `URL.hostname`, not the raw string, and strips the `[ ]`
 * IPv6 brackets before comparing — matching on the raw string is exactly the
 * bug that made every IPv6 branch here dead code.
 */
function isPublicIpLiteral(hostname: string): boolean {
  const host = (
    hostname.startsWith("[") ? hostname.slice(1, -1) : hostname
  ).toLowerCase();

  // A plain IPv4 literal, or an IPv4-mapped IPv6 literal. The WHATWG URL
  // parser always normalizes the latter to its compressed hex form
  // (::ffff:127.0.0.1 -> ::ffff:7f00:1), never keeps the dotted-decimal
  // tail — decode the two trailing hex groups back to dotted-decimal so the
  // same IPv4 rules below apply to both.
  const v4Mapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  const dotted = host.match(/^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/);
  let ip: string | null = null;
  if (v4Mapped) {
    const hi = Number.parseInt(v4Mapped[1] as string, 16);
    const lo = Number.parseInt(v4Mapped[2] as string, 16);
    ip = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  } else if (dotted) {
    ip = dotted[1] as string;
  }
  if (ip) {
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(ip)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return false;
    if (CGNAT.test(ip)) return false;
    return true;
  }

  if (host === "::1" || host === "::") return false; // loopback / unspecified
  if (host.startsWith("fe80:")) return false; // link-local, fe80::/10
  if (host.startsWith("fc") || host.startsWith("fd")) return false; // unique-local, fc00::/7
  return true;
}

/**
 * SSRF guard for a user-supplied webhook URL. https-only is enforced here
 * (stricter than `validatePublicUrl`, and correct for outbound webhooks
 * carrying a signature header). IP literals are handled here too, LOCALLY,
 * rather than delegated: `validatePublicUrl` rejects every IP literal
 * outright, which would silently narrow webhook policy (a bare public IP is
 * a legitimate destination). Everything else — `.internal`, single-label
 * intranet names, and other host-shape checks — delegates to
 * `validatePublicUrl` so that logic lives in one place instead of a second,
 * divergent copy (which is how every IPv6 branch here went dead before).
 */
export function isSafeWebhookUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;

  if (isIpLiteralHostname(u.hostname)) return isPublicIpLiteral(u.hostname);

  return validatePublicUrl(raw).ok;
}

const MAX_REDIRECTS = 5;

/**
 * POST a signed payload to a user-supplied webhook URL. Follows redirects
 * MANUALLY, re-running `isSafeWebhookUrl` on every hop (mirrors
 * `packages/scrapers/src/lib/guarded-fetch.ts`'s safeFetch): otherwise an
 * initially-public host could 3xx toward an internal address and the guard
 * would never run again on the new target. No DNS resolution here, so
 * DNS-rebinding stays an egress-level gap (documented, out of scope, same
 * position as safeFetch). Never throws — callers rely on a `false` return.
 */
export async function sendWebhook(
  url: string,
  secret: string | null,
  payload: unknown,
): Promise<boolean> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Outrival-Webhook/1",
  };
  if (secret) headers["X-Outrival-Signature"] = signBody(secret, body);
  try {
    let target = url;
    for (let hop = 0; ; hop++) {
      if (!isSafeWebhookUrl(target)) return false;
      const res = await fetch(target, {
        method: "POST",
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        if (hop >= MAX_REDIRECTS) return false;
        target = new URL(location, target).toString();
        continue;
      }
      return res.ok;
    }
  } catch {
    return false;
  }
}
