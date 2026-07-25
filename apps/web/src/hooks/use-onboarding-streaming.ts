"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { competitorsQuery, overviewSignalsQuery } from "@/lib/queries";
import {
  ONBOARDING_EVENTS,
  milestoneKey,
  trackOnboarding,
} from "@/lib/posthog/onboarding-events";

const POLL_MS = 3000;
const SAFETY_MS = 10 * 60 * 1000;

export interface AnalysisCompetitor {
  id: string;
  name: string;
  ready: boolean;
}

export interface OnboardingStreamingState {
  active: boolean;
  total: number;
  analyzed: number;
  competitors: AnalysisCompetitor[];
}

// Patch-25: drives the dashboard progressive-streaming panel right after
// onboarding. While the user's session is analysis_in_progress, polls competitor
// analysis (aiSummary as the ready proxy — same one the notify job uses), fires
// first_signal_received / analysis_completed once, and closes the session.
//
// Reads the roster through the shared `competitorsQuery` TanStack cache (forced
// fresh via `staleTime: 0` on the fetch, since the app-wide default is 60s) —
// this is the ONLY competitors fetch per tick. The host's own
// `useQuery(competitorsQuery(productId))` observes the same cache key and
// re-renders as soon as this writes fresh data in, so no separate "please
// refetch competitors" callback is needed anymore. Signals are only
// `invalidateQueries`'d (lazy — the host's existing 60s refetchInterval or next
// mount picks it up) when the analyzed count actually moves, not on every 3s
// tick, so we stop hammering the ~100KB/200-row signals payload every 3s.
export function useOnboardingStreaming(productId?: string): OnboardingStreamingState {
  const [state, setState] = useState<OnboardingStreamingState>({
    active: false,
    total: 0,
    analyzed: 0,
    competitors: [],
  });
  const queryClient = useQueryClient();
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;
  const productIdRef = useRef(productId);
  productIdRef.current = productId;

  useEffect(() => {
    let live = true;
    let interval: ReturnType<typeof setInterval> | null = null;
    let safety: ReturnType<typeof setTimeout> | null = null;
    let sessionId: string | null = null;
    let firstSignalFired = false;
    let completedFired = false;
    let lastAnalyzed = 0;

    const stop = () => {
      if (interval) clearInterval(interval);
      if (safety) clearTimeout(safety);
      interval = null;
      safety = null;
    };

    const poll = async () => {
      // Tab-visibility gate: don't spend the poll (or the network fetch it
      // drives) while the tab is backgrounded.
      if (document.visibilityState === "hidden") return;
      try {
        const qc = queryClientRef.current;
        const pid = productIdRef.current;
        const competitors = await qc.fetchQuery({
          ...competitorsQuery(pid),
          staleTime: 0,
        });
        if (!live) return;
        const rows: AnalysisCompetitor[] = competitors.map((c) => ({
          id: c.id,
          name: c.name,
          ready: c.aiSummary != null,
        }));
        const analyzed = rows.filter((r) => r.ready).length;
        const total = rows.length;
        setState({ active: true, total, analyzed, competitors: rows });

        if (analyzed > lastAnalyzed) {
          lastAnalyzed = analyzed;
          void qc.invalidateQueries({
            queryKey: overviewSignalsQuery(pid).queryKey,
          });
        }

        if (analyzed >= 1 && !firstSignalFired) {
          firstSignalFired = true;
          trackOnboarding(ONBOARDING_EVENTS.FIRST_SIGNAL_RECEIVED, sessionId);
          if (sessionId) {
            void api.patchOnboardingSession(sessionId, {
              timings: { [milestoneKey(ONBOARDING_EVENTS.FIRST_SIGNAL_RECEIVED)]: Date.now() },
            });
          }
        }
        if (total > 0 && analyzed >= total && !completedFired) {
          completedFired = true;
          trackOnboarding(ONBOARDING_EVENTS.ANALYSIS_COMPLETED, sessionId);
          if (sessionId) void api.completeOnboardingSession(sessionId).catch(() => {});
          stop();
          setState((s) => ({ ...s, active: false }));
        }
      } catch {
        // ignore — informational
      }
    };

    void (async () => {
      try {
        const { session } = await api.getActiveAnalysisSession();
        if (!live) return;
        if (!session) {
          setState((s) => ({ ...s, active: false }));
          return;
        }
        sessionId = session.id;
        firstSignalFired = session.timings?.first_signal_received != null;
        completedFired = session.timings?.analysis_completed != null;
        await poll();
        if (!live || completedFired) return;
        interval = setInterval(() => void poll(), POLL_MS);
        safety = setTimeout(stop, SAFETY_MS);
      } catch {
        setState((s) => ({ ...s, active: false }));
      }
    })();

    return () => {
      live = false;
      stop();
    };
  }, []);

  return state;
}
