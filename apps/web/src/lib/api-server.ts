import { cookies } from "next/headers";
import type { Signal, Competitor } from "./api";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// Server-side GET that forwards the caller's session cookie to the API.
// CORS doesn't apply server-to-server, so the only thing the API needs is the
// auth cookie — which lives on `.outrival.app` and reaches this web server too.
async function serverGet<T>(path: string): Promise<T> {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${BASE}${path}`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`server API ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * Prefetch the dashboard overview data on the server so it lands in the first
 * paint instead of after JS hydration + a browser round-trip.
 *
 * Best-effort by design: any failure (cookie missing, API down, hairpin
 * blocked) returns null and OverviewView falls back to its own client fetch.
 * The page is therefore never slower than before — only faster when this hits.
 */
export async function getOverviewData(): Promise<{
  signals: Signal[];
  competitors: Competitor[];
} | null> {
  try {
    const [s, c] = await Promise.all([
      serverGet<{ signals: Signal[] }>("/api/signals?limit=200"),
      serverGet<{ competitors: Competitor[] }>("/api/competitors"),
    ]);
    return { signals: s.signals, competitors: c.competitors };
  } catch {
    return null;
  }
}

/**
 * Prefetch the signals feed. The page passes the URL's product/sort so the seed
 * matches what SignalsView would fetch on mount (other filters are client-side).
 * Best-effort: null → SignalsView falls back to its own client fetch.
 */
export async function getSignalsData(params: {
  productId?: string;
  sort?: "threat" | "recent";
}): Promise<Signal[] | null> {
  const q = new URLSearchParams({ limit: "200", sort: params.sort ?? "threat" });
  if (params.productId) q.set("productId", params.productId);
  try {
    const r = await serverGet<{ signals: Signal[] }>(`/api/signals?${q.toString()}`);
    return r.signals;
  } catch {
    return null;
  }
}
