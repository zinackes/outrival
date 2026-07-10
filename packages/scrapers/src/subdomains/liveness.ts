/**
 * "Is this subdomain actually live?" — a host in an old cert that no longer
 * resolves (or resolves but serves nothing) is not an expansion signal. We keep
 * only hosts that BOTH resolve in DNS AND answer an HTTP request. The default
 * probe uses node:dns + the SSRF-safe fetch; tests inject a fake probe. Bounded
 * concurrency keeps a large competitor's candidate list from hammering DNS.
 */
import { promises as dns } from "node:dns";
import { safeFetch } from "../lib/guarded-fetch";

/** Probe a single host — true iff it resolves and responds. */
export type LivenessProbe = (host: string) => Promise<boolean>;

async function defaultProbe(host: string): Promise<boolean> {
  // DNS first: cheap, and a NXDOMAIN short-circuits the HTTP attempt. safeFetch
  // does no DNS resolution of its own, so a public-looking host that resolves to
  // a private IP would otherwise slip past — dns.lookup surfaces the real address.
  let address: string;
  try {
    const r = await Promise.race([
      dns.lookup(host),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("dns_timeout")), 3000)),
    ]);
    address = r.address;
  } catch {
    return false;
  }
  if (isPrivateAddress(address)) return false; // internal-only host ⇒ not a public surface

  // A HEAD to https:// — any response (even 4xx) proves something is served.
  // safeFetch re-validates each redirect hop against the SSRF guard.
  try {
    const res = await safeFetch(`https://${host}/`, { method: "HEAD", timeoutMs: 5000 });
    return res.status < 500;
  } catch {
    return false;
  }
}

/** Coarse private / loopback / link-local IPv4 + IPv6 check. */
function isPrivateAddress(ip: string): boolean {
  if (ip.includes(":")) {
    // IPv6: loopback, unique-local (fc00::/7), link-local (fe80::/10).
    const l = ip.toLowerCase();
    return l === "::1" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe8") ||
      l.startsWith("fe9") || l.startsWith("fea") || l.startsWith("feb");
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return true;
  const [a, b] = p as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  return false;
}

/**
 * Keep only the live hosts, probing at most `concurrency` at a time. Order of the
 * returned list is unspecified (the caller sorts for the deterministic snapshot).
 */
export async function filterLive(
  hosts: string[],
  opts: { probe?: LivenessProbe; concurrency?: number } = {},
): Promise<string[]> {
  const { probe = defaultProbe, concurrency = 10 } = opts;
  const live: string[] = [];
  for (let i = 0; i < hosts.length; i += concurrency) {
    const batch = hosts.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (h) => ((await probe(h).catch(() => false)) ? h : null)),
    );
    for (const h of results) if (h) live.push(h);
  }
  return live;
}
