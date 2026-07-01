import { PgBoss } from "pg-boss";
import type { Job, Queue, SendOptions, WorkOptions } from "pg-boss";

// ---------------------------------------------------------------------------
// @outrival/queue — pg-boss v12 foundation shared by @outrival/api (send-only)
// and @outrival/workers (send + work). Replaces the Trigger.dev SDK.
//
// The queue lives on a DEDICATED always-on Postgres (`QUEUE_DATABASE_URL`), NOT
// Neon: a sub-2s poller defeats Neon's scale-to-zero and bills compute-hours.
// `boss.start()` auto-creates its `pgboss` schema there; it never touches the
// relational DB.
// ---------------------------------------------------------------------------

export type QueueMode = "worker" | "sender";

/** App-supplied error reporter (Sentry) for handler exceptions. Keeps this lib
 * decoupled from any monitoring vendor. */
type ErrorReporter = (err: unknown, ctx: { job: string; id: string }) => void;

let _boss: PgBoss | null = null;
let _reportError: ErrorReporter = () => {};

function requireQueueUrl(): string {
  const url = process.env.QUEUE_DATABASE_URL;
  if (!url) {
    throw new Error(
      "QUEUE_DATABASE_URL is not set — the pg-boss queue needs a dedicated always-on Postgres (never Neon).",
    );
  }
  return url;
}

/**
 * Create + start the shared PgBoss instance for this process.
 * - `worker`: runs the supervisor, cron scheduler, and schema migration.
 * - `sender`: send/insert only (API) — no supervisor, no cron, no migration.
 * With several worker processes (browser + light), exactly ONE should own
 * cron + maintenance — the others pass `schedule: false, supervise: false`.
 * Idempotent per process: a second call returns the already-started instance.
 */
export async function startQueue(opts: {
  mode: QueueMode;
  /** cron scheduler ownership (default: mode === "worker") */
  schedule?: boolean;
  /** maintenance/monitoring ownership (default: mode === "worker") */
  supervise?: boolean;
  reportError?: ErrorReporter;
}): Promise<PgBoss> {
  if (_boss) return _boss;
  if (opts.reportError) _reportError = opts.reportError;

  const isWorker = opts.mode === "worker";
  const boss = new PgBoss({
    connectionString: requireQueueUrl(),
    schema: "pgboss",
    supervise: opts.supervise ?? isWorker,
    schedule: opts.schedule ?? isWorker,
    // Migration is advisory-locked in pg-boss, so it's safe on every worker —
    // whichever boots first on a fresh DB installs the schema.
    migrate: isWorker,
  });
  boss.on("error", (err) => _reportError(err, { job: "pgboss", id: "internal" }));

  await boss.start();
  _boss = boss;
  return boss;
}

export function getBoss(): PgBoss {
  if (!_boss) throw new Error("Queue not started — call startQueue() first.");
  return _boss;
}

/** Graceful shutdown — wire to SIGTERM/SIGINT so a Coolify redeploy mid-job
 * drains in-flight handlers instead of leaving them stuck 'active'. */
export async function stopQueue(timeoutMs = 30_000): Promise<void> {
  if (!_boss) return;
  await _boss.stop({ graceful: true, close: true, timeout: timeoutMs });
  _boss = null;
}

// ---------------------------------------------------------------------------
// Typed job registry — restores Trigger's typed `tasks.trigger<T>()` ergonomics
// on top of pg-boss's stringly-typed send/insert.
// ---------------------------------------------------------------------------

/** Thrown by a handler to complete a job WITHOUT retrying (terminal, expected —
 * e.g. "monitor deleted"). Mirrors Trigger's AbortTaskRunError intent. */
export class NonRetriable extends Error {}

export interface JobConfig {
  /** pg-boss retryLimit = number of RETRIES. Trigger maxAttempts N → retryLimit N-1. */
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  retryDelayMax?: number;
  /** was Trigger `maxDuration` (seconds). Job is retried/failed if it runs longer. */
  expireInSeconds?: number;
  policy?: Queue["policy"];
  deadLetter?: string;
  /** rolling worker concurrency for this queue (was `queue({concurrencyLimit})`). */
  concurrency?: number;
  pollingIntervalSeconds?: number;
}

export interface JobDef<P extends object> {
  name: string;
  /** passed to boss.createQueue() at boot */
  queueOptions: Omit<Queue, "name">;
  /** passed to boss.work() by the worker process */
  workOptions: WorkOptions;
  /** enqueue one (was `tasks.trigger`) */
  enqueue: (data: P, options?: SendOptions) => Promise<string | null>;
  /** enqueue many in one round-trip (was `tasks.batchTrigger`) */
  enqueueMany: (
    rows: { data: P; options?: Omit<import("pg-boss").JobInsert, "data"> }[],
  ) => Promise<string[] | null>;
}

const registry: JobDef<never>[] = [];

export function defineJob<P extends object>(name: string, config: JobConfig = {}): JobDef<P> {
  const queueOptions: Omit<Queue, "name"> = {
    policy: config.policy ?? "standard",
    retryLimit: config.retryLimit ?? 2, // = Trigger maxAttempts 3
    retryDelay: config.retryDelay ?? 1,
    retryBackoff: config.retryBackoff ?? true,
    retryDelayMax: config.retryDelayMax ?? 10,
    expireInSeconds: config.expireInSeconds ?? 300,
    ...(config.deadLetter ? { deadLetter: config.deadLetter } : {}),
  };
  const workOptions: WorkOptions = {
    batchSize: 1, // one job per fetch; parallelism comes from localConcurrency
    ...(config.concurrency ? { localConcurrency: config.concurrency } : {}),
    ...(config.pollingIntervalSeconds ? { pollingIntervalSeconds: config.pollingIntervalSeconds } : {}),
  };

  const def: JobDef<P> = {
    name,
    queueOptions,
    workOptions,
    enqueue: (data, options) => getBoss().send(name, data, options ?? {}),
    enqueueMany: (rows) => getBoss().insert(name, rows.map((r) => ({ data: r.data, ...r.options }))),
  };
  registry.push(def as unknown as JobDef<never>);
  return def;
}

/** v12: every queue must exist before send/work. Call once on the worker boot. */
export async function registerQueues(): Promise<void> {
  const boss = getBoss();
  for (const def of registry) await boss.createQueue(def.name, def.queueOptions);
}

/**
 * Register a worker handler for a job. Adapts pg-boss's `(Job[]) => Promise`
 * batch signature to a single-job handler, routes NonRetriable to a clean
 * completion, and reports every other throw to Sentry before letting pg-boss
 * apply the retry policy.
 */
export function work<P extends object>(
  def: JobDef<P>,
  handler: (data: P, job: Job<P>) => Promise<unknown>,
  overrideOptions?: WorkOptions,
): Promise<string> {
  const options = { ...def.workOptions, ...overrideOptions };
  return getBoss().work<P>(def.name, options, async (jobs) => {
    for (const job of jobs) {
      try {
        await handler(job.data, job);
      } catch (err) {
        if (err instanceof NonRetriable) continue; // terminal + expected → complete
        _reportError(err, { job: def.name, id: job.id });
        throw err; // pg-boss retries per the queue policy
      }
    }
  });
}
