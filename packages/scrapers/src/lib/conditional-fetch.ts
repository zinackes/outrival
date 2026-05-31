export interface ConditionalFetchResult {
  status: number;
  etag?: string;
  lastModified?: string;
  notModified: boolean;
}

/**
 * Cheap pre-flight before a full scrape: a conditional GET that returns 304 when
 * the resource is unchanged, letting the caller skip the whole scrape. On a 200
 * we cancel the body (no download) and return the fresh validators. Fail-open:
 * any network error / timeout returns notModified=false so the caller always
 * falls through to a real scrape — we never skip on uncertainty.
 *
 * Native fetch only (no crawlee import) so importing this never pulls Chromium.
 */
export async function conditionalFetch(
  url: string,
  prevEtag?: string | null,
  prevLastModified?: string | null,
): Promise<ConditionalFetchResult> {
  const headers: Record<string, string> = {
    "User-Agent": "OutrivalBot/1.0 (+https://outrival.io/bot)",
    Accept: "text/html,application/xhtml+xml",
  };
  if (prevEtag) headers["If-None-Match"] = prevEtag;
  if (prevLastModified) headers["If-Modified-Since"] = prevLastModified;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });

    // We only need the status + validators, never the body.
    await res.body?.cancel();

    if (res.status === 304) {
      return { status: 304, notModified: true };
    }
    return {
      status: res.status,
      etag: res.headers.get("etag") ?? undefined,
      lastModified: res.headers.get("last-modified") ?? undefined,
      notModified: false,
    };
  } catch {
    return { status: 0, notModified: false };
  }
}
