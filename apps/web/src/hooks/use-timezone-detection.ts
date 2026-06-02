"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";

// Patch-26: detect the browser timezone (Intl) once per session and sync it to
// the org's notification preferences — UNLESS the user set it manually, in which
// case timezoneDetectedAt is null and we must never overwrite their choice.
// Best-effort: any failure is swallowed and the stored timezone (default UTC)
// stays in place.
export function useTimezoneDetection() {
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (!timezone) return;

        const { preferences } = await api.getNotificationPreferences();
        if (cancelled) return;

        // Manual override locked → leave it.
        if (preferences.timezone && preferences.timezoneDetectedAt === null) return;
        // Already in sync → nothing to do.
        if (preferences.timezone === timezone) return;

        await api.updateNotificationPreferences({
          timezone,
          timezoneDetectedAt: new Date().toISOString(),
        });
      } catch {
        // Silent — keep the stored timezone.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);
}
