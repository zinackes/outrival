import { logger } from "../lib/job-logger";
import { sendSlackMessage } from "../lib/slack";
import { getBoss, deadLetterQueue } from "@outrival/queue";

// Dead-man's switch. Every tick, ping an EXTERNAL monitor (Better Stack /
// UptimeRobot heartbeat URL). The monitor alerts when the ping STOPS — so the
// alarm is raised by something that is still alive when the VPS, the worker
// process or the queue Postgres dies silently. Nothing inside this system can
// report its own death; that is the whole point.
//
// pg-boss-only: it has no Trigger wrapper, because Trigger's 10-schedule cap is
// exactly what made a heartbeat cron impossible before.
//
// Never throws: a heartbeat that fails its own retry would pollute the DLQ with
// noise about a monitor being unreachable, which is not an Outrival outage. A
// missed ping is itself the signal.
// Consecutive ping failures, kept in the (long-lived) worker process. The external
// monitor already alerts when pings STOP, whatever the cause — this counter exists
// to say WHY: three straight failures means the fleet is alive but cannot reach its
// own dead-man switch, which is a monitor/egress problem, not an Outrival outage.
// Without it you get "pings stopped" and no way to tell the two apart.
const ALERT_AFTER_CONSECUTIVE_FAILURES = 3;
let consecutiveFailures = 0;
let warnedNoUrl = false;

async function onPingFailure(detail: string): Promise<void> {
  consecutiveFailures++;
  logger.warn("Heartbeat ping failed", { detail, consecutiveFailures });
  // Fire once as the threshold is crossed, not on every subsequent tick.
  if (consecutiveFailures !== ALERT_AFTER_CONSECUTIVE_FAILURES) return;
  await sendSlackMessage(
    process.env.OPS_SLACK_WEBHOOK_URL ?? "",
    `:warning: Heartbeat monitor unreachable ${consecutiveFailures}× in a row (${detail}). ` +
      `The workers are running — it is the dead-man switch itself that is not being reached, ` +
      `so expect a "no ping" alert that is NOT an outage.`,
  );
}

// A queue whose jobs are WAITING while nothing at all is running on it. pg-boss
// spawns one worker loop per localConcurrency and that loop awaits its own handler,
// so a single wedged run silently takes an entire queue offline while the rest of
// the process keeps working — measured on prod 2026-07-29: three battle cards sat
// `created` for six hours while scrape-monitor on the same worker fetched normally,
// and not one alert fired anywhere. `activeCount === 0` is what separates this from
// an ordinary backlog: a draining queue always has something in flight.
//
// Counted in heartbeat ticks (every 5 min), so three ticks is ~15 minutes of ready
// work nobody has touched. Kept in the process, like consecutiveFailures above: a
// restart clears it, which is correct — a restart is also what clears the stall.
const STALL_TICKS = 3;
const STALL_REPEAT_TICKS = 12; // then hourly, so a long stall keeps being visible
const stalledTicks = new Map<string, number>();

async function checkStalledQueues(): Promise<void> {
  const webhook = process.env.OPS_SLACK_WEBHOOK_URL;
  if (!webhook) return;

  let queues;
  try {
    queues = await getBoss().getQueues();
  } catch (err) {
    // The heartbeat's own job is to survive; a stats read that fails is not news.
    logger.warn("Stalled-queue check skipped", { err: String(err) });
    return;
  }

  const stalled: string[] = [];
  for (const q of queues) {
    // pg-boss's internal bookkeeping queues and the dead-letter sink have no
    // consumer BY DESIGN — the DLQ's whole purpose is to hold rows in `created`
    // until a human looks, so it would alarm forever.
    if (q.name.startsWith("__pgboss__") || q.name === deadLetterQueue.name) continue;

    if (q.readyCount > 0 && q.activeCount === 0) {
      const ticks = (stalledTicks.get(q.name) ?? 0) + 1;
      stalledTicks.set(q.name, ticks);
      const due = ticks === STALL_TICKS || (ticks > STALL_TICKS && ticks % STALL_REPEAT_TICKS === 0);
      if (due) {
        stalled.push(`\`${q.name}\` — ${q.readyCount} waiting, 0 active for ~${ticks * 5} min`);
      }
    } else {
      stalledTicks.delete(q.name);
    }
  }

  if (stalled.length === 0) return;
  await sendSlackMessage(
    webhook,
    `:rotating_light: Queue stalled — jobs are ready and nothing is consuming them:\n` +
      stalled.map((s) => `• ${s}`).join("\n") +
      `\nA wedged worker loop takes one queue down without touching the others. ` +
      `Recreating the owning worker clears it: \`docker compose up -d --force-recreate\`.`,
  );
}

export async function runHeartbeat() {
  // Runs before the ping and independently of it: this alarm is about the fleet
  // being alive but not working, which is exactly the state the dead-man switch
  // cannot see (the pings keep arriving throughout).
  await checkStalledQueues();

  const url = process.env.HEARTBEAT_URL;
  if (!url) {
    // Silently skipping leaves the box with NO dead-man switch at all, which is
    // indistinguishable from a healthy one. Say it once per process life.
    if (!warnedNoUrl) {
      warnedNoUrl = true;
      logger.warn("HEARTBEAT_URL unset — no dead-man switch is active on this worker");
    }
    return { skipped: "no_url" };
  }

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      await onPingFailure(`HTTP ${res.status}`);
      return { ok: false, status: res.status };
    }
    consecutiveFailures = 0;
    return { ok: true };
  } catch (err) {
    await onPingFailure(String(err));
    return { ok: false, error: String(err) };
  }
}
