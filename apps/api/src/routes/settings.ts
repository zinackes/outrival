import { Hono } from "hono";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { organizations, users } from "@outrival/db";
import { ProductProfileSchema } from "@outrival/ai";
import { deleteManyFromR2, logger } from "@outrival/shared";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { getOrgPlan, isChannelAllowed } from "../lib/plan";
import { isSafeWebhookUrl } from "../lib/crm-webhook";
import { getStripe } from "../lib/stripe";

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

  // Stop billing first — best-effort, deletion proceeds regardless (the
  // subscription row disappears with the org either way; an orphaned Stripe
  // sub is recoverable from the Stripe dashboard, a half-deleted org is not).
  if (org.stripeSubscriptionId) {
    try {
      await getStripe().subscriptions.cancel(org.stripeSubscriptionId);
    } catch (err) {
      logger.error({ err, orgId }, "Stripe cancel failed during workspace deletion");
    }
  }

  // Capture binary/analytics references before the rows cascade away.
  const snapKeys = (await db.execute(sql`
    SELECT sn.r2_key FROM snapshots sn
    JOIN monitors m ON m.id = sn.monitor_id
    JOIN competitors c2 ON c2.id = m.competitor_id
    WHERE c2.org_id = ${orgId}`)) as unknown as Array<{ r2_key: string }>;
  const cardKeys = (await db.execute(sql`
    SELECT pdf_r2_key FROM battle_cards
    WHERE org_id = ${orgId} AND pdf_r2_key IS NOT NULL`)) as unknown as Array<{
    pdf_r2_key: string;
  }>;
  const competitorIds = (
    (await db.execute(sql`
      SELECT id FROM competitors WHERE org_id = ${orgId}`)) as unknown as Array<{ id: string }>
  ).map((r) => r.id);

  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM alerts WHERE org_id = ${orgId}`);
    await tx.execute(sql`DELETE FROM signals WHERE org_id = ${orgId}`);
    await tx.execute(sql`DELETE FROM digests WHERE org_id = ${orgId}`);
    await tx.execute(sql`
      DELETE FROM changes WHERE monitor_id IN (
        SELECT m.id FROM monitors m
        JOIN competitors c2 ON c2.id = m.competitor_id
        WHERE c2.org_id = ${orgId})`);
    await tx.execute(sql`
      DELETE FROM job_postings WHERE competitor_id IN (
        SELECT id FROM competitors WHERE org_id = ${orgId})`);
    await tx.execute(sql`
      DELETE FROM reviews WHERE competitor_id IN (
        SELECT id FROM competitors WHERE org_id = ${orgId})`);
    await tx.execute(sql`UPDATE users SET org_id = NULL WHERE org_id = ${orgId}`);
    await tx.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`);
  });

  // Best-effort cleanup of the no-FK analytics history and R2 objects: the
  // workspace is already gone, leftovers are storage cost, never dangling UI.
  try {
    await db.execute(sql`DELETE FROM signal_feed WHERE org_id = ${orgId}`);
    if (competitorIds.length > 0) {
      for (const table of [
        "pricing_history",
        "job_counts",
        "review_scores",
        "numeric_claims",
        "tech_stack_history",
      ] as const) {
        await db.execute(sql`
          DELETE FROM ${sql.identifier(table)}
          WHERE competitor_id = ANY(${competitorIds})`);
      }
    }
  } catch (err) {
    logger.error({ err, orgId }, "Analytics cleanup failed during workspace deletion");
  }
  try {
    const keys = [
      ...snapKeys.map((r) => r.r2_key).filter(Boolean),
      ...snapKeys.map((r) => r.r2_key?.replace(/\.html$/, ".png")).filter(Boolean),
      ...cardKeys.map((r) => r.pdf_r2_key).filter(Boolean),
    ];
    if (keys.length > 0) await deleteManyFromR2(keys);
  } catch (err) {
    logger.error({ err, orgId }, "R2 cleanup failed during workspace deletion");
  }

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
