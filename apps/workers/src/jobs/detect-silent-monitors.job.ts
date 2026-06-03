import { schedules, logger } from "@trigger.dev/sdk/v3";
import { and, eq, ne, gte, isNull, sql } from "drizzle-orm";
import {
  db,
  monitors,
  competitors,
  signals,
  changes,
  notifications,
  organizations,
} from "@outrival/db";
import { sendSlackMessage } from "@outrival/shared";
import { decideDispatch } from "../lib/notification-dispatcher";
import { getResend, ALERT_FROM } from "../lib/resend";

// Patch-27 — daily sweep for monitors that have produced nothing for a long time.
// Pings ops (Slack) with the full list, and notifies each affected org once per
// 30 days (in-app always; email only when the org routes medium severity to an
// immediate email, via the patch-26 dispatcher). markedUnscrapable monitors are
// excluded (patch-20 already surfaces those), as are self products and the
// infra-only tech_stack anchor.

const COOLDOWN_DAYS = 30;
const DAY_MS = 86_400_000;
const OPS_SLACK_MAX_LINES = 30;

interface SilentMonitor {
  monitorId: string;
  competitorId: string;
  competitorName: string;
  sourceType: string;
  orgId: string;
  daysSilent: number;
}

export const detectSilentMonitorsJob = schedules.task({
  id: "detect-silent-monitors",
  cron: "0 8 * * *",
  maxDuration: 300,

  async run() {
    logger.log("Starting detect-silent-monitors");

    const thresholdDays = Number(process.env.SILENT_MONITOR_ALERT_THRESHOLD_DAYS ?? 60);
    const cutoffMs = Date.now() - thresholdDays * DAY_MS;

    const rows = await db
      .select({
        monitorId: monitors.id,
        sourceType: monitors.sourceType,
        monitorCreatedAt: monitors.createdAt,
        competitorId: competitors.id,
        competitorName: competitors.name,
        orgId: competitors.orgId,
      })
      .from(monitors)
      .innerJoin(competitors, eq(monitors.competitorId, competitors.id))
      .where(
        and(
          eq(monitors.isActive, true),
          eq(monitors.markedUnscrapable, false),
          ne(monitors.sourceType, "tech_stack"),
          ne(competitors.type, "self"),
          isNull(competitors.deletedAt),
        ),
      );

    if (rows.length === 0) {
      logger.log("No active monitors to check");
      return { silent: 0 };
    }

    // Last signal per monitor (signals → changes → monitor). No signal ever →
    // fall back to the monitor's creation date as the reference.
    const lastSignalRows = await db
      .select({
        monitorId: changes.monitorId,
        lastSignalAt: sql<string | Date | null>`max(${signals.createdAt})`,
      })
      .from(signals)
      .innerJoin(changes, eq(signals.changeId, changes.id))
      .groupBy(changes.monitorId);
    const lastSignalByMonitor = new Map<string, number>();
    for (const r of lastSignalRows) {
      if (r.lastSignalAt) lastSignalByMonitor.set(r.monitorId, new Date(r.lastSignalAt).getTime());
    }

    const silent: SilentMonitor[] = [];
    for (const r of rows) {
      const lastRef = lastSignalByMonitor.get(r.monitorId) ?? r.monitorCreatedAt.getTime();
      if (lastRef < cutoffMs) {
        silent.push({
          monitorId: r.monitorId,
          competitorId: r.competitorId,
          competitorName: r.competitorName,
          sourceType: r.sourceType,
          orgId: r.orgId,
          daysSilent: Math.floor((Date.now() - lastRef) / DAY_MS),
        });
      }
    }

    if (silent.length === 0) {
      logger.log("No silent monitors");
      return { silent: 0 };
    }

    // 1. Ops Slack — one digest (no-op when the webhook is unset).
    await sendSlackMessage(
      process.env.OPS_SLACK_WEBHOOK_URL ?? "",
      formatOpsSlack(silent, thresholdDays),
    );

    // 2. Per-org user notification, rate-limited to 1 / 30 days.
    const byOrg = new Map<string, SilentMonitor[]>();
    for (const s of silent) {
      const list = byOrg.get(s.orgId) ?? [];
      list.push(s);
      byOrg.set(s.orgId, list);
    }

    const cooldownStart = new Date(Date.now() - COOLDOWN_DAYS * DAY_MS);
    let orgsNotified = 0;
    for (const [orgId, list] of byOrg) {
      const recent = await db.query.notifications.findFirst({
        where: and(
          eq(notifications.orgId, orgId),
          eq(notifications.type, "silent_monitor"),
          gte(notifications.createdAt, cooldownStart),
        ),
      });
      if (recent) continue;
      await notifyOrg(orgId, list);
      orgsNotified += 1;
    }

    logger.log("Completed detect-silent-monitors", { silent: silent.length, orgsNotified });
    return { silent: silent.length, orgsNotified };
  },
});

