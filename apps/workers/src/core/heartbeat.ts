import { logger } from "../lib/job-logger";

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
export async function runHeartbeat() {
  const url = process.env.HEARTBEAT_URL;
  if (!url) return { skipped: "no_url" };

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn("Heartbeat ping rejected", { status: res.status });
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (err) {
    logger.warn("Heartbeat ping failed", { error: String(err) });
    return { ok: false, error: String(err) };
  }
}
