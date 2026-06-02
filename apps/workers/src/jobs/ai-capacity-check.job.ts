import { schedules, logger } from "@trigger.dev/sdk/v3";
import { loadProviders } from "@outrival/ai";
import { redis, sendSlackMessage } from "@outrival/shared";

// Watches the AI provider pool's daily token budget (patch-22) and pings ops Slack
// when it's running low, before generations start failing. Paced to at most one ping
// per 2h so a sustained high-usage day doesn't spam. Best-effort throughout: Redis is
// the safe facade (reads 0 when Upstash is unset → no false alerts), and
// sendSlackMessage is silent when the webhook is unset/down.
export const aiCapacityCheckJob = schedules.task({
  id: "ai-capacity-check",
  cron: "*/30 * * * *",
  maxDuration: 60,

  async run() {
    logger.log("Starting ai-capacity-check");
    const providers = loadProviders();
    if (providers.length === 0) {
      logger.warn("ai-capacity-check: no providers configured, skipping");
      return { skipped: true };
    }

    const today = new Date().toISOString().slice(0, 10);
    let totalUsed = 0;
    let totalCapacity = 0;
    const exhausted: string[] = [];
    for (const p of providers) {
      const used = Number((await redis.get(`ai:usage:${p.id}:${today}`)) ?? 0);
      totalUsed += used;
      totalCapacity += p.dailyTokenQuota;
      if (used >= p.dailyTokenQuota * 0.95) exhausted.push(p.id);
    }
    const usagePercent = totalCapacity > 0 ? totalUsed / totalCapacity : 0;

    const alerts: string[] = [];
    if (usagePercent > 0.9) {
      alerts.push(`🔴 AI pool usage CRITICAL at ${Math.round(usagePercent * 100)}%`);
    } else if (usagePercent > 0.8) {
      alerts.push(`🟡 AI pool usage at ${Math.round(usagePercent * 100)}%`);
    }
    if (exhausted.length > 0) {
      alerts.push(`⚠ Exhausted providers: ${exhausted.join(", ")}`);
    }

    if (alerts.length === 0) {
      logger.log("Completed ai-capacity-check", { usagePercent, healthy: true });
      return { usagePercent, exhausted };
    }

    // Pace the pings: skip if we already alerted within the last 2h.
    const recentPing = await redis.get("ai:capacity_ping_recent");
    if (recentPing) {
      logger.log("ai-capacity-check: alert suppressed (pinged within 2h)", { usagePercent });
      return { usagePercent, exhausted, suppressed: true };
    }

    await sendSlackMessage(
      process.env.OPS_SLACK_WEBHOOK_URL ?? "",
      `Outrival AI capacity alert\n${alerts.join("\n")}`,
    );
    await redis.set("ai:capacity_ping_recent", "1", { ex: 7200 });
    logger.log("Completed ai-capacity-check", { usagePercent, pinged: true });
    return { usagePercent, exhausted, pinged: true };
  },
});
