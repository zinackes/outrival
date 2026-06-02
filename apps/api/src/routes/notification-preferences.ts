import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { orgNotificationPreferences, orgRelevanceThreshold } from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";

// Patch-26: org-scoped notification moderation preferences. Distinct from
// /api/settings/notifications (delivery targets — slack/webhook/digestEmail);
// this resource owns the moderation knobs (channels per severity, quiet hours,
// frequency cap, batching) plus a read-only view of the relevance threshold.

type Variables = { user: { id: string } };

export const notificationPreferencesRouter = new Hono<{ Variables: Variables }>();

notificationPreferencesRouter.use("*", authMiddleware);

const CHANNEL_MODES = [
  "email_immediate",
  "digest_daily",
  "digest_weekly",
  "in_app_only",
  "muted",
] as const;
const channelMode = z.enum(CHANNEL_MODES);

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const PatchSchema = z.object({
  channelCritical: channelMode.optional(),
  channelHigh: channelMode.optional(),
  channelMedium: channelMode.optional(),
  channelLow: channelMode.optional(),
  timezone: z.string().min(1).refine(isValidTimezone, "Invalid IANA timezone").optional(),
  // Present (an ISO string) only when the browser auto-detection hook is writing
  // the timezone. Absent on a manual edit → the handler nulls it to lock the
  // user's choice against future auto-detection.
  timezoneDetectedAt: z.string().datetime().optional(),
  quietHoursStart: z.number().int().min(0).max(23).optional(),
  quietHoursEnd: z.number().int().min(0).max(23).optional(),
  weekendOff: z.boolean().optional(),
  dailyEmailCap: z.number().int().min(1).max(100).optional(),
  batchingEnabled: z.boolean().optional(),
});

async function getOrCreatePrefs(orgId: string) {
  const existing = await db.query.orgNotificationPreferences.findFirst({
    where: eq(orgNotificationPreferences.orgId, orgId),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(orgNotificationPreferences)
    .values({ orgId })
    .onConflictDoNothing()
    .returning();
  // A concurrent insert may have won the unique(orgId) race → re-read.
  return (
    created ??
    (await db.query.orgNotificationPreferences.findFirst({
      where: eq(orgNotificationPreferences.orgId, orgId),
    }))!
  );
}

notificationPreferencesRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const preferences = await getOrCreatePrefs(orgId);
  return c.json({ preferences });
});

notificationPreferencesRouter.patch("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const body = await c.req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  // Ensure a row exists before updating.
  await getOrCreatePrefs(orgId);

  const data = parsed.data;
  const update: Record<string, unknown> = { ...data, updatedAt: new Date() };
  if (data.timezone !== undefined) {
    // Auto-detection sends timezoneDetectedAt; a manual edit doesn't → lock it.
    update.timezoneDetectedAt =
      data.timezoneDetectedAt !== undefined ? new Date(data.timezoneDetectedAt) : null;
  }

  const [updated] = await db
    .update(orgNotificationPreferences)
    .set(update)
    .where(eq(orgNotificationPreferences.orgId, orgId))
    .returning();

  return c.json({ preferences: updated });
});

notificationPreferencesRouter.get("/relevance-threshold", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const row = await db.query.orgRelevanceThreshold.findFirst({
    where: eq(orgRelevanceThreshold.orgId, orgId),
  });

  const defaultThreshold = Number(process.env.RELEVANCE_THRESHOLD_DEFAULT ?? 0.5);
  return c.json({
    threshold: row?.threshold ?? defaultThreshold,
    source: row?.source ?? "default",
    feedbackCountAtCalc: row?.feedbackCountAtCalc ?? 0,
    lastRecalculatedAt: row?.lastRecalculatedAt ?? null,
  });
});
