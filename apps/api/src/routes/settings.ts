import { Hono } from "hono";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import {
  organizations,
  users,
  user as authUser,
  competitors,
  monitors,
  signals,
  digests,
  notifications,
  products,
  competitorCandidates,
  battleCards,
  jobPostings,
  reviews,
} from "@outrival/db";
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

// GDPR data portability (Article 20). Assembles the org's meaningful relational
// data server-side, strictly org-scoped, into one JSON document. Excludes binary
// snapshots (R2), scrape internals and append-only analytics — not user content.
settingsRouter.get("/export", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return c.json({ error: "Not found" }, 404);

  const comps = await db.select().from(competitors).where(eq(competitors.orgId, orgId));
  const compIds = comps.map((c2) => c2.id);

  const [sigs, digs, notifs, prods, cands, cards, mons, jobs, revs] = await Promise.all([
    db.select().from(signals).where(eq(signals.orgId, orgId)),
    db.select().from(digests).where(eq(digests.orgId, orgId)),
    db.select().from(notifications).where(eq(notifications.orgId, orgId)),
    db.select().from(products).where(eq(products.orgId, orgId)),
    db.select().from(competitorCandidates).where(eq(competitorCandidates.orgId, orgId)),
    db.select().from(battleCards).where(eq(battleCards.orgId, orgId)),
    compIds.length ? db.select().from(monitors).where(inArray(monitors.competitorId, compIds)) : Promise.resolve([]),
    compIds.length ? db.select().from(jobPostings).where(inArray(jobPostings.competitorId, compIds)) : Promise.resolve([]),
    compIds.length ? db.select().from(reviews).where(inArray(reviews.competitorId, compIds)) : Promise.resolve([]),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    workspace: {
      name: org.name,
      slug: org.slug,
      plan: org.plan,
      productUrl: org.productUrl,
      productProfile: org.productProfile,
      createdAt: org.createdAt,
    },
    competitors: comps,
    monitors: mons,
    signals: sigs,
    digests: digs,
    notifications: notifs,
    products: prods,
    candidates: cands,
    battleCards: cards,
    jobPostings: jobs,
    reviews: revs,
  };

  return c.json(payload);
});

// Delete the user's account (GDPR erasure). Erases the org and its data WITHOUT
// detaching users (so the app `users` row cascades away), then removes the Better
// Auth identity — deleting the `user` row cascades sessions, accounts and 2FA, so
// the session cookie dies and the client lands logged-out.
settingsRouter.delete("/account", async (c) => {
  const user = c.get("user");

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ confirm: z.string() }).safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid body" }, 400);

  const dbUser = await db.query.users.findFirst({ where: eq(users.id, user.id) });
  if (!dbUser) return c.json({ error: "Not found" }, 404);
  if (parsed.data.confirm.trim().toLowerCase() !== dbUser.email.toLowerCase()) {
    return c.json({ error: "confirm_mismatch" }, 400);
  }

  const orgId = await ensureUserOrg(user.id);
  // detachUsers:false → the org delete cascades the app `users` row too.
  await eraseOrg(orgId, { detachUsers: false });
  // Remove the Better Auth identity (cascades session/account/two_factor).
  await db.delete(authUser).where(eq(authUser.id, user.id));

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
