import { schedules, logger } from "@trigger.dev/sdk/v3";
import { sendSlackMessage } from "@outrival/shared";
import { getQualityByTask } from "@outrival/db";
import {
  getScrapeHealth,
  getAiParseHealth,
  getRecentSignalCount,
} from "../lib/analytics";

// Conservative thresholds — this pings a human, so it must not cry wolf.
// Every rate alert is gated by a minimum sample so we never alert on 1-of-2.
const SCRAPE_WINDOW_HOURS = 6;
const SCRAPE_FAILURE_RATE = 0.3; // >30% failures
const SCRAPE_MIN_SAMPLE = 10;

const AI_WINDOW_HOURS = 6;
const AI_PARSE_FAILED_RATE = 0.25; // >25% parse failures
const AI_MIN_SAMPLE = 10;

// "Pipeline silent" only fires when there WAS scraping activity but zero signals
// came out — an idle/empty system producing 0 signals is normal, not an alarm.
const SIGNAL_WINDOW_HOURS = 24;
const SIGNAL_MIN_ACTIVITY = 20; // scrape runs in 24h before 0-signals is suspicious

// Cascade-level cost trend alarms over 24h (patch-20). Escalating to paid levels
// is normal in moderation; these fire when the mix shifts too far up the cascade.
// Gated by a minimum sample so we don't alert on a handful of runs.
const CASCADE_MIN_SAMPLE = 20;
const DATACENTER_RATE_THRESHOLD = 0.25; // >25% of scrapes need datacenter (L2+)
const RESIDENTIAL_RATE_THRESHOLD = 0.05; // >5% need residential/camoufox (L3+)

// Anti-hallucination (patch-24): a task whose confirmed-hallucination rate over the
// last 7 days crosses the configured threshold, gated by a min number of self-checks.
const HALLUCINATION_WINDOW_DAYS = 7;
const HALLUCINATION_MIN_SAMPLE = 10;

function pct(part: number, total: number): string {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : "0%";
}

export const opsHealthCheckJob = schedules.task({
  id: "ops-health-check",
  cron: "0 */6 * * *",
  maxDuration: 120,

  async run() {
    logger.log("Starting ops-health-check");
    const alerts: string[] = [];

    const scrape6h = await getScrapeHealth(SCRAPE_WINDOW_HOURS);
    if (scrape6h && scrape6h.total >= SCRAPE_MIN_SAMPLE) {
      const failureRate = scrape6h.failed / scrape6h.total;
      if (failureRate > SCRAPE_FAILURE_RATE) {
        alerts.push(
          `⚠️ Scraping degraded: ${pct(scrape6h.failed, scrape6h.total)} failure ` +
            `(${scrape6h.failed}/${scrape6h.total} runs, last ${SCRAPE_WINDOW_HOURS}h)`,
        );
      }
    }

    const ai6h = await getAiParseHealth(AI_WINDOW_HOURS);
    if (ai6h && ai6h.total >= AI_MIN_SAMPLE) {
      const parseRate = ai6h.parseFailed / ai6h.total;
      if (parseRate > AI_PARSE_FAILED_RATE) {
        alerts.push(
          `⚠️ AI parsing degraded: ${pct(ai6h.parseFailed, ai6h.total)} parse failures ` +
            `(${ai6h.parseFailed}/${ai6h.total} runs, last ${AI_WINDOW_HOURS}h)`,
        );
      }
    }

    const signals24h = await getRecentSignalCount(SIGNAL_WINDOW_HOURS);
    const scrape24h = await getScrapeHealth(SIGNAL_WINDOW_HOURS);
    if (
      signals24h === 0 &&
      scrape24h &&
      scrape24h.total >= SIGNAL_MIN_ACTIVITY
    ) {
      alerts.push(
        `🚨 AI pipeline silent: 0 signals in ${SIGNAL_WINDOW_HOURS}h ` +
          `despite ${scrape24h.total} scrape runs`,
      );
    }

    // Cascade cost mix: too many scrapes escalating to paid datacenter (L2+) or
    // expensive residential/Camoufox (L3+) means a fingerprint/IP regression.
    if (scrape24h && scrape24h.total >= CASCADE_MIN_SAMPLE) {
      const datacenterRate = scrape24h.proxy / scrape24h.total;
      const residentialRate = scrape24h.residential / scrape24h.total;
      if (residentialRate > RESIDENTIAL_RATE_THRESHOLD) {
        alerts.push(
          `💸 Residential/Camoufox usage high: ${pct(scrape24h.residential, scrape24h.total)} ` +
            `of scrapes (${scrape24h.residential}/${scrape24h.total}, last ${SIGNAL_WINDOW_HOURS}h)`,
        );
      } else if (datacenterRate > DATACENTER_RATE_THRESHOLD) {
        alerts.push(
          `💸 Datacenter proxy usage high: ${pct(scrape24h.proxy, scrape24h.total)} ` +
            `of scrapes need a paid level (${scrape24h.proxy}/${scrape24h.total}, last ${SIGNAL_WINDOW_HOURS}h)`,
        );
      }
    }

    // Hallucination rate per task (patch-24). Best-effort: a Postgres hiccup here
    // must not break the rest of the health check.
    try {
      const hallucThreshold = Number(process.env.AI_HALLUCINATION_ALERT_RATE) || 0.03;
      const byTask = await getQualityByTask(HALLUCINATION_WINDOW_DAYS);
      for (const t of byTask) {
        if (t.selfChecked >= HALLUCINATION_MIN_SAMPLE && t.hallucinationRate > hallucThreshold) {
          alerts.push(
            `🧠 Hallucination rate high on ${t.aiTask}: ${pct(t.confirmed, t.selfChecked)} ` +
              `(${t.confirmed}/${t.selfChecked} checks, last ${HALLUCINATION_WINDOW_DAYS}d)`,
          );
        }
      }
    } catch (err) {
      logger.warn("Hallucination-rate check skipped", { err: String(err) });
    }

    if (alerts.length > 0) {
      const text = `*Outrival ops health*\n${alerts.join("\n")}`;
      // sendSlackMessage is silent when the webhook is unset/down — never throws.
      await sendSlackMessage(process.env.OPS_SLACK_WEBHOOK_URL ?? "", text);
      logger.warn("Ops health alerts fired", { count: alerts.length, alerts });
    }

    logger.log("Completed ops-health-check", { alertsFired: alerts.length });
    return { alertsFired: alerts.length, alerts };
  },
});
