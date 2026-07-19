/**
 * pg-boss smoke test — Phase 9 of the RS 1000 G12 runbook, run against the queue
 * box before the Trigger.dev cutover.
 *
 *   QUEUE_DATABASE_URL=postgres://... bun run scripts/pgboss-smoke.ts
 *
 * Answers two questions the cutover decision rests on:
 *
 *  1. Does LISTEN/NOTIFY actually work here? Measured as the delay between sending
 *     one job into an EMPTY queue and a worker picking it up. The worker is
 *     deliberately given a 30-second polling interval, so a fast pickup can only
 *     come from NOTIFY — if the listener silently fell back to polling (PgBouncer
 *     in transaction mode, a pooled connection, `notify` missing on the queue),
 *     this reads seconds instead of milliseconds. A green "it works" here is the
 *     whole reason the queue lives on its own direct-connection Postgres.
 *
 *  2. How fast does the box drain a backlog? Gives the margin against Trigger.dev.
 *
 * Uses the REAL startQueue() from @outrival/queue, so what it measures is the
 * shipped configuration and not a hand-rolled instance that happens to agree
 * with it today.
 */
// Relative, not "@outrival/queue": the root is not a workspace package and the
// monorepo rule keeps non-tooling dependencies out of the root manifest. Bun runs
// the TS source directly, and pg-boss resolves from packages/queue/node_modules.
import { startQueue, getBoss, stopQueue } from "../packages/queue/src/index";

const QUEUE = "smoke";
const TOTAL = Number(process.env.SMOKE_JOBS ?? 10_000);
const LATENCY_SAMPLES = Number(process.env.SMOKE_LATENCY_SAMPLES ?? 5);
const INSERT_CHUNK = 1_000;
const DRAIN_BATCH = Number(process.env.SMOKE_DRAIN_BATCH ?? 50);
const DRAIN_CONCURRENCY = Number(process.env.SMOKE_DRAIN_CONCURRENCY ?? 10);
const DRAIN_POLL_SECONDS = Number(process.env.SMOKE_DRAIN_POLL_SECONDS ?? 1);
// Long enough that a pickup can only be fast if NOTIFY delivered it.
const POLL_SECONDS = 30;

function ms(n: number): string {
  return `${n.toFixed(0)} ms`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i]!;
}

