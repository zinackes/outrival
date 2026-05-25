import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, signals, competitors, organizations, alerts } from "@outrival/db";
import { sendSlackMessage } from "../lib/slack";
import { getResend, ALERT_FROM } from "../lib/resend";

const InputSchema = z.object({
  signalId: z.string(),
});

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🚨",
  high: "🔴",
  medium: "🟡",
  low: "🟢",
};

export const sendAlertJob = task({
  id: "send-alert",
  maxDuration: 60,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },

  async run(payload: z.input<typeof InputSchema>) {
    const input = InputSchema.parse(payload);
    logger.log("Starting send-alert", { signalId: input.signalId });

    const signal = await db.query.signals.findFirst({
      where: eq(signals.id, input.signalId),
    });
    if (!signal) throw new AbortTaskRunError(`Signal ${input.signalId} not found`);

    const competitor = await db.query.competitors.findFirst({
      where: eq(competitors.id, signal.competitorId),
    });
    if (!competitor) throw new AbortTaskRunError(`Competitor ${signal.competitorId} not found`);

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, signal.orgId),
    });
    if (!org) throw new AbortTaskRunError(`Org ${signal.orgId} not found`);

    if (!org.alertsEnabled) {
      logger.log("Alerts disabled for org, skipping", { orgId: org.id });
      return { skipped: true, reason: "alerts_disabled" };
    }

    const emoji = SEVERITY_EMOJI[signal.severity] ?? "🔔";
    const text = `${emoji} *${competitor.name}* — ${signal.category}\n${signal.insight}${signal.soWhat ? `\n→ ${signal.soWhat}` : ""}`;

    let slackSent = false;
    let emailSent = false;

    if (org.slackWebhookUrl) {
      try {
        await sendSlackMessage(org.slackWebhookUrl, text);
        await db.insert(alerts).values({
          signalId: signal.id,
          orgId: org.id,
          channel: "slack",
          sentAt: new Date(),
        });
        slackSent = true;
      } catch (err) {
        await db.insert(alerts).values({
          signalId: signal.id,
          orgId: org.id,
          channel: "slack",
          error: String(err),
        });
        logger.error("Slack alert failed", { err: String(err) });
      }
    }

    if (org.digestEmail) {
      try {
        const html = `<div style="font-family: Inter, sans-serif; background: #0a0a0a; color: #fafafa; padding: 24px; border-radius: 6px;">
  <p style="font-size: 12px; color: #a3a3a3; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 8px;">${signal.severity.toUpperCase()} · ${signal.category}</p>
  <h2 style="margin: 0 0 12px; font-family: Syne, sans-serif;">${competitor.name}</h2>
  <p style="margin: 0 0 12px;">${signal.insight}</p>
  ${signal.soWhat ? `<p style="color: #f59e0b; margin: 0 0 12px;">→ ${signal.soWhat}</p>` : ""}
  ${signal.recommendedAction ? `<p style="margin: 0; color: #d4d4d4;"><strong>Action :</strong> ${signal.recommendedAction}</p>` : ""}
</div>`;
        await getResend().emails.send({
          from: ALERT_FROM,
          to: org.digestEmail,
          subject: `${emoji} ${competitor.name} — ${signal.category}`,
          html,
        });
        await db.insert(alerts).values({
          signalId: signal.id,
          orgId: org.id,
          channel: "email",
          sentAt: new Date(),
        });
        emailSent = true;
      } catch (err) {
        await db.insert(alerts).values({
          signalId: signal.id,
          orgId: org.id,
          channel: "email",
          error: String(err),
        });
        logger.error("Email alert failed", { err: String(err) });
      }
    }

    logger.log("Completed send-alert", {
      signalId: signal.id,
      slackSent,
      emailSent,
    });

    return { slackSent, emailSent };
  },
});
