import { getBoss } from "@outrival/queue";
import { logger } from "@outrival/shared";
import { ensureQueue } from "./queue";

// Read-only views over the pg-boss schema for /admin — the replacement for the
// Trigger.dev runs/queues/schedules API the dashboard used to call.
//
// Best-effort by design, exactly like lib/analytics-safe.ts: the queue Postgres is
// a separate box from the relational DB, and an /admin page must degrade to
// "unavailable" instead of 500-ing when it is down. Every reader returns a null /
// empty result on failure and logs.
//
// pg-boss partitions its job table per queue; `pgboss.job` is the parent, so a
// cross-queue read works as a plain SELECT.

/** Rough Trigger-status parity for the existing /admin filters. pg-boss states are
 * created | active | completed | cancelled | failed. */
export const FAILED_STATES = ["failed"] as const;

export type QueueRow = {
  name: string;
  queued: number;
  running: number;
  failed: number;
  deferred: number;
};

export type JobRow = {
  id: string;
  taskIdentifier: string; // queue name — kept under the old key so /admin's filters work
  status: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  retryCount: number;
};

async function sql<T>(text: string, values: unknown[] = []): Promise<T[] | null> {
  try {
    await ensureQueue();
    const res = await getBoss().getDb().executeSql(text, values);
    return res.rows as T[];
  } catch (err) {
    logger.error({ err }, "pgboss admin query failed");
    return null;
  }
}

/** Per-queue backlog. One round-trip: getQueues() already carries the counters. */
export async function getQueueRows(): Promise<QueueRow[] | null> {
  try {
    await ensureQueue();
    const queues = await getBoss().getQueues();
    return queues
      .map((q) => ({
        name: q.name,
        queued: q.readyCount,
        running: q.activeCount,
        failed: q.failedCount,
        deferred: q.deferredCount,
      }))
      .sort((a, b) => b.queued - a.queued || b.running - a.running);
  } catch (err) {
    logger.error({ err }, "pgboss getQueues failed");
    return null;
  }
}

/** Recent failures across every queue, newest first. */
export async function getRecentFailures(limit = 25): Promise<(JobRow & { error: string | null })[] | null> {
  return sql(
    `select id::text,
            name as "taskIdentifier",
            state as status,
            created_on as "createdAt",
            started_on as "startedAt",
            completed_on as "finishedAt",
            extract(milliseconds from (completed_on - started_on))::int as "durationMs",
            retry_count as "retryCount",
            coalesce(output->>'message', output->>'value', output::text) as error
       from pgboss.job
      where state = 'failed'
        and created_on > now() - interval '24 hours'
      order by created_on desc
      limit $1`,
    [limit],
  );
}

/** Completed-job duration sample — the throughput signal the /admin header shows. */
export async function getThroughput(
  sampleSize = 200,
): Promise<{ avgDurationMs: number | null; sampled: number } | null> {
  const rows = await sql<{ ms: number }>(
    `select extract(milliseconds from (completed_on - started_on))::int as ms
       from pgboss.job
      where state = 'completed'
        and started_on is not null
        and completed_on > now() - interval '24 hours'
      order by completed_on desc
      limit $1`,
    [sampleSize],
  );
  if (!rows) return null;
  const durations = rows.map((r) => r.ms).filter((ms) => ms > 0);
  return {
    avgDurationMs: durations.length
      ? Math.round(durations.reduce((n, d) => n + d, 0) / durations.length)
      : null,
    sampled: durations.length,
  };
}

/**
 * Registered crons + when each last actually fired. pg-boss stores no "next run",
 * so last-fired is the health signal: a schedule whose queue has produced nothing
 * for far longer than its period means the scheduler stalled — the same thing the
 * old `overdue` flag was watching for.
 */
export async function getScheduleRows(): Promise<
  { name: string; cron: string; timezone: string; lastFiredAt: string | null }[] | null
> {
  try {
    await ensureQueue();
    const schedules = await getBoss().getSchedules();
    const lastFired = await sql<{ name: string; last: string }>(
      `select name, max(created_on) as last from pgboss.job group by name`,
    );
    const byName = new Map((lastFired ?? []).map((r) => [r.name, r.last]));
    return schedules
      .map((s) => ({
        name: s.name,
        cron: s.cron,
        timezone: s.timezone ?? "UTC",
        lastFiredAt: byName.get(s.name) ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    logger.error({ err }, "pgboss getSchedules failed");
    return null;
  }
}

/** Paginated job list for /admin/jobs, filterable by queue name and state. */
export async function listJobs(opts: {
  name?: string;
  states?: string[];
  before?: string;
  limit?: number;
}): Promise<JobRow[] | null> {
  const limit = opts.limit ?? 25;
  return sql(
    `select id::text,
            name as "taskIdentifier",
            state as status,
            created_on as "createdAt",
            started_on as "startedAt",
            completed_on as "finishedAt",
            extract(milliseconds from (completed_on - started_on))::int as "durationMs",
            retry_count as "retryCount"
       from pgboss.job
      where ($1::text is null or name = $1)
        and ($2::text[] is null or state::text = any($2))
        and ($3::timestamptz is null or created_on < $3)
      order by created_on desc
      limit $4`,
    [opts.name ?? null, opts.states?.length ? opts.states : null, opts.before ?? null, limit],
  );
}

/** One job with its payload and error output — the /admin/jobs/:id detail view. */
export async function getJob(
  id: string,
): Promise<(JobRow & { payload: unknown; error: string | null; retryLimit: number }) | null> {
  const rows = await sql<JobRow & { payload: unknown; error: string | null; retryLimit: number }>(
    `select id::text,
            name as "taskIdentifier",
            state as status,
            created_on as "createdAt",
            started_on as "startedAt",
            completed_on as "finishedAt",
            extract(milliseconds from (completed_on - started_on))::int as "durationMs",
            retry_count as "retryCount",
            retry_limit as "retryLimit",
            data as payload,
            coalesce(output->>'message', output->>'value', output::text) as error
       from pgboss.job
      where id = $1::uuid
      limit 1`,
    [id],
  );
  return rows?.[0] ?? null;
}

/** Contents of the shared dead-letter queue — jobs that exhausted their retries. */
export async function listDeadLetter(limit = 50): Promise<
  (JobRow & { sourceQueue: string | null; payload: unknown })[] | null
> {
  return sql(
    `select id::text,
            name as "taskIdentifier",
            state as status,
            created_on as "createdAt",
            started_on as "startedAt",
            completed_on as "finishedAt",
            extract(milliseconds from (completed_on - started_on))::int as "durationMs",
            retry_count as "retryCount",
            source_name as "sourceQueue",
            data as payload
       from pgboss.job
      where name = 'outrival-dlq'
      order by created_on desc
      limit $1`,
    [limit],
  );
}

/** Move dead-lettered jobs back onto their original queues. Returns how many moved. */
export async function redriveDeadLetter(limit = 100): Promise<number | null> {
  try {
    await ensureQueue();
    return await getBoss().redrive("outrival-dlq", { limit });
  } catch (err) {
    logger.error({ err }, "pgboss redrive failed");
    return null;
  }
}
