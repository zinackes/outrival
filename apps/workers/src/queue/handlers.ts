import { work, queueHealth, type JobDef } from "@outrival/queue";
import { logger } from "@outrival/shared";

// Which queues a worker process consumes, keyed by WORKER_ROLE:
//   browser — the 3 jobs that launch Chromium/Camoufox or render a PDF
//             (scrape-monitor fast+slow, detect-platform, generate-battle-card).
//             Deployed from Dockerfile.queue-browser (3 browsers baked in, big RAM).
//   light   — everything else: crons, AI lane, extracts, digests, alerts.
//             Deployed from Dockerfile.queue-light (slim, no browsers).
// Phase 2 (leaf + cron jobs) and Phase 3 (pipeline core) wire the real handlers
// here as they are migrated off Trigger.dev — a job stays on Trigger until its
// handler is registered in this file.
export type WorkerRole = "browser" | "light";

export async function registerHandlers(role: WorkerRole): Promise<string[]> {
  const registered: string[] = [];
  const on = async <P extends object>(
    def: JobDef<P>,
    handler: (data: P) => Promise<unknown>,
  ): Promise<void> => {
    await work(def, (data) => handler(data));
    registered.push(def.name);
  };

  if (role === "light") {
    // Liveness probe — the post-deploy smoke test enqueues this and expects it
    // to complete. Also the Phase 1 verify gate before real handlers exist.
    await on(queueHealth, async (data) => {
      logger.info({ note: data.note ?? null }, "queue-health processed");
    });
  }

  if (role === "browser") {
    // Phase 3: scrapeMonitor, scrapeMonitorSlow, detectPlatform, generateBattleCard.
  }

  return registered;
}
