"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, X } from "lucide-react";
import { api } from "@/lib/api";

const POLL_MS = 60_000;
const DISMISS_KEY = "outrival.ai-status-dismissed";

/**
 * Dashboard banner shown when AI generations are currently failing (Groq rate
 * limits etc.) so insights/summaries silently stop refreshing. Persists across
 * refresh and navigation (it lives in the dashboard layout and re-checks the
 * server on every load). The close button stores the incident key (`since`) in
 * localStorage, so dismissing hides this streak but a fresh failure re-shows it.
 */
export function AiStatusBanner() {
  // Polled via useQuery; an auth blip / API error just leaves data undefined → the
  // banner stays hidden (since is null).
  const statusQ = useQuery({
    queryKey: ["aiStatus"],
    queryFn: () => api.getAiStatus(),
    refetchInterval: POLL_MS,
  });
  const data = statusQ.data;
  const since = data?.degraded ? data.since : null;
  const down = data?.status === "down";
  const recovery = data?.estimatedRecovery ?? null;
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY));
  }, []);

  const dismiss = useCallback(() => {
    if (!since) return;
    localStorage.setItem(DISMISS_KEY, since);
    setDismissed(since);
  }, [since]);

  if (!since || since === dismissed) return null;

  // "down" = circuit breaker open (all providers unavailable); "delayed" = rate-limited
  // but the pool is still serving. Scrapes keep running either way (patch-22).
  const recoveryText =
    recovery && Number.isFinite(Date.parse(recovery))
      ? ` Service should resume around ${new Date(recovery).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}.`
      : "";

  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg border border-critical/25 bg-critical/8 px-4 py-3">
      <AlertTriangle size={16} className="text-critical shrink-0" />
      <p className="flex-1 text-sm text-foreground">
        {down
          ? `AI is temporarily unavailable — all providers are catching up. Monitoring continues; new insights are paused and will resume automatically.${recoveryText}`
          : "AI insights are delayed — the model is rate-limited right now. Summaries and signals will catch up automatically once it clears."}
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-critical/15 hover:text-foreground"
      >
        <X size={16} />
      </button>
    </div>
  );
}
