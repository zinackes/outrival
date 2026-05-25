const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export interface Competitor {
  id: string;
  name: string;
  url: string;
  description: string | null;
  createdAt: string;
}

export interface Monitor {
  id: string;
  competitorId: string;
  sourceType: string;
  frequency: string;
  lastRunAt: string | null;
}

export interface ChangeRow {
  id: string;
  diffText: string | null;
  detectedAt: string;
  monitorId: string;
  sourceType: string;
  competitorId: string;
  competitorName: string;
  competitorUrl: string;
}

export const api = {
  listCompetitors: () => request<{ competitors: Competitor[] }>("/api/competitors"),
  getCompetitor: (id: string) =>
    request<{ competitor: Competitor; monitors: Monitor[]; recentChanges: ChangeRow[] }>(
      `/api/competitors/${id}`,
    ),
  createCompetitor: (body: { name: string; url: string; description?: string }) =>
    request<{ competitor: Competitor; monitors: Monitor[] }>("/api/competitors", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteCompetitor: (id: string) =>
    request<{ ok: true }>(`/api/competitors/${id}`, { method: "DELETE" }),
  runMonitor: (id: string) =>
    request<{ runId: string; monitorId: string }>(`/api/monitors/${id}/run`, { method: "POST" }),
  listChanges: (params?: { limit?: number; competitorId?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.competitorId) q.set("competitorId", params.competitorId);
    const qs = q.toString();
    return request<{ changes: ChangeRow[] }>(`/api/changes${qs ? `?${qs}` : ""}`);
  },
};