async function main() {
  if (!process.env.QUEUE_DATABASE_URL) {
    console.error("QUEUE_DATABASE_URL is required (the dedicated queue Postgres).");
    process.exit(1);
  }

  // mode "worker" so the schema is migrated on a fresh box; the cron scheduler and
  // the maintenance supervisor stay off — this run must not touch real schedules.
  await startQueue({ mode: "worker", schedule: false, supervise: false });
  const boss = getBoss();

  // Drop any queue left by an earlier run BEFORE measuring. An interrupted run
  // leaves its backlog behind, and the latency probe would then be queued behind
  // thousands of stale jobs — reporting "NOTIFY is dead" when the only thing wrong
  // is that the previous attempt was killed.
  await boss.deleteQueue(QUEUE).catch(() => {});

  // Same shape as a real queue, plus the per-queue NOTIFY opt-in that is the
  // subject of measurement 1. Completed jobs are dropped quickly: this is throwaway.
  await boss.createQueue(QUEUE, {
    policy: "standard",
    retryLimit: 0,
    expireInSeconds: 120,
    deleteAfterSeconds: 600,
    notify: true,
  });

  console.log(`\n▸ queue "${QUEUE}" ready — polling interval ${POLL_SECONDS}s (NOTIFY under test)\n`);

  // ---- 1. Pickup latency on an idle queue -------------------------------
  // Keyed by the probe number carried in the job's own data, and registered BEFORE
  // the send. Keying on the id send() returns is a race the test would lose exactly
  // when it is working best: with NOTIFY the handler can run in single-digit
  // milliseconds, before send() has even resolved its id — so the waiter would be
  // registered after the pickup it was meant to observe, and every sample would
  // time out on a healthy queue.
  const waiters = new Map<number, (at: number) => void>();
  await boss.work<{ probe: number }>(
    QUEUE,
    { batchSize: 1, pollingIntervalSeconds: POLL_SECONDS },
    async (jobs) => {
      const at = Date.now();
      for (const job of jobs) waiters.get(job.data.probe)?.(at);
    },
  );

  const latencies: number[] = [];
  for (let i = 0; i < LATENCY_SAMPLES; i++) {
    let settle!: (at: number) => void;
    const picked = new Promise<number>((resolve, reject) => {
      settle = resolve;
      setTimeout(
        () => reject(new Error(`no pickup within ${POLL_SECONDS + 5}s — is a worker running?`)),
        (POLL_SECONDS + 5) * 1000,
      ).unref?.();
    });
    waiters.set(i, settle);
    const sentAt = Date.now();
    if (!(await boss.send(QUEUE, { probe: i }))) throw new Error("send returned no id");
    latencies.push((await picked) - sentAt);
    waiters.delete(i);
  }
  await boss.offWork(QUEUE);

  // ---- 2. Drain throughput ----------------------------------------------
  console.log(`▸ inserting ${TOTAL.toLocaleString("en-US")} no-op jobs…`);
  const insertStart = Date.now();
  for (let offset = 0; offset < TOTAL; offset += INSERT_CHUNK) {
    const rows = Array.from({ length: Math.min(INSERT_CHUNK, TOTAL - offset) }, (_, i) => ({
      name: QUEUE,
      data: { seq: offset + i },
    }));
    await boss.insert(QUEUE, rows);
  }
  const insertMs = Date.now() - insertStart;

  let processed = 0;
  const drained = new Promise<void>((resolve) => {
    void boss
      .work<{ seq: number }>(
        QUEUE,
        {
          batchSize: DRAIN_BATCH,
          localConcurrency: DRAIN_CONCURRENCY,
          // The knob that matters for a backlog. Once a queue has notify:true AND the
          // listener is up, the worker's backstop is notifyPollingIntervalSeconds
          // (default 30), NOT pollingIntervalSeconds — so a worker takes one full
          // fetch round, finishes, and sleeps 30s before looking again. Measured at
          // 22 jobs/s that way, which says nothing about the box.
          // burstWhenBatchFull keeps fetching while each fetch comes back full, so
          // this measures drain capacity instead of the backstop interval.
          burstWhenBatchFull: true,
          // Both, because pg-boss asserts notify >= base and the base defaults to 2.
          pollingIntervalSeconds: DRAIN_POLL_SECONDS,
          notifyPollingIntervalSeconds: DRAIN_POLL_SECONDS,
        },
        async (jobs) => {
          processed += jobs.length;
          if (processed >= TOTAL) resolve();
        },
      )
      .catch((err) => {
        console.error("drain worker failed:", err);
        process.exit(1);
      });
  });

  console.log("▸ draining…");
  const drainStart = Date.now();
  // A silent multi-minute drain is indistinguishable from a wedged one, and this
  // runs as a runbook step where "is it working?" has to be answerable at a glance.
  const ticker = setInterval(() => {
    const rate = processed / ((Date.now() - drainStart) / 1000);
    console.log(
      `   ${processed.toLocaleString("en-US")}/${TOTAL.toLocaleString("en-US")} (${Math.round(rate)} jobs/s)`,
    );
  }, 5_000);
  try {
    await drained;
  } finally {
    clearInterval(ticker);
  }
  const drainMs = Date.now() - drainStart;
  await boss.offWork(QUEUE);

  // ---- Summary -----------------------------------------------------------
  const sorted = [...latencies].sort((a, b) => a - b);
  const median = percentile(sorted, 50);
  const notifyWorking = median < 1_000;

  console.log(`
──────────────────────────────────────────────
 pg-boss smoke test — ${QUEUE}
──────────────────────────────────────────────
 Pickup latency (idle queue, ${LATENCY_SAMPLES} samples, polling ${POLL_SECONDS}s)
   median   ${ms(median)}
   p95      ${ms(percentile(sorted, 95))}
   max      ${ms(Math.max(...sorted))}
   NOTIFY   ${notifyWorking ? "✅ active (well under the polling interval)" : "❌ NOT active — this is polling, expect seconds of added latency per job"}

 Drain (${TOTAL.toLocaleString("en-US")} jobs, batch ${DRAIN_BATCH} × concurrency ${DRAIN_CONCURRENCY})
   insert   ${ms(insertMs)}  (${Math.round(TOTAL / (insertMs / 1000)).toLocaleString("en-US")} jobs/s)
   drain    ${ms(drainMs)}  (${Math.round(TOTAL / (drainMs / 1000)).toLocaleString("en-US")} jobs/s)

 Runbook expectations: pickup < 100 ms, drain in the thousands of jobs/min.
──────────────────────────────────────────────
`);

  await boss.deleteQueue(QUEUE);
  await stopQueue(10_000);
  // A failed NOTIFY is the finding this script exists to surface, so it must not
  // exit 0 — a runbook step that always passes is not a check.
  process.exit(notifyWorking ? 0 : 1);
}

main().catch(async (err) => {
  console.error("smoke test failed:", err);
  await stopQueue(5_000).catch(() => {});
  process.exit(1);
});
