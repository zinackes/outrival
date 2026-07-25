import { logger } from "../lib/job-logger";
import { sendMonthlyRecap } from "@outrival/queue";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  organizations,
  orgNotificationPreferences,
  signals,
  competitors,
  digests,
} from "@outrival/db";
import { emailButton, signUnsubscribeToken } from "@outrival/shared";
import { getResend, ALERT_FROM } from "../lib/resend";
import { localHour } from "../lib/notification-dispatcher";
import { escapeHtml } from "../lib/escape-html";
import { emailShell, e } from "../lib/email-shell";

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
// Runtime-neutral job body: shared verbatim by the pg-boss handler and the thin
// Trigger.dev wrapper in ../jobs/generate-daily-digest.job.ts (deleted at the
// cutover). Only the header, the signature and the fan-out call change.
export async function runGenerateDailyDigest(payload?: { timestamp?: Date }) {
    const now = payload?.timestamp ?? new Date();
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

      // Piggyback (Lever 9): at the org's local FIRST-of-month morning, fire the monthly
      // recap for the month that just ended. No new cron (the 10-schedule cap is full) —
      // idempotency-keyed per org+month so the hourly cron can only send it once.
      const localParts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(now);
      if (localParts.find((p) => p.type === "day")?.value === "01") {
        const ly = Number(localParts.find((p) => p.type === "year")?.value);
        const lm = Number(localParts.find((p) => p.type === "month")?.value); // 1-12
        const py = lm === 1 ? ly - 1 : ly;
        const pm = lm === 1 ? 12 : lm - 1;
        const recapMonth = `${py}-${String(pm).padStart(2, "0")}`;
        try {
          await sendMonthlyRecap.enqueue(
            { orgId: org.id, month: recapMonth },
            { singletonKey: `recap-${org.id}-${recapMonth}` },
          );
        } catch (e) {
          logger.warn("Failed to trigger monthly recap", { orgId: org.id, error: String(e) });
        }
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
  <div ${e("card", "border-radius:6px;padding:16px;margin-bottom:12px;")}>
    <div ${e("muted", "font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;")}>${emoji} ${escapeHtml(s.competitorName)} · ${s.category}</div>
    <div ${e("text", "font-size:14px;margin-bottom:8px;")}>${escapeHtml(s.insight)}</div>
    ${s.soWhat ? `<div ${e("accent", "font-size:13px;")}>→ ${escapeHtml(s.soWhat)}</div>` : ""}
  </div>`;
        })
        .join("");

      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? process.env.BETTER_AUTH_URL ?? "";
      const secret = process.env.BETTER_AUTH_SECRET ?? "";
      const unsubscribeUrl =
        apiBase && secret
          ? `${apiBase}/api/digest-feedback/unsubscribe?token=${signUnsubscribeToken(org.id, secret)}`
          : undefined;
      const webUrl = process.env.WEB_URL ?? "https://outrival.app";

      const html = emailShell(
        `<p ${e("muted", "font-size:12px;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 4px;")}>Daily briefing</p>
  <h2 ${e("text", "margin:0 0 16px;")}>${deferred.length} update${deferred.length > 1 ? "s" : ""} since yesterday</h2>
  ${rows}
  <div style="margin-top:28px;text-align:center;">${emailButton(`${webUrl}/dashboard/signals?src=digest_daily`, "Open the full briefing")}</div>
  ${unsubscribeUrl ? `<div ${e("faint", "margin-top:24px;font-size:11px;text-align:center;")}><a href="${unsubscribeUrl}" ${e("faint", "text-decoration:underline;")}>Unsubscribe</a></div>` : ""}`,
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
}
