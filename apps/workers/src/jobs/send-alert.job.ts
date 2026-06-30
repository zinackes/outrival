import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import {
  db,
  signals,
  competitors,
  organizations,
  alerts,
  notifications,
  crmDestinations,
} from "@outrival/db";
import { PLAN_LIMITS } from "@outrival/shared";
import { sendSlackMessage } from "../lib/slack";
import { sendWebhook } from "../lib/webhook";
import { pushWebhook } from "../lib/crm-webhook";
import { getResend, ALERT_FROM } from "../lib/resend";
import { escapeHtml } from "../lib/escape-html";
import { darkEmailShell } from "../lib/email-shell";

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

    // Idempotency: a retry must not re-send Slack/email or duplicate the in-app
    // notification. The alerts table records every channel attempt for the
    // signal, so prior rows tell us what already happened.
    const priorAlerts = await db.query.alerts.findMany({
      where: eq(alerts.signalId, signal.id),
    });
    const sentChannels = new Set(
      priorAlerts.filter((a) => a.sentAt).map((a) => a.channel),
    );
    // The in-app notification is inserted before any alerts row, so any prior
    // alerts row means the notification step already ran on an earlier attempt.
    const alreadyProcessed = priorAlerts.length > 0;

    const limits = PLAN_LIMITS[org.plan];

    // Realtime alerts (in-app + Slack/email/webhook on critical signals) are a
    // paid feature. Plans without it only surface signals via the weekly digest.
    if (!limits.features.realtimeAlerts) {
      logger.log("Realtime alerts not in plan, skipping", { orgId: org.id, plan: org.plan });
      return { skipped: true, reason: "plan_no_realtime_alerts" };
    }

    const emoji = SEVERITY_EMOJI[signal.severity] ?? "🔔";
    const text = `${emoji} *${competitor.name}* — ${signal.category}\n${signal.insight}${signal.soWhat ? `\n→ ${signal.soWhat}` : ""}`;

    if (!alreadyProcessed) {
      await db.insert(notifications).values({
        orgId: org.id,
        type: "signal",
        title: `${emoji} ${competitor.name} — ${signal.category}`,
        body: signal.insight,
        linkUrl: `/dashboard/competitors/${competitor.id}`,
      });
    }

    let slackSent = false;
    let webhookSent = false;
    let emailSent = false;

    if (
      org.slackWebhookUrl &&
      limits.allowedChannels.includes("slack") &&
      !sentChannels.has("slack")
    ) {
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

    if (
      org.webhookUrl &&
      limits.allowedChannels.includes("webhook") &&
      !sentChannels.has("webhook")
    ) {
      try {
        await sendWebhook(org.webhookUrl, {
          competitor: { id: competitor.id, name: competitor.name },
          signal: {
            id: signal.id,
            severity: signal.severity,
            category: signal.category,
            insight: signal.insight,
            soWhat: signal.soWhat,
            recommendedAction: signal.recommendedAction,
          },
          linkUrl: `/dashboard/competitors/${competitor.id}`,
        });
        await db.insert(alerts).values({
          signalId: signal.id,
          orgId: org.id,
          channel: "webhook",
          sentAt: new Date(),
        });
        webhookSent = true;
      } catch (err) {
        await db.insert(alerts).values({
          signalId: signal.id,
          orgId: org.id,
          channel: "webhook",
          error: String(err),
        });
        logger.error("Webhook alert failed", { err: String(err) });
      }
    }

    if (org.digestEmail && !sentChannels.has("email")) {
      try {
        const html = darkEmailShell(
          `<p style="font-size: 12px; color: #a3a3a3; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 8px;">${signal.severity.toUpperCase()} · ${signal.category}</p>
  <h2 style="margin: 0 0 12px; font-family: Syne, sans-serif; color: #fafafa;">${escapeHtml(competitor.name)}</h2>
  <p style="margin: 0 0 12px;">${escapeHtml(signal.insight)}</p>
  ${signal.soWhat ? `<p style="color: #f59e0b; margin: 0 0 12px;">→ ${escapeHtml(signal.soWhat)}</p>` : ""}
  ${signal.recommendedAction ? `<p style="margin: 0; color: #d4d4d4;"><strong>Action:</strong> ${escapeHtml(signal.recommendedAction)}</p>` : ""}`,
        );
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

    // Outbound webhook destinations (Phase C) — best-effort fan-out to the org's
    // configured CRM/automation URLs. A push failure never affects the alert. Gated
    // by !alreadyProcessed so a retry doesn't double-push (mirrors the notification).
    let crmPushed = 0;
    if (!alreadyProcessed) {
      const destinations = await db.query.crmDestinations.findMany({
        where: and(eq(crmDestinations.orgId, org.id), eq(crmDestinations.enabled, true)),
      });
      if (destinations.length > 0) {
        const crmPayload = {
          type: "signal" as const,
          signal: {
            id: signal.id,
            severity: signal.severity,
            category: signal.category,
            insight: signal.insight,
            soWhat: signal.soWhat,
            recommendedAction: signal.recommendedAction,
            createdAt: signal.createdAt,
            competitor: { id: competitor.id, name: competitor.name },
            url: `/dashboard/competitors/${competitor.id}`,
          },
        };
        const results = await Promise.all(
          destinations.map(async (d) => {
            const ok = await pushWebhook(d.url, d.secret, crmPayload);
            if (ok) {
              await db
                .update(crmDestinations)
                .set({ lastPushedAt: new Date() })
                .where(eq(crmDestinations.id, d.id))
                .catch(() => {});
            }
            return ok;
          }),
        );
        crmPushed = results.filter(Boolean).length;
      }
    }

    logger.log("Completed send-alert", {
      signalId: signal.id,
      slackSent,
      webhookSent,
      emailSent,
      crmPushed,
    });

    return { slackSent, webhookSent, emailSent, crmPushed };
  },
});
