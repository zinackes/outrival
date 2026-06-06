import { promises as dns } from "node:dns";

/**
 * CNAME resolution (patch-31, detection signal 6). Best-effort and time-boxed:
 * a host with no CNAME (apex A-record), a DNS hiccup, or a slow resolver all
 * yield [] rather than throwing — detection is an optimisation, never a blocker.
 * Mainly catches hosting/CDN/status providers a CDN-masked page hides from headers.
 */
export async function resolveCnames(
  hostname: string | null | undefined,
  timeoutMs = 5000,
): Promise<string[]> {
  if (!hostname) return [];
  try {
    const records = await Promise.race([
      dns.resolveCname(hostname),
      new Promise<string[]>((resolve) => setTimeout(() => resolve([]), timeoutMs)),
    ]);
    return records.map((r) => r.toLowerCase());
  } catch {
    // ENODATA / ENOTFOUND / SERVFAIL — no usable CNAME.
    return [];
  }
}
