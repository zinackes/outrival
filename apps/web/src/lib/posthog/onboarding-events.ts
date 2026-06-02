import { track } from "./events";

// Patch-25: the onboarding funnel events. One stable `onboarding_session_id`
// (the onboarding_sessions row id) threads every step so durations and drop-off
// can be reconstructed for real users — not just the creator testing locally.
export const ONBOARDING_EVENTS = {
  STARTED: "onboarding_started",
  PRODUCT_URL_SUBMITTED: "onboarding_product_url_submitted",
  PRODUCT_ANALYZED: "onboarding_product_analyzed",
  PRODUCT_PROFILE_CONFIRMED: "onboarding_product_profile_confirmed",
  DISCOVERY_STARTED: "onboarding_discovery_started",
  DISCOVERY_COMPLETED: "onboarding_discovery_completed",
  COMPETITOR_ADDED: "onboarding_competitor_added",
  COMPETITORS_FINALIZED: "onboarding_competitors_finalized",
  REDIRECT_TO_DASHBOARD: "onboarding_redirect_to_dashboard",
  FIRST_SIGNAL_RECEIVED: "onboarding_first_signal_received",
  ANALYSIS_COMPLETED: "onboarding_analysis_completed",
} as const;

export type OnboardingEvent = (typeof ONBOARDING_EVENTS)[keyof typeof ONBOARDING_EVENTS];

// Milestone key persisted on onboarding_sessions.timings — the event name minus
// the "onboarding_" prefix. Keeps the PostHog funnel and the Postgres metrics
// (admin dashboard) on the same vocabulary.
export function milestoneKey(event: OnboardingEvent): string {
  return event.replace(/^onboarding_/, "");
}

// Consent-gated (track() no-ops unless the user opted in — patch-03). Always
// carries the session id + a client timestamp.
export function trackOnboarding(
  event: OnboardingEvent,
  sessionId: string | null,
  props: Record<string, unknown> = {},
): void {
  track(event, {
    ...props,
    onboarding_session_id: sessionId,
    timestamp_ms: Date.now(),
  });
}
