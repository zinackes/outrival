import { logger } from "../lib/job-logger";
import { NonRetriable as AbortTaskRunError } from "@outrival/queue";
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
import { PLAN_LIMITS, sendWebhook } from "@outrival/shared";
import { sendSlackMessage } from "../lib/slack";
import { pushWebhook } from "../lib/crm-webhook";
import { sendEmail, ALERT_FROM } from "../lib/resend";
import { escapeHtml } from "../lib/escape-html";
import { emailShell, e } from "../lib/email-shell";

const InputSchema = z.object({
  signalId: z.string(),
});

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🚨",
  high: "🔴",
  medium: "🟡",
  low: "🟢",
};

// In-app notifications carry no emoji (product rule): the severity is spelled out
// instead, so the bell/toast title stays readable text.
const SEVERITY_LABEL: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

// Runtime-neutral job body: shared verbatim by the pg-boss handler and the thin
// Trigger.dev wrapper in ../jobs/send-alert.job.ts (deleted at the cutover). The
// body is byte-identical to the pre-migration job — only the header and the
// signature change, so the two runtimes cannot drift.
export async function runSendAlert(payload: z.input<typeof InputSchema>) {
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
        title: `${SEVERITY_LABEL[signal.severity] ?? "Signal"} · ${competitor.name} — ${signal.category}`,
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
      // The shared sendWebhook never throws — it returns false on any failure
      // (unsafe URL, network error, non-ok response). org.webhookUrl carries no
      // signing secret (unlike CRM destinations), so pass null.
      const delivered = await sendWebhook(org.webhookUrl, null, {
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
      if (delivered) {
        await db.insert(alerts).values({
          signalId: signal.id,
          orgId: org.id,
          channel: "webhook",
          sentAt: new Date(),
        });
        webhookSent = true;
      } else {
        await db.insert(alerts).values({
          signalId: signal.id,
          orgId: org.id,
          channel: "webhook",
          error: "Webhook delivery failed",
        });
        logger.error("Webhook alert failed", { orgId: org.id });
      }
    }

    if (org.digestEmail && !sentChannels.has("email")) {
      try {
        const html = emailShell(
          `<p ${e("muted", "font-size:12px;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 8px;")}>${signal.severity.toUpperCase()} · ${signal.category}</p>
  <h2 ${e("text", "margin:0 0 12px;")}>${escapeHtml(competitor.name)}</h2>
  <p ${e("text", "margin:0 0 12px;")}>${escapeHtml(signal.insight)}</p>
  ${signal.soWhat ? `<p ${e("accent", "margin:0 0 12px;")}>→ ${escapeHtml(signal.soWhat)}</p>` : ""}
  ${signal.recommendedAction ? `<p ${e("muted", "margin:0;")}><strong>Action:</strong> ${escapeHtml(signal.recommendedAction)}</p>` : ""}`,
        );
        await sendEmail({
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
}
