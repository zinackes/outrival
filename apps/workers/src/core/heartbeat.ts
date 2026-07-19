import { logger } from "../lib/job-logger";
import { sendSlackMessage } from "../lib/slack";

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

export async function runHeartbeat() {
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
