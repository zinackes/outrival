// pg-boss worker entry — replaces the Trigger.dev managed runner.
//   WORKER_ROLE=light   bun run src/queue/worker.ts   (crons, AI, extracts, alerts)
//   WORKER_ROLE=browser bun run src/queue/worker.ts   (scrapes, platform, battle-card PDF)
// Sentry MUST init before any handler code runs. Side-effect import.
import "../lib/sentry";
import { Sentry } from "../lib/sentry";
import { logger } from "@outrival/shared";
import { startQueue, stopQueue, registerQueues, syncSchedules } from "@outrival/queue";
import { validateWorkerEnv } from "../env";
import { registerHandlers, type WorkerRole } from "./handlers";

const role = process.env.WORKER_ROLE as WorkerRole | undefined;
if (role !== "browser" && role !== "light") {
  throw new Error(`WORKER_ROLE must be "browser" or "light" (got: ${role ?? "unset"})`);
}

// Exactly one process owns cron scheduling + queue maintenance; the light
// worker is the natural owner (always-on, cheap). The browser worker only
// consumes its queues.
const ownsScheduling = role === "light";

async function main() {
  // Fail fast on misconfigured env before any job logic runs (was the
  // trigger.config `init` hook).
  validateWorkerEnv();

  await startQueue({
    mode: "worker",
    schedule: ownsScheduling,
    supervise: ownsScheduling,
    reportError: (err, ctx) =>
      Sentry.captureException(err, { tags: { job: ctx.job, jobId: ctx.id } }),
  });
  await registerQueues();

  if (ownsScheduling) {
    const { upserted, removed } = await syncSchedules();
    logger.info({ upserted, removed }, "cron schedules synced");
  }

  const handlers = await registerHandlers(role as WorkerRole);
  logger.info({ role, ownsScheduling, handlers }, "queue worker ready");
}

// Graceful drain on Coolify redeploy/stop: wait for in-flight handlers instead
// of leaving jobs stuck 'active' until expireInSeconds.
let stopping = false;
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.once(sig, async () => {
    if (stopping) return;
    stopping = true;
    logger.info({ sig }, "queue worker draining");
    await stopQueue(30_000);
    logger.info("queue worker stopped");
    process.exit(0);
  });
}

main().catch((err) => {
  Sentry.captureException(err);
  logger.error({ err }, "queue worker failed to boot");
  process.exit(1);
});
