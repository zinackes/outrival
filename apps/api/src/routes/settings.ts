import { Hono } from "hono";
import { z } from "zod";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
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
import {
  SOURCE_TYPES,
  SELECTABLE_DEFAULT_SOURCES,
  DEFAULT_SEED_SOURCES,
  resolveSeedSources,
  defaultSourcesForPlan,
  resolveMeterUnit,
  meterUnitLabel,
  CANONICAL_METER_UNITS,
  REFERENCE_VOLUME_PRESETS,
} from "@outrival/shared";
import { db } from "../lib/db";
import { analyticsQuery, sql } from "../lib/analytics-safe";
import {
  applyDefaultSourcesToExisting,
  defaultSourceGaps,
} from "../lib/seed-monitors";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { getOrgPlan, isChannelAllowed } from "../lib/plan";
import { isSafeWebhookUrl } from "../lib/crm-webhook";
import { eraseOrg } from "../lib/erase-org";
import { sendReauthCode, verifyReauthCode } from "../lib/reauth";

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
// Step-up re-auth: email a confirmation code before a destructive action.
settingsRouter.post("/reauth/send", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json().catch(() => ({}))) as { purpose?: unknown };
  const purpose = body.purpose === "password" ? "password" : "destructive";
  await sendReauthCode(user.id, purpose);
  // Identical response regardless — the email either arrives or it doesn't.
  return c.json({ ok: true });
});

settingsRouter.delete("/workspace", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ confirm: z.string(), code: z.string() }).safeParse(body);
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
  if (!(await verifyReauthCode(user.id, parsed.data.code))) {
    return c.json({ error: "reauth_failed" }, 400);
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
  const parsed = z.object({ confirm: z.string(), code: z.string() }).safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid body" }, 400);

  const dbUser = await db.query.users.findFirst({ where: eq(users.id, user.id) });
  if (!dbUser) return c.json({ error: "Not found" }, 404);
  if (parsed.data.confirm.trim().toLowerCase() !== dbUser.email.toLowerCase()) {
    return c.json({ error: "confirm_mismatch" }, 400);
  }
  if (!(await verifyReauthCode(user.id, parsed.data.code))) {
    return c.json({ error: "reauth_failed" }, 400);
  }

  const orgId = await ensureUserOrg(user.id);
  // detachUsers:false → the org delete cascades the app `users` row too.
  await eraseOrg(orgId, { detachUsers: false });
  // Remove the Better Auth identity (cascades session/account/two_factor).
  await db.delete(authUser).where(eq(authUser.id, user.id));

  return c.json({ ok: true });
});

// Monitoring defaults — which sources a NEW competitor starts with, plus the
// retroactive half (existing competitors predate the setting, and an upgrade widens
// what the plan allows without touching anything already created).

const SourceDefaultsSchema = z.object({
  // null resets to the built-in default set, so an org that opts back in keeps
  // inheriting future additions instead of freezing today's list.
  defaultSources: z.array(z.enum(SOURCE_TYPES)).nullable(),
});

/** The org's competitor ids — the population every gap/apply operation runs over. */
async function orgCompetitorIds(orgId: string): Promise<string[]> {
  const rows = await db
    .select({ id: competitors.id })
    .from(competitors)
    .where(
      and(
        eq(competitors.orgId, orgId),
        isNull(competitors.deletedAt),
        // The self-product is monitored through its own flow (My Product), with a
        // source set that depends on the project stage. It must never be swept up
        // by a competitor-wide default.
        ne(competitors.type, "self"),
      ),
    );
  return rows.map((r) => r.id);
}

settingsRouter.get("/sources", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const plan = await getOrgPlan(orgId);

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { defaultSources: true },
  });
  const stored = org?.defaultSources ?? null;
  const competitorIds = await orgCompetitorIds(orgId);
  const gaps = await defaultSourceGaps({ plan, orgDefaultSources: stored, competitorIds });

  return c.json({
    plan,
    // Three distinct things, and the UI needs all three: what the org stored (null =
    // following the built-in default), what it INTENDS (stored, or the built-in set)
    // — the checkbox state, and what a plan-locked source must be saved back as so
    // toggling a neighbour can't silently erase it — and what that resolves to on
    // this plan today.
    defaultSources: stored,
    intendedSources: stored ?? [...DEFAULT_SEED_SOURCES],
    effectiveSources: resolveSeedSources(plan, stored),
    // Everything offerable at this plan, plus the whole catalogue so the screen can
    // show what an upgrade would add rather than hiding it. Both cover the
    // detection-seeded sources (App Store reviews) too: they are the same stored
    // preference, they just wait for detection to hand over the URL.
    availableSources: defaultSourcesForPlan(plan),
    selectableSources: SELECTABLE_DEFAULT_SOURCES,
    competitorCount: competitorIds.length,
    gaps,
  });
});

settingsRouter.patch("/sources", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const body = await c.req.json().catch(() => null);
  const parsed = SourceDefaultsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  // Store only sources something actually reads: what can be seeded blind, plus what
  // detection seeds once it has resolved the URL (App Store reviews). A source above
  // the plan is KEPT on purpose (it starts applying the day the org upgrades); a
  // source nothing ever seeds is dropped — a stored value nothing reads is a lie the
  // settings screen would keep showing.
  const next =
    parsed.data.defaultSources === null
      ? null
      : parsed.data.defaultSources.filter((s) => SELECTABLE_DEFAULT_SOURCES.includes(s));

  await db
    .update(organizations)
    .set({ defaultSources: next, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));

  return c.json({ ok: true, defaultSources: next });
});

