"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, X } from "lucide-react";
import { aiStatusQuery } from "@/lib/queries";
import { formatTime } from "@/lib/format-date";

const POLL_MS = 60_000;
const DISMISS_KEY = "outrival.ai-status-dismissed";

/**
 * Dashboard banner shown when AI generations are currently failing (Groq rate
 * limits etc.) so insights/summaries silently stop refreshing. Persists across
 * refresh and navigation (it lives in the dashboard layout and re-checks the
 * server on every load).
 *
 * Dismiss is edge-triggered: closing hides the *current* incident, and a later
 * `healthy` poll clears the flag so only a genuinely *new* incident re-shows. This
 * replaces keying dismiss on the server's `since` value, which drifted between polls
 * (the breaker ETA is recomputed from wall-clock; a fresh failure advances the error
 * timestamp) and so re-showed a banner the user had just closed.
 */
export function AiStatusBanner() {
  // Polled via useQuery; an auth blip / API error just leaves data undefined → the
  // banner stays hidden (degraded is false).
  const statusQ = useQuery({ ...aiStatusQuery(), refetchInterval: POLL_MS });
  const data = statusQ.data;
  const degraded = Boolean(data?.degraded);
  const down = data?.status === "down";
  const recovery = data?.estimatedRecovery ?? null;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  // When the server reports the incident is over, forget the dismissal so the next
  // incident surfaces again. Only acts on a resolved poll (data present + not degraded)
  // — an undefined poll (auth blip / cold API) leaves the flag untouched.
  useEffect(() => {
    if (data && !degraded && localStorage.getItem(DISMISS_KEY)) {
      localStorage.removeItem(DISMISS_KEY);
      setDismissed(false);
    }
  }, [data, degraded]);

  const dismiss = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }, []);

  if (!degraded || dismissed) return null;

  // "down" = circuit breaker open (all providers unavailable); "delayed" = rate-limited
  // but the pool is still serving. Scrapes keep running either way (patch-22).
  const recoveryText =
    recovery && Number.isFinite(Date.parse(recovery))
      ? ` Service should resume around ${formatTime(recovery, {
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
