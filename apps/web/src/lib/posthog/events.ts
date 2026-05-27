import posthog from "posthog-js";

export function track(event: string, props?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  if (!posthog.__loaded || !posthog.has_opted_in_capturing()) return;
  posthog.capture(event, props);
}

export function identifyUser(userId: string, props?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  if (!posthog.__loaded || !posthog.has_opted_in_capturing()) return;
  posthog.identify(userId, props);
}

export function resetUser(): void {
  if (typeof window === "undefined") return;
  if (!posthog.__loaded) return;
  posthog.reset();
}
