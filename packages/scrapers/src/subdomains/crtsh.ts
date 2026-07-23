/**
 * crt.sh Certificate Transparency client. Fixed, trusted host (not competitor-
 * controlled), so a plain fetch — mirroring the news scraper's Google-News fetch.
 * crt.sh routinely 502s under load, so we retry with backoff and NEVER put it on
 * a scan's critical path: this source is its own daily monitor, isolated from the
 * homepage/pricing scans by construction.
 */

export interface CrtShEntry {
  common_name?: string;
  /** Newline-separated SAN list — the richest source of hostnames. */
  name_value?: string;
  not_before?: string;
  serial_number?: string;
}

export interface CrtShOptions {
  /** Injectable for tests — defaults to global fetch. */
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
}

const BASE = "https://crt.sh";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch every logged certificate whose names match `%.{domain}` as JSON. Retries
 * transient failures (5xx / network / abort) with exponential backoff. Throws
 * after the last attempt, or when crt.sh returns a non-array payload — the
 * scraper turns that throw into a Trigger retry rather than an empty snapshot.
 */
export async function fetchCrtSh(domain: string, opts: CrtShOptions = {}): Promise<CrtShEntry[]> {
  const { fetchFn = fetch, timeoutMs = 20_000, retries = 4 } = opts;
  const url = `${BASE}/?q=${encodeURIComponent(`%.${domain}`)}&output=json`;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Exponential backoff with full jitter. crt.sh 502s/429s cluster under load, so a
    // fixed schedule makes every retry land in the same congested window; the random
    // spread (1-2s, 2-4s, 4-8s, 8-16s) both waits longer and de-synchronises retries.
    if (attempt > 0) await delay(1000 * 2 ** (attempt - 1) * (1 + Math.random()));
    try {
      const res = await fetchFn(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "user-agent": "OutrivalBot/1.0 (competitive monitoring; +https://outrival.io)",
          accept: "application/json",
        },
      });
      if (!res.ok) {
        lastErr = new Error(`crt.sh HTTP ${res.status}`);
        if (res.status >= 500 || res.status === 429) continue; // transient → retry
        throw lastErr; // 4xx (bad query) → not retriable
      }
      const parsed: unknown = await res.json();
      if (!Array.isArray(parsed)) throw new Error("crt.sh: non-array payload");
      return parsed as CrtShEntry[];
    } catch (e) {
      lastErr = e;
      // Timeout / network reset / transient parse — fall through to retry.
    }
  }
  throw new Error(`crt.sh: failed after ${retries + 1} attempts (${String(lastErr)})`);
}
