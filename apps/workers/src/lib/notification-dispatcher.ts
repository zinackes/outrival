import { and, count, eq, gte } from "drizzle-orm";
import { db, orgNotificationPreferences, orgRelevanceThreshold, alerts } from "@outrival/db";

// Patch-26: central, org-scoped notification dispatcher. Given a freshly generated
// signal (or a digest), it applies the moderation layers in order and returns how
// the signal should be delivered. Critical severity bypasses every filter
// (NOTIFICATION_CRITICAL_BYPASS). Batching (layer 5) is NOT decided here — it's a
// periodic job that rolls up already-dispatched signals.

export type ChannelMode =
  | "email_immediate"
  | "digest_daily"
  | "digest_weekly"
  | "in_app_only"
  | "muted";

export type FilteredReason =
  | "below_threshold"
  | "quiet_hours"
  | "frequency_cap"
  | "channel_muted";

export interface NotificationContext {
  signalId?: string;
  severity: "critical" | "high" | "medium" | "low";
  relevanceScore?: number | null;
  competitorId: string;
  category?: string;
}

export interface DispatchDecision {
  /** Whether the signal reaches the user through *some* channel (an immediate email
   *  or a digest). false means dropped (below threshold / muted). */
  send: boolean;
  channel: ChannelMode;
  /** Why it was held back from its nominal immediate channel (or dropped). */
  filteredReason?: FilteredReason;
  /** When deferred, roughly when it will go out (the next local morning). */
  scheduledFor?: Date;
}

interface EffectivePrefs {
  channelCritical: ChannelMode;
  channelHigh: ChannelMode;
  channelMedium: ChannelMode;
  channelLow: ChannelMode;
  timezone: string;
  quietHoursStart: number;
  quietHoursEnd: number;
  weekendOff: boolean;
  dailyEmailCap: number;
}

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

function defaultPrefs(): EffectivePrefs {
  return {
    channelCritical: "email_immediate",
    channelHigh: "digest_daily",
    channelMedium: "digest_weekly",
    channelLow: "in_app_only",
    timezone: "UTC",
    quietHoursStart: envInt("QUIET_HOURS_DEFAULT_START", 22),
    quietHoursEnd: envInt("QUIET_HOURS_DEFAULT_END", 8),
    weekendOff: process.env.QUIET_HOURS_WEEKEND_OFF !== "false",
    dailyEmailCap: envInt("NOTIFICATION_DAILY_EMAIL_CAP", 10),
  };
}

async function getOrgPrefs(orgId: string): Promise<EffectivePrefs> {
  const row = await db.query.orgNotificationPreferences.findFirst({
    where: eq(orgNotificationPreferences.orgId, orgId),
  });
  if (!row) return defaultPrefs();
  return {
    channelCritical: row.channelCritical,
    channelHigh: row.channelHigh,
    channelMedium: row.channelMedium,
    channelLow: row.channelLow,
    timezone: row.timezone,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    weekendOff: row.weekendOff,
    dailyEmailCap: row.dailyEmailCap,
  };
}

async function getOrgThreshold(orgId: string): Promise<number> {
  const row = await db.query.orgRelevanceThreshold.findFirst({
    where: eq(orgRelevanceThreshold.orgId, orgId),
  });
  if (row) return row.threshold;
  const def = Number(process.env.RELEVANCE_THRESHOLD_DEFAULT);
  return Number.isFinite(def) ? def : 0.5;
}

function channelForSeverity(severity: NotificationContext["severity"], prefs: EffectivePrefs): ChannelMode {
  switch (severity) {
    case "critical":
      return prefs.channelCritical;
    case "high":
      return prefs.channelHigh;
    case "medium":
      return prefs.channelMedium;
    default:
      return prefs.channelLow;
  }
}

// --- Timezone helpers (wall-clock in an IANA tz, no extra deps) ---

// ms to add to a UTC instant to get the wall-clock reading in `timezone`.
function tzOffsetMs(timezone: string, at: Date): number {
  const utcWall = new Date(at.toLocaleString("en-US", { timeZone: "UTC" }));
  const tzWall = new Date(at.toLocaleString("en-US", { timeZone: timezone }));
  return tzWall.getTime() - utcWall.getTime();
}