function formatOpsSlack(silent: SilentMonitor[], thresholdDays: number): string {
  const lines = silent
    .slice(0, OPS_SLACK_MAX_LINES)
    .map((s) => `  ${s.competitorName} / ${s.sourceType} — ${s.daysSilent}d`)
    .join("\n");
  const more =
    silent.length > OPS_SLACK_MAX_LINES ? `\n  …and ${silent.length - OPS_SLACK_MAX_LINES} more` : "";
  return [
    `🔇 Outrival — silent monitors detected (${silent.length})`,
    "",
    `No signal in ${thresholdDays}+ days:`,
    "",
    lines + more,
    "",
    "Actions: investigate, check the scraper health, or propose alternatives to the user.",
  ].join("\n");
}

async function notifyOrg(orgId: string, list: SilentMonitor[]): Promise<void> {
  const n = list.length;
  const names = list
    .slice(0, 2)
    .map((s) => `${s.competitorName} (${s.sourceType})`)
    .join(" and ");
  const extra = n > 2 ? `, plus ${n - 2} more,` : "";
  const title = `${n} monitored source${n > 1 ? "s" : ""} ${n > 1 ? "have" : "has"} gone quiet`;
  const body =
    `${names}${extra} ${n > 1 ? "haven't" : "hasn't"} produced anything in a while. ` +
    "They may no longer be active, or a scrape problem is blocking collection. " +
    "You can re-scan to check, pause the source, or swap its URL.";
  const linkUrl = `/dashboard/competitors/${list[0]!.competitorId}`;

  // In-app notification always (cooldown-protected by the caller).
  await db.insert(notifications).values({ orgId, type: "silent_monitor", title, body, linkUrl });

  // Email only when the org routes medium severity to an immediate email — keeps
  // this low-noise by default while honouring per-org channel prefs (patch-26).
  try {
    const decision = await decideDispatch(orgId, {
      severity: "medium",
      competitorId: list[0]!.competitorId,
    });
    if (decision.channel !== "email_immediate") return;

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
      columns: { digestEmail: true },
    });
    const to = org?.digestEmail;
    if (!to) return;

    const webUrl = process.env.WEB_URL ?? "";
    await getResend().emails.send({
      from: ALERT_FROM,
      to,
      subject: title,
      html: silentEmailHtml(title, body, `${webUrl}${linkUrl}`),
    });
  } catch (err) {
    logger.warn("Silent-monitor email skipped (non-fatal)", { orgId, err: String(err) });
  }
}

function silentEmailHtml(title: string, body: string, href: string): string {
  return `<!doctype html><html lang="en"><body style="margin:0;background:#0a0a0a;color:#e5e5e5;font-family:Inter,system-ui,sans-serif;padding:32px">
  <div style="max-width:520px;margin:0 auto">
    <h1 style="font-size:18px;color:#fff;margin:0 0 12px">${title}</h1>
    <p style="font-size:14px;line-height:1.6;color:#a3a3a3;margin:0 0 24px">${body}</p>
    <a href="${href}" style="display:inline-block;background:#f59e0b;color:#0a0a0a;font-weight:600;font-size:14px;text-decoration:none;padding:10px 18px;border-radius:8px">Review the source</a>
  </div></body></html>`;
}
