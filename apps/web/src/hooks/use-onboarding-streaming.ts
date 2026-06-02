"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
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
// `onTick` lets the host refresh its own data each poll so the page fills in.
export function useOnboardingStreaming(onTick?: () => void): OnboardingStreamingState {
  const [state, setState] = useState<OnboardingStreamingState>({
    active: false,
    total: 0,
    analyzed: 0,
    competitors: [],
  });
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    let live = true;
    let interval: ReturnType<typeof setInterval> | null = null;
    let safety: ReturnType<typeof setTimeout> | null = null;
    let sessionId: string | null = null;
    let firstSignalFired = false;
    let completedFired = false;

    const stop = () => {
      if (interval) clearInterval(interval);
      if (safety) clearTimeout(safety);
      interval = null;
      safety = null;
    };

    const poll = async () => {
      try {
        const { competitors } = await api.listCompetitors();
        if (!live) return;
        onTickRef.current?.();
        const rows: AnalysisCompetitor[] = competitors.map((c) => ({
          id: c.id,
          name: c.name,
          ready: c.aiSummary != null,
        }));
        const analyzed = rows.filter((r) => r.ready).length;
        const total = rows.length;
        setState({ active: true, total, analyzed, competitors: rows });

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
