import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { organizations } from "@outrival/db";
import { ProductProfileSchema } from "@outrival/ai";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { getOrgPlan, isChannelAllowed } from "../lib/plan";

type Variables = { user: { id: string } };

export const settingsRouter = new Hono<{ Variables: Variables }>();

settingsRouter.use("*", authMiddleware);

const PatchSchema = z.object({
  slackWebhookUrl: z.string().url().nullable().optional(),
  webhookUrl: z.string().url().nullable().optional(),
  digestEmail: z.string().email().nullable().optional(),
  digestEnabled: z.boolean().optional(),
  alertsEnabled: z.boolean().optional(),
});

const WorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  productUrl: z.string().url().optional(),
  productProfile: ProductProfileSchema.optional(),
});

settingsRouter.get("/workspace", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return c.json({ error: "Not found" }, 404);

  return c.json({
    name: org.name,
    slug: org.slug,
    productUrl: org.productUrl,
    productProfile: org.productProfile,
    projectStage: org.projectStage,
  });
});

settingsRouter.patch("/workspace", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const body = await c.req.json().catch(() => null);
  const parsed = WorkspaceSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.productUrl !== undefined) update.productUrl = parsed.data.productUrl;
  if (parsed.data.productProfile !== undefined) update.productProfile = parsed.data.productProfile;
  update.updatedAt = new Date();

  await db.update(organizations).set(update).where(eq(organizations.id, orgId));
  return c.json({ ok: true });
});

settingsRouter.get("/notifications", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return c.json({ error: "Not found" }, 404);

  return c.json({
    slackWebhookUrl: org.slackWebhookUrl,
    webhookUrl: org.webhookUrl,
    digestEmail: org.digestEmail,
    digestEnabled: org.digestEnabled,
    alertsEnabled: org.alertsEnabled,
  });
});

settingsRouter.patch("/notifications", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const body = await c.req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  if (parsed.data.slackWebhookUrl || parsed.data.webhookUrl) {
    const plan = await getOrgPlan(orgId);
    if (parsed.data.slackWebhookUrl && !isChannelAllowed(plan, "slack")) {
      return c.json({ error: "plan_locked_channel", channel: "slack", plan }, 403);
    }
    if (parsed.data.webhookUrl && !isChannelAllowed(plan, "webhook")) {
      return c.json({ error: "plan_locked_channel", channel: "webhook", plan }, 403);
    }
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.slackWebhookUrl !== undefined) update.slackWebhookUrl = parsed.data.slackWebhookUrl;
  if (parsed.data.webhookUrl !== undefined) update.webhookUrl = parsed.data.webhookUrl;
  if (parsed.data.digestEmail !== undefined) update.digestEmail = parsed.data.digestEmail;
  if (parsed.data.digestEnabled !== undefined) update.digestEnabled = parsed.data.digestEnabled;
  if (parsed.data.alertsEnabled !== undefined) update.alertsEnabled = parsed.data.alertsEnabled;
  update.updatedAt = new Date();

  await db.update(organizations).set(update).where(eq(organizations.id, orgId));
  return c.json({ ok: true });
});
