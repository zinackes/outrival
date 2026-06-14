import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { organizations, users } from "@outrival/db";
import { ProductProfileSchema } from "@outrival/ai";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { getOrgPlan, isChannelAllowed } from "../lib/plan";
import { isSafeWebhookUrl } from "../lib/crm-webhook";
import { eraseOrg } from "../lib/erase-org";

type Variables = { user: { id: string } };

export const settingsRouter = new Hono<{ Variables: Variables }>();

settingsRouter.use("*", authMiddleware);

// The API and workers POST to these URLs server-side, so they get the same SSRF
// guard as CRM destinations (https only, no loopback / private-range hosts).
const safeWebhookUrl = z
  .string()
  .url()
  .refine(isSafeWebhookUrl, { message: "URL must be https and publicly reachable" });

const PatchSchema = z.object({
  slackWebhookUrl: safeWebhookUrl.nullable().optional(),
  webhookUrl: safeWebhookUrl.nullable().optional(),
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

// Danger zone — permanently erase the workspace (GDPR erasure path). The org
// row cascades most tables; everything holding a non-cascading FK (alerts,
// signals, digests, changes, job_postings, reviews) is torn down explicitly
// first, deepest-first. Users are DETACHED before the org goes: users.org_id
// cascades on delete, and the account itself must survive workspace deletion
// (ensureUserOrg gives the user a fresh empty org on their next request).
settingsRouter.delete("/workspace", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ confirm: z.string() }).safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid body" }, 400);

  const dbUser = await db.query.users.findFirst({ where: eq(users.id, user.id) });
  if (dbUser?.role !== "owner") return c.json({ error: "owner_required" }, 403);

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return c.json({ error: "Not found" }, 404);
  if (parsed.data.confirm !== org.name) {
    return c.json({ error: "confirm_mismatch" }, 400);
  }

  // detachUsers: keep the account alive — ensureUserOrg gives it a fresh org next request.
  await eraseOrg(orgId, { detachUsers: true });

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