// Reference volumes — the quantities this workspace compares metered pricing
// at. Purely a READ-SIDE setting: the cost at a custom volume is computed from
// the same model that wrote the stored points, so changing it never re-scrapes
// anything and never invalidates what was captured.

// Enough to cover a couple of meters at a couple of volumes. Past that the
// price lens is a spreadsheet, not a comparison.
const MAX_REFERENCE_VOLUMES = 8;

const ReferenceVolumesSchema = z.object({
  // null resets to the presets, so a workspace that opts back in keeps
  // inheriting future changes to them instead of freezing today's list.
  referenceVolumes: z
    .array(z.object({ unit: z.string().min(1), qty: z.number().positive().finite() }))
    .nullable(),
});

/**
 * The meters this workspace's own roster is actually charged on.
 *
 * The picker offers the whole canonical catalog, which let a workspace set a
 * volume on a unit nobody it tracks bills for — a setting that then reads as
 * broken, because no comparison anywhere can move. Marking the ones the roster
 * meters is what tells those two cases apart before the volume is saved.
 *
 * Both provenances count: a published usage rate, and a cost measured on a
 * calculator — a page priced only by its calculator publishes no usage row at
 * all, so reading the rates alone would miss the meter entirely.
 *
 * Best-effort like every analytics read: on failure the set is empty and the
 * picker simply offers the catalog ungrouped, as it did before.
 */
async function rosterMeterUnits(orgId: string): Promise<Set<string>> {
  const owned = await db
    .select({ id: competitors.id })
    .from(competitors)
    .where(and(eq(competitors.orgId, orgId), isNull(competitors.deletedAt)));
  const out = new Set<string>();
  if (owned.length === 0) return out;

  const idList = sql.join(
    owned.map((o) => sql`${o.id}`),
    sql`, `,
  );
  const rows = await analyticsQuery<{ unit: string | null }>(sql`
    SELECT DISTINCT unit FROM pricing_history
    WHERE competitor_id IN (${idList}) AND origin = 'live'
      AND billing_period = 'usage' AND unit IS NOT NULL
    UNION
    SELECT DISTINCT meter_unit AS unit FROM price_points
    WHERE competitor_id IN (${idList}) AND meter_unit IS NOT NULL
  `);
  for (const r of rows) {
    const meter = r.unit ? resolveMeterUnit(r.unit) : null;
    if (meter?.canonical) out.add(meter.unit);
  }
  return out;
}

settingsRouter.get("/reference-volumes", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const [org, roster] = await Promise.all([
    db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
      columns: { referenceVolumes: true },
    }),
    rosterMeterUnits(orgId),
  ]);

  return c.json({
    // What the org stored (null = following the presets), and the vocabulary the
    // picker offers — a meter outside it has no comparable cost to read.
    referenceVolumes: org?.referenceVolumes ?? null,
    presetQuantities: REFERENCE_VOLUME_PRESETS,
    // Roster meters first: the ones a stored volume can actually change. The rest
    // stay offered — a competitor added tomorrow may bill on one of them — but
    // behind the ones that read today.
    units: [...CANONICAL_METER_UNITS]
      .map((unit) => ({
        unit,
        label: meterUnitLabel(unit, 2),
        inRoster: roster.has(unit),
      }))
      .sort((a, b) =>
        a.inRoster === b.inRoster ? a.label.localeCompare(b.label) : a.inRoster ? -1 : 1,
      ),
  });
});

settingsRouter.patch("/reference-volumes", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const body = await c.req.json().catch(() => null);
  const parsed = ReferenceVolumesSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  // Store canonical meters only, deduped. A unit we cannot normalise has no
  // comparable cost anywhere in the product, so keeping it would leave a
  // setting that nothing reads and that the screen would keep showing back.
  let next: Array<{ unit: string; qty: number }> | null = null;
  if (parsed.data.referenceVolumes !== null) {
    const seen = new Set<string>();
    next = [];
    for (const entry of parsed.data.referenceVolumes) {
      const meter = resolveMeterUnit(entry.unit);
      if (!meter?.canonical) continue;
      const key = `${meter.unit}|${entry.qty}`;
      if (seen.has(key)) continue;
      seen.add(key);
      next.push({ unit: meter.unit, qty: entry.qty });
      if (next.length >= MAX_REFERENCE_VOLUMES) break;
    }
  }

  await db
    .update(organizations)
    .set({ referenceVolumes: next, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));

  return c.json({ ok: true, referenceVolumes: next });
});

settingsRouter.post("/sources/apply", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const plan = await getOrgPlan(orgId);

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { defaultSources: true },
  });
  const competitorIds = await orgCompetitorIds(orgId);
  const result = await applyDefaultSourcesToExisting({
    plan,
    orgDefaultSources: org?.defaultSources ?? null,
    competitorIds,
  });

  return c.json(result);
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
