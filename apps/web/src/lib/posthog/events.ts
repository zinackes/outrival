import { withPosthog, posthogIfLoaded } from "./lazy";

// The consent gate is unchanged and still checked at call time: `withPosthog`
// loads the SDK if the idle callback has not fired yet, but an opted-out visitor
// still sends nothing. Previously these calls were dropped outright while the SDK
// was absent; now an early click is captured once it arrives, which is what the
// auth funnel needed.
export function track(event: string, props?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  withPosthog((p) => {
    if (p.has_opted_in_capturing()) p.capture(event, props);
  });
}

export function identifyUser(userId: string, props?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  withPosthog((p) => {
    if (p.has_opted_in_capturing()) p.identify(userId, props);
  });
}

// Sign-out. Never loads the SDK for this: with nothing loaded there is no identity
// to reset, and pulling a 60KB chunk to clear state that does not exist is absurd.
export function resetUser(): void {
  if (typeof window === "undefined") return;
  posthogIfLoaded()?.reset();
}
