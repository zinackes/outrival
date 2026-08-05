import { PgBoss } from "pg-boss";
import type { Job, Queue, QueueResult, SendOptions, WorkOptions } from "pg-boss";
import { logger, sendSlackMessage } from "@outrival/shared";

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

/**
 * App-supplied classifier: given a handler error, how many SECONDS to wait before
 * running this job again, or null to apply the queue's normal retry policy.
 *
 * It exists for one failure the retry policy is exactly wrong for. The queue
 * retries at 1s, backing off to at most 10s, which is right for a transient fault
 * and wrong for a rate limit: the free AI tiers answer a 429 asking for 18 to 60
 * seconds, so all three attempts land inside the window that is still throttled and
 * the job fails having burned two extra rounds of provider calls. Measured on prod
 * over 7 days: 333 extract_pricing AI calls for 184 pricing pages that changed.
 *
 * A function rather than an error class so this package stays decoupled from the AI
 * pool, the same way _reportError keeps it decoupled from Sentry (@outrival/queue
 * must not import @outrival/ai).
 */
type DeferralResolver = (err: unknown) => number | null;

let _boss: PgBoss | null = null;
let _reportError: ErrorReporter = () => {};
let _resolveDeferral: DeferralResolver = () => null;

/**
 * Reserved payload key counting how many times a job has been deferred. Carried in
 * the payload because a deferral re-SENDS the job, so pg-boss's own retry count
 * resets and cannot bound the loop. Stripped by jobData, so no handler ever sees it.
 */
const DEFERRAL_KEY = "__deferrals";

/** Deferrals a single job may accumulate before it goes back to the normal retry
 *  policy (and from there to the dead-letter queue). A bound, not a tuning knob:
 *  without it a permanently unavailable pool would reschedule a job forever, and a
 *  job that never fails is a job nobody is told about. */
const MAX_DEFERRALS = Number(process.env.QUEUE_MAX_DEFERRALS ?? 3);

