"use client";

import { useEffect } from "react";
import { schedulePosthogLoad } from "./lazy";

// Schedules the analytics SDK for after first paint, and only for a visitor whose
// consent allows it to send anything. No longer a context provider:
// `posthog-js/react`'s provider needed the SDK instance at render time, which is
// what forced it into the first-load JS of every page (this component lives in the
// root layout). The one hook that used the React context, a feature-flag read on the
// onboarding form, now reads the flag off the lazily-loaded client.
//
// A visitor who grants consent later in the session does not need this effect to
// re-run: `applyConsent` loads the SDK on the spot.
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => schedulePosthogLoad(), []);
  return <>{children}</>;
}
