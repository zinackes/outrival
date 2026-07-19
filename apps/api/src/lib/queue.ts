import { startQueue, getBoss } from "@outrival/queue";
import { logger } from "@outrival/shared";

// pg-boss access for the API — SEND-ONLY. The API enqueues jobs; it must never
// execute a handler nor own the cron scheduler (that is the light worker's job),
// so the client starts with `supervise:false, schedule:false` and registers no
// work(). Replaces the old `lib/trigger.ts` re-export of the Trigger SDK.
//
// Started LAZILY on the first enqueue rather than at boot: the API serves auth,
// the dashboard and the public report routes, and none of that needs the queue.
// A queue outage must degrade the one route that enqueues, not the whole API.

let starting: Promise<unknown> | null = null;

/**
 * Ensure the send-only PgBoss client is connected. Idempotent and concurrency-safe:
 * every caller awaits the same in-flight start. Throws if QUEUE_DATABASE_URL is
 * unset or the queue Postgres is unreachable — callers surface that as a 503
 * rather than letting it bubble as a naked 500.
 */
export async function ensureQueue(): Promise<void> {
  if (!starting) {
    starting = startQueue({
      mode: "sender",
      schedule: false,
      supervise: false,
      reportError: (err, ctx) => logger.error({ err, job: ctx.job }, "queue client error"),
    }).catch((err) => {
      // Let the next enqueue retry instead of caching a failed connection forever.
      starting = null;
      throw err;
    });
  }
  await starting;
}

/**
 * Enqueue a job from a route handler. Returns the pg-boss job id, or null when the
 * send was deduplicated (a `singletonKey` collision — the equivalent of Trigger's
 * idempotencyKey). Routes that echo a `runId` back to the client pass that through
 * as-is: null means "already queued", not an error.
 */
/**
 * Enqueue by queue NAME rather than by typed definition. Only for the dev-only cron
 * console, which fires a job the operator picked from a list of ids — there is no
 * compile-time definition to reach for. Everything else must use `enqueueJob` so the
 * payload stays type-checked against the registry.
 */
export async function enqueueByName(name: string, data: object = {}): Promise<string | null> {
  await ensureQueue();
  return getBoss().send(name, data);
}

export async function enqueueJob<P extends object>(
  job: { enqueue: (data: P, options?: { singletonKey?: string }) => Promise<string | null> },
  data: P,
  options?: { singletonKey?: string },
): Promise<string | null> {
  await ensureQueue();
  return job.enqueue(data, options);
}
