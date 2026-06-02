"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type OnboardingSession, type OnboardingSessionPatch } from "@/lib/api";

// Patch-25: owns the resumable onboarding session for the wizard. Loads the
// user's active session on mount (or creates one), and exposes an optimistic
// `updateSession` that merges timings rather than replacing them. Best-effort:
// if the API is unreachable, tracking/resume degrade silently and the wizard
// still works off its existing org-level resume.
export function useOnboardingSession() {
  const [session, setSession] = useState<OnboardingSession | null>(null);
  const idRef = useRef<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let active = true;
    void (async () => {
      try {
        const { session: existing } = await api.getOnboardingSession();
        if (!active) return;
        if (existing) {
          idRef.current = existing.id;
          setSession(existing);
          return;
        }
        const { session: created } = await api.createOnboardingSession();
        if (!active) return;
        idRef.current = created.id;
        setSession(created);
      } catch {
        // ignore — non-critical
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const updateSession = useCallback(async (patch: OnboardingSessionPatch) => {
    setSession((s) =>
      s
        ? {
            ...s,
            ...patch,
            timings: patch.timings ? { ...s.timings, ...patch.timings } : s.timings,
          }
        : s,
    );
    const id = idRef.current;
    if (!id) return;
    try {
      const { session: updated } = await api.patchOnboardingSession(id, patch);
      setSession(updated);
    } catch {
      // ignore — non-critical
    }
  }, []);

  return { session, sessionId: session?.id ?? null, updateSession };
}
