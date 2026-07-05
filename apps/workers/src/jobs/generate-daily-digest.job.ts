import { schedules, logger } from "@trigger.dev/sdk/v3";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  organizations,
  orgNotificationPreferences,
  signals,
  competitors,
  digests,
} from "@outrival/db";
import { signUnsubscribeToken } from "@outrival/shared";
import { getResend, ALERT_FROM } from "../lib/resend";
import { localHour } from "../lib/notification-dispatcher";
import { escapeHtml } from "../lib/escape-html";
import { darkEmailShell } from "../lib/email-shell";

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🚨",
  high: "🔴",
  medium: "🟡",
  low: "🟢",
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type DeferredSignal = {
  severity: string;
  category: string;
  insight: string;
  soWhat: string | null;
  competitorName: string;
};

// Map a signal's severity to the digest reader's urgency buckets (action_required
// / watch / fyi) so a persisted daily digest renders through the same UI + email
// template as the weekly one. No AI call — daily digests stay free.
function severityToUrgency(severity: string): "action_required" | "watch" | "fyi" {
  if (severity === "critical" || severity === "high") return "action_required";
  if (severity === "medium") return "watch";
  return "fyi";
}

function buildDailyDigestContent(deferred: DeferredSignal[]) {
  const hasHigh = deferred.some(
    (s) => s.severity === "critical" || s.severity === "high",
  );
  const hasMedium = deferred.some((s) => s.severity === "medium");
  const temperature = hasHigh ? "high" : hasMedium ? "moderate" : "low";
  return {
    temperature,
    tldr: [
      `${deferred.length} competitor update${deferred.length > 1 ? "s" : ""} since your last briefing.`,
    ],
    sections: deferred.map((s) => ({
      urgency: severityToUrgency(s.severity),
      competitor: s.competitorName,
      category: s.category,
      insight: s.insight,
      so_what: s.soWhat ?? "",
    })),
  };
}

// Patch-26: delivers the signals the dispatcher deferred to a daily digest
// (high severity by default, plus anything pushed off an immediate email by quiet
// hours or the frequency cap). Runs hourly and fires for an org only when its
// local clock reaches the quiet-hours end hour (its morning), so each org gets one
// digest per local day. Idempotent via signals.dailyDigestSentAt.
export const generateDailyDigestJob = schedules.task({
  id: "generate-daily-digest",
  cron: "0 * * * *",
  maxDuration: 300,
  retry: { maxAttempts: 3, minTimeoutInMs: 5_000, maxTimeoutInMs: 60_000, factor: 2 },

  async run(payload) {
    const now = payload.timestamp ?? new Date();
    const defaultEnd = Number(process.env.QUIET_HOURS_DEFAULT_END ?? 8);

    const orgs = await db.query.organizations.findMany({
      where: eq(organizations.digestEnabled, true),
    });

    let sent = 0;
    let skipped = 0;

    for (const org of orgs) {
      if (!org.digestEmail) {
        skipped++;
        continue;
      }

      const prefs = await db.query.orgNotificationPreferences.findFirst({
        where: eq(orgNotificationPreferences.orgId, org.id),
      });
      const timezone = prefs?.timezone ?? "UTC";
      const morningHour = prefs?.quietHoursEnd ?? defaultEnd;

      // Only fire at the org's local morning hour.
      if (localHour(timezone, now) !== morningHour) {
        skipped++;
        continue;
      }

      const deferred = await db
        .select({
          id: signals.id,
          severity: signals.severity,
          category: signals.category,
          insight: signals.insight,
          soWhat: signals.soWhat,
          competitorName: competitors.name,
          competitorId: competitors.id,
        })
        .from(signals)
        .innerJoin(competitors, eq(signals.competitorId, competitors.id))
        .where(
          and(
            eq(signals.orgId, org.id),
            eq(signals.dispatchedChannel, "digest_daily"),
            isNull(signals.dailyDigestSentAt),
          ),
        );

      if (deferred.length === 0) {
        skipped++;
        continue;
      }

      const rows = deferred
        .map((s) => {
          const emoji = SEVERITY_EMOJI[s.severity] ?? "🔔";
          return `
  <div style="background:#171717;border:1px solid #262626;border-radius:6px;padding:16px;margin-bottom:12px;">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#a3a3a3;margin-bottom:6px;">${emoji} ${escapeHtml(s.competitorName)} · ${s.category}</div>
    <div style="color:#fafafa;font-size:14px;margin-bottom:8px;">${escapeHtml(s.insight)}</div>
    ${s.soWhat ? `<div style="color:#f59e0b;font-size:13px;">→ ${escapeHtml(s.soWhat)}</div>` : ""}
  </div>`;
        })
        .join("");

      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? process.env.BETTER_AUTH_URL ?? "";
      const secret = process.env.BETTER_AUTH_SECRET ?? "";
      const unsubscribeUrl =
        apiBase && secret
          ? `${apiBase}/api/digest-feedback/unsubscribe?token=${signUnsubscribeToken(org.id, secret)}`
          : undefined;

      const html = darkEmailShell(
        `<p style="font-size:12px;color:#a3a3a3;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 4px;">Daily briefing</p>
  <h2 style="font-family:Syne,sans-serif;margin:0 0 16px;color:#fafafa;">${deferred.length} update${deferred.length > 1 ? "s" : ""} since yesterday</h2>
  ${rows}
  ${unsubscribeUrl ? `<div style="margin-top:24px;font-size:11px;color:#525252;text-align:center;"><a href="${unsubscribeUrl}" style="color:#525252;text-decoration:underline;">Unsubscribe</a></div>` : ""}`,
      );

      try {
        await getResend().emails.send({
          from: ALERT_FROM,
          to: org.digestEmail,
          // Lever 11 — same briefing branding as the weekly send.
          subject: `Your Daily Briefing — ${deferred.length} competitor update${deferred.length > 1 ? "s" : ""}`,
          html,
          ...(unsubscribeUrl
            ? {
                headers: {
                  "List-Unsubscribe": `<${unsubscribeUrl}>`,
                  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                },
              }
            : {}),
        });
      } catch (err) {
        // Leave dailyDigestSentAt unset so a retry re-attempts these signals.
        logger.error("Daily digest email failed", { orgId: org.id, err: String(err) });
        continue;
      }

      const sentAt = new Date();
      await db
        .update(signals)
        .set({ dailyDigestSentAt: sentAt })
        .where(
          inArray(
            signals.id,
            deferred.map((s) => s.id),
          ),
        );

      // Persist the sent daily briefing so it shows up in-app alongside the weekly
      // digests (same reader UI). period="daily" keeps it out of the weekly cron's
      // idempotency/finalize lookups. Best-effort — a failure here never blocks the
      // send (the email already went out and the signals are stamped).
      try {
        const content = buildDailyDigestContent(deferred);
        const day = isoDate(sentAt);
        await db.insert(digests).values({
          orgId: org.id,
          weekStart: day,
          weekEnd: day,
          content,
          temperature: content.temperature,
          period: "daily",
          sentAt,
        });
      } catch (err) {
        logger.error("Daily digest persist failed", { orgId: org.id, err: String(err) });
      }
      sent++;
    }

    logger.log("Completed generate-daily-digest", { sent, skipped, orgs: orgs.length });
    return { sent, skipped };
  },
});
