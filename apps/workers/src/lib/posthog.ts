import { PostHog } from "posthog-node";

let cached: PostHog | null = null;

function getClient(): PostHog | null {
  const key = process.env.POSTHOG_API_KEY;
  if (!key || key.includes("REPLACE_ME")) return null;
  if (cached) return cached;
  cached = new PostHog(key, {
    host: process.env.POSTHOG_HOST ?? "https://eu.i.posthog.com",
    flushAt: 1,
    flushInterval: 0,
  });
  return cached;
}

export async function captureWorkerEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  const ph = getClient();
  if (!ph) return;
  ph.capture({ distinctId, event, properties });
  await ph.flush();
}

export async function shutdownPostHog(): Promise<void> {
  if (!cached) return;
  await cached.shutdown();
  cached = null;
}