function wallClock(timezone: string, at = new Date()): { hour: number; day: number } {
  const wall = new Date(at.getTime() + tzOffsetMs(timezone, at));
  return { hour: wall.getUTCHours(), day: wall.getUTCDay() };
}

// Current hour (0-23) in `timezone` — used by the daily digest job to fire at each
// org's local morning.
export function localHour(timezone: string, at = new Date()): number {
  return wallClock(timezone, at).hour;
}

// Start of the current calendar day in `timezone`, as a real UTC instant.
export function startOfDayInTz(timezone: string, at = new Date()): Date {
  const offset = tzOffsetMs(timezone, at);
  const wall = new Date(at.getTime() + offset);
  wall.setUTCHours(0, 0, 0, 0);
  return new Date(wall.getTime() - offset);
}

function isInQuietHours(prefs: EffectivePrefs, at = new Date()): boolean {
  const { hour, day } = wallClock(prefs.timezone, at);
  if (prefs.weekendOff && (day === 0 || day === 6)) return true;
  if (prefs.quietHoursStart === prefs.quietHoursEnd) return false;
  if (prefs.quietHoursStart < prefs.quietHoursEnd) {
    return hour >= prefs.quietHoursStart && hour < prefs.quietHoursEnd;
  }
  // Wraps midnight (e.g. 22 → 8).
  return hour >= prefs.quietHoursStart || hour < prefs.quietHoursEnd;
}

// Next occurrence of the quiet-hours end hour (local morning), as a UTC instant.
function nextMorning(prefs: EffectivePrefs, at = new Date()): Date {
  const start = startOfDayInTz(prefs.timezone, at);
  const offset = tzOffsetMs(prefs.timezone, at);
  let target = new Date(start.getTime() + prefs.quietHoursEnd * 3600_000);
  if (target.getTime() <= at.getTime()) {
    target = new Date(target.getTime() + 24 * 3600_000 - (tzOffsetMs(prefs.timezone, target) - offset));
  }
  return target;
}

// Immediate emails already sent today (org-local calendar day). The alerts table
// records every email channel attempt; sentAt is set only on success.
async function getTodayEmailCount(orgId: string, timezone: string): Promise<number> {
  const dayStart = startOfDayInTz(timezone);
  const [row] = await db
    .select({ value: count() })
    .from(alerts)
    .where(
      and(
        eq(alerts.orgId, orgId),
        eq(alerts.channel, "email"),
        gte(alerts.sentAt, dayStart),
      ),
    );
  return row?.value ?? 0;
}

export async function decideDispatch(
  orgId: string,
  context: NotificationContext,
): Promise<DispatchDecision> {
  const prefs = await getOrgPrefs(orgId);
  const criticalBypass = process.env.NOTIFICATION_CRITICAL_BYPASS !== "false";

  // Critical bypasses EVERY moderation filter (still routed to its configured
  // channel, email_immediate by default).
  if (context.severity === "critical" && criticalBypass) {
    return { send: true, channel: prefs.channelCritical };
  }

  // Layer 1 — relevance threshold. Only signals carrying a score (structured
  // homepage changes) are subject to it; everything else passes through.
  if (context.relevanceScore != null) {
    const threshold = await getOrgThreshold(orgId);
    if (context.relevanceScore < threshold) {
      return { send: false, channel: "muted", filteredReason: "below_threshold" };
    }
  }

  // Layer 2 — channel by severity.
  const channel = channelForSeverity(context.severity, prefs);
  if (channel === "muted") {
    return { send: false, channel: "muted", filteredReason: "channel_muted" };
  }
  // Non-immediate channels skip quiet-hours / frequency-cap (those only gate
  // immediate emails; in-app and digests stay current).
  if (channel !== "email_immediate") {
    return { send: true, channel };
  }

  // Layer 3 — quiet hours → defer to the daily digest.
  if (isInQuietHours(prefs)) {
    return {
      send: true,
      channel: "digest_daily",
      filteredReason: "quiet_hours",
      scheduledFor: nextMorning(prefs),
    };
  }

  // Layer 4 — frequency cap → defer to the daily digest.
  const todayCount = await getTodayEmailCount(orgId, prefs.timezone);
  if (todayCount >= prefs.dailyEmailCap) {
    return {
      send: true,
      channel: "digest_daily",
      filteredReason: "frequency_cap",
      scheduledFor: nextMorning(prefs),
    };
  }

  return { send: true, channel: "email_immediate" };
}