function deferralCount(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  const n = (data as Record<string, unknown>)[DEFERRAL_KEY];
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

// pg-boss emits `error` per failed operation, so a queue-Postgres outage fires it
// on every poll of every worker. Unthrottled that is hundreds of Slack messages an
// hour — the alert becomes the outage. One message per window is enough to say
// "the queue is unhealthy"; the details are in Sentry via _reportError.
const SLACK_ERROR_THROTTLE_MS = 5 * 60_000;
let _lastSlackErrorAt = 0;

/**
 * Best-effort ops alert on a queue-level failure. Never awaited by the caller and
 * never throws: an alerting failure must not add a second fault to the first one.
 */
function alertQueueError(err: unknown): void {
  const webhook = process.env.OPS_SLACK_WEBHOOK_URL;
  if (!webhook) return;
  const now = Date.now();
  if (now - _lastSlackErrorAt < SLACK_ERROR_THROTTLE_MS) return;
  _lastSlackErrorAt = now;
  const message = err instanceof Error ? err.message : String(err);
  void sendSlackMessage(
    webhook,
    `:rotating_light: pg-boss queue error on \`${process.env.WORKER_ROLE ?? "api"}\`: ${message}`,
  );
}

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
  /** See DeferralResolver: reschedules a job instead of burning its retries on a
   *  fault that will still be there a second later. */
  deferralResolver?: DeferralResolver;
}): Promise<PgBoss> {
  if (_boss) return _boss;
  if (opts.reportError) _reportError = opts.reportError;
  if (opts.deferralResolver) _resolveDeferral = opts.deferralResolver;

  const isWorker = opts.mode === "worker";
  const boss = new PgBoss({
    connectionString: requireQueueUrl(),
    schema: "pgboss",
    // Pool dedicated to pg-boss (fetch + maintenance). The queue Postgres also
    // serves each worker's own app pool; 5 here keeps the total (~15 across the
    // fleet) far under the default max_connections=100, so no PgBouncer is needed
    // — and PgBouncer in transaction pooling would break LISTEN/NOTIFY anyway.
    max: 5,
    // Wake workers the moment a job is created instead of waiting out the poll.
    // Holds one dedicated session-pinned connection; falls back to polling with a
    // `warning` if the listener can't be established. NOT sufficient on its own:
    // each queue must also opt in via its `notify` option (see defineJob).
    useListenNotify: true,
    supervise: opts.supervise ?? isWorker,
    // Expired-job / retry sweep. Only runs where supervise is on (the light worker).
    superviseIntervalSeconds: 60,
    // queue_stats sampling. 120 over the default 60 halves the maintenance write
    // churn on a box whose whole job is to keep the job table small.
    monitorIntervalSeconds: 120,
    schedule: opts.schedule ?? isWorker,
    // Migration is advisory-locked in pg-boss, so it's safe on every worker —
    // whichever boots first on a fresh DB installs the schema.
    migrate: isWorker,
  });
  boss.on("error", (err) => {
    _reportError(err, { job: "pgboss", id: "internal" });
    alertQueueError(err);
  });

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

/**
 * Thrown by a handler for a failure that a retry cannot repair but that nobody may
 * silently forget (Véracité Intelligence v2 P3).
 *
 * The queue has two terminal outcomes and neither fits: a plain throw spends the
 * whole retry budget re-running something deterministic, and `NonRetriable`
 * completes the job — which is right for "the monitor was deleted" and wrong for
 * "this change never became a signal". This third outcome sends the job's ORIGINAL
 * payload to the dead-letter queue with a reason, so the work is replayable and the
 * failure is countable, then completes the job so no attempt is wasted.
 *
 * The payload lands verbatim, plus a `__dlq` envelope naming the queue it came from
 * and why — pg-boss's own dead-lettering carries neither, which is how 600 jobs
 * ended up in `outrival-dlq` with no way to tell what they were.
 */
export class DeadLetter extends Error {
  constructor(
    message: string,
    /** Short, queryable cause: "truncated_reply", "schema_drift"… */
    readonly reason: string,
  ) {
    super(message);
  }
}

/** What a dead-lettered job leaves on the job row it completed. */
export type DeadLetteredOutput = { deadLettered: true; reason: string; queue: string };

export function isDeadLetteredOutput(output: unknown): output is DeadLetteredOutput {
  return !!output && typeof output === "object" && (output as DeadLetteredOutput).deadLettered === true;
}

/** The envelope a hand-routed dead letter carries alongside the original payload. */
export interface DeadLetterEnvelope {
  __dlq: { queue: string; reason: string; jobId: string };
}

/**
 * What lands on the dead-letter queue: the job's payload UNCHANGED, plus where it
 * came from and why.
 *
 * The payload has to survive verbatim — that is what makes the work replayable, and
 * replayability is the whole guarantee: a change whose signal generation failed is
 * never marked done, so re-enqueuing this payload on `queue` recreates the signal.
 */
export function deadLetterPayload<P extends object>(
  queue: string,
  data: P,
  reason: string,
  jobId: string,
): P & DeadLetterEnvelope {
  return { ...data, __dlq: { queue, reason, jobId } };
}

export interface JobConfig {
  /** pg-boss retryLimit = number of RETRIES. Trigger maxAttempts N → retryLimit N-1. */
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  retryDelayMax?: number;
  /** was Trigger `maxDuration` (seconds). Job is retried/failed if it runs longer. */
  expireInSeconds?: number;
  /**
   * How long a COMPLETED job is kept before deletion. Set explicitly rather than
   * left to pg-boss's default (which happens to be the same 7 days today) because
   * this is the knob that bounds the job table's size, and a silent upstream
   * default change would show up as unexplained disk growth on the queue box.
   */
  deleteAfterSeconds?: number;
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
    deleteAfterSeconds: config.deleteAfterSeconds ?? 7 * 24 * 3600,
    // The per-queue half of LISTEN/NOTIFY. The instance-level `useListenNotify`
    // only starts the listener; without this flag the queue never emits the NOTIFY,
    // so workers would keep waiting out their polling interval and the whole
    // latency win of v12 would be silently inert. On for every queue: the cost is
    // one NOTIFY per job creation, the gain is sub-100ms pickup instead of seconds.
    notify: true,
    ...(config.deadLetter ? { deadLetter: config.deadLetter } : {}),
  };
  const workOptions: WorkOptions = {
    batchSize: 1, // one job per fetch; parallelism comes from localConcurrency
    // Turning `notify` on above silently moves a worker's polling backstop from
    // `pollingIntervalSeconds` (default 2) to `notifyPollingIntervalSeconds`
    // (default 30). That is right for live traffic — NOTIFY does the waking — but
    // wrong for a BACKLOG, where no new NOTIFY is coming: workers take what they
    // can hold, finish, then sleep out the backstop. The smoke test measures the
    // gap at 22 jobs/s versus 6,700, and our worst case is exactly a backlog —
    // schedule-scraping fans hundreds of monitors out on the hour.
    //
    // Pinned back to the pre-notify cadence so enabling NOTIFY is a pure gain:
    // instant pickup for live jobs, unchanged catch-up for a queue that is behind.
    // (burstWhenBatchFull is the documented cure but is ignored at batchSize 1.)
    notifyPollingIntervalSeconds: config.pollingIntervalSeconds ?? 2,
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

/**
 * v12: every queue must exist before send/work. Call once on the worker boot.
 *
 * `createQueue` is create-IF-NOT-EXISTS, so on any environment that already has the
 * queue it silently ignores the options passed to it. Editing a job's config in
 * jobs.ts was therefore inert everywhere it mattered: prod still runs
 * `scrape-monitor` at `expire_seconds` 300 against a registry that has said 900
 * since the run measured at 302.7s, and the queue rows are the ones pg-boss
 * actually enforces. The declared config drifting from the enforced one is the
 * worst shape for this to take — the file reads as the source of truth and is not.
 *
 * So reconcile after creating: `updateQueue` writes retry/expiry/retention/notify
 * onto the existing row, making jobs.ts the source of truth on every boot. `policy`
 * and `partition` are excluded because pg-boss refuses to change them after
 * creation (they decide the queue's table shape) — a policy change still needs the
 * queue dropped and recreated, deliberately.
 */
export async function registerQueues(): Promise<void> {
  const boss = getBoss();
  for (const def of registry) await boss.createQueue(def.name, def.queueOptions);

  // Read the queues back and repair only what actually drifted. Comparing first
  // rather than updating blindly is the point: the failure mode here is a config
  // that is silently not what the file says, so the repair has to SAY what it
  // repaired. A queue that was just created matches and logs nothing, which is why
  // a fresh environment stays quiet.
  let live: QueueResult[] = [];
  try {
    live = await boss.getQueues(registry.map((d) => d.name));
  } catch (err) {
    // Never block a worker boot on reconciliation: the queues exist either way,
    // they just keep whatever options they already had.
    logger.error({ err }, "queue option reconciliation skipped");
    return;
  }
  const byName = new Map(live.map((q) => [q.name, q as unknown as Record<string, unknown>]));

  for (const def of registry) {
    const current = byName.get(def.name);
    if (!current) continue;
    const { policy: _policy, ...desired } = def.queueOptions;
    const drift = Object.entries(desired).filter(([k, v]) => current[k] !== v);
    if (drift.length === 0) continue;
    await boss.updateQueue(def.name, desired);
    logger.warn(
      {
        queue: def.name,
        changed: Object.fromEntries(drift.map(([k, v]) => [k, { was: current[k], now: v }])),
      },
      "queue options reconciled from the job registry",
    );
  }
}

/**
 * pg-boss stores `null` as the payload of a job sent without data — which is EVERY
 * cron fire, since `syncSchedules()` calls `boss.schedule(name, cron)` with no data
 * argument. Handlers are typed `(data: P)` and `defineJob<Empty>` promises an
 * object, so that null reaches the body as a lie about its own type and blows up on
 * the first property access (it took out generate-daily-digest for a full day after
 * the cutover). Normalise at the boundary: the contract says "an object", so deliver
 * one. Exported for the unit test.
 */
export function jobData<P extends object>(data: P | null | undefined): P {
  if (!data) return {} as P;
  // The deferral counter is queue bookkeeping, not payload: a handler that saw it
  // could store or forward it. Returns the SAME object when there is nothing to
  // strip, which is every job that has never been deferred.
  if (!(DEFERRAL_KEY in data)) return data;
  const { [DEFERRAL_KEY]: _counter, ...rest } = data as Record<string, unknown>;
  return rest as P;
}

/**
 * What a NonRetriable abort leaves behind on the job row. pg-boss stores whatever
 * the work callback RETURNS as `job.output`, so this is the only trace an expected
 * terminal outcome gets — and the difference between "the job did nothing, for a
 * reason" and a job that reads as a plain success.
 */
export type AbortedOutput = { aborted: true; message: string };

export function isAbortedOutput(output: unknown): output is AbortedOutput {
  return !!output && typeof output === "object" && (output as AbortedOutput).aborted === true;
}

/** What a deferral leaves on the job row it replaced, so "rescheduled because the
 *  AI pool was throttled" is queryable and never reads as a plain success. */
export type DeferredOutput = { deferred: true; seconds: number; attempt: number; reason: string };

export function isDeferredOutput(output: unknown): output is DeferredOutput {
  return !!output && typeof output === "object" && (output as DeferredOutput).deferred === true;
}

/**
 * Register a worker handler for a job. Adapts pg-boss's `(Job[]) => Promise`
 * batch signature to a single-job handler, routes NonRetriable to a clean
 * completion, and reports every other throw to Sentry before letting pg-boss
 * apply the retry policy.
 *
 * The handler's return value is passed back to pg-boss, which persists it as the
 * job's `output` (single-job fetches only — the whole fleet runs batchSize 1).
 * Dropping it, as this used to, made every NonRetriable abort indistinguishable
 * from a success: a battle card that aborted on a truncated model reply sat in
 * `pgboss.job` as `completed` with a null output, so nothing downstream — not the
 * UI, not a post-mortem query — could tell it had produced nothing.
 */
export function work<P extends object>(
  def: JobDef<P>,
  handler: (data: P, job: Job<P>) => Promise<unknown>,
  overrideOptions?: WorkOptions,
): Promise<string> {
  const options = { ...def.workOptions, ...overrideOptions };
  return getBoss().work<P>(def.name, options, async (jobs) => {
    let last: unknown;
    for (const job of jobs) {
      try {
        last = await handler(jobData(job.data), job);
      } catch (err) {
        if (err instanceof NonRetriable) {
          // Terminal + expected → complete the job, but say so in the output.
          last = { aborted: true, message: err.message } satisfies AbortedOutput;
          continue;
        }
        if (err instanceof DeadLetter) {
          // Terminal + WRONG → park the work where it can be found and replayed,
          // then complete: retrying a deterministic failure only spends the budget.
          // With no dead-letter queue configured there is nowhere safe to park it,
          // so it falls through to the normal retry policy rather than vanishing.
          const dlq = def.queueOptions.deadLetter;
          if (dlq) {
            const payload = deadLetterPayload(def.name, jobData(job.data), err.reason, job.id);
            await getBoss().send(dlq, payload, {});
            console.error(`[queue] ${def.name} dead-lettered (${err.reason}): ${err.message}`);
            last = {
              deadLettered: true,
              reason: err.reason,
              queue: def.name,
            } satisfies DeadLetteredOutput;
            continue;
          }
        }
        // A fault that will still be there a second from now (the AI pool being
        // rate-limited) is rescheduled rather than retried, because the queue's
        // 1s-to-10s backoff spends every attempt inside the window that is still
        // throttled. Bounded by MAX_DEFERRALS so an outage cannot reschedule a job
        // forever: past it the error falls through to the normal retry policy, and
        // from there to the dead-letter queue, where someone finds out.
        const deferSeconds = _resolveDeferral(err);
        const deferred = deferralCount(job.data);
        if (deferSeconds !== null && deferred < MAX_DEFERRALS) {
          const payload = { ...jobData(job.data), [DEFERRAL_KEY]: deferred + 1 } as P;
          // The work() fetch returns a plain Job, which carries neither priority nor
          // singletonKey; both live on JobWithMetadata. Read them here rather than
          // turning includeMetadata on fleet-wide, so the extra query is paid only
          // when a job is actually deferred and every normal fetch is untouched.
          // Losing them would matter: a user-priority scrape must not come back as
          // background work, and a job enqueued under a singleton key must not
          // reappear as a second copy of itself.
          const meta = await getBoss()
            .getJobById<P>(def.name, job.id)
            .catch(() => null);
          await getBoss().send(def.name, payload, {
            startAfter: deferSeconds,
            ...(meta?.priority ? { priority: meta.priority } : {}),
            ...(meta?.singletonKey ? { singletonKey: meta.singletonKey } : {}),
          });
          last = {
            deferred: true,
            seconds: deferSeconds,
            attempt: deferred + 1,
            reason: err instanceof Error ? err.message : String(err),
          } satisfies DeferredOutput;
          continue;
        }
        _reportError(err, { job: def.name, id: job.id });
        throw err; // pg-boss retries per the queue policy
      }
    }
    return last;
  });
}
