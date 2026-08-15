import { Hono } from "hono";
import { z } from "zod";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { alertConditions, signals } from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { errorBody } from "../lib/errors";

// Alert conditions (OUT-192) — org-scoped CRUD over the sentences a user writes to say
// what they want flagged. The matching itself happens at signal creation, in the
// workers; this route only owns the rules.

type Variables = { user: { id: string } };

export const alertConditionsRouter = new Hono<{ Variables: Variables }>();

alertConditionsRouter.use("*", authMiddleware);

/** Enough room for a real sentence, short enough to quote back inside a feed row. */
const CONDITION_MAX = 200;
/** Rules past this stop being read by the matcher, so refuse rather than pretend. */
const MAX_CONDITIONS_PER_ORG = 25;

const bodySchema = z.object({
  condition: z.string().trim().min(3).max(CONDITION_MAX),
  isActive: z.boolean().optional(),
});

const patchSchema = bodySchema.partial();

const columns = {
  id: alertConditions.id,
  condition: alertConditions.condition,
  isActive: alertConditions.isActive,
  matchCount: alertConditions.matchCount,
  lastMatchedAt: alertConditions.lastMatchedAt,
  createdAt: alertConditions.createdAt,
};

alertConditionsRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const rows = await db
    .select(columns)
    .from(alertConditions)
    .where(eq(alertConditions.orgId, orgId))
    .orderBy(desc(alertConditions.createdAt));
  return c.json({ data: { conditions: rows, max: MAX_CONDITIONS_PER_ORG } });
});

alertConditionsRouter.post("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json(
      errorBody(
        "invalid_condition",
        `Write the condition in one sentence, up to ${CONDITION_MAX} characters.`,
      ),
      400,
    );
  }

  const [existing] = await db
    .select({ n: count() })
    .from(alertConditions)
    .where(eq(alertConditions.orgId, orgId));
  if ((existing?.n ?? 0) >= MAX_CONDITIONS_PER_ORG) {
    return c.json(
      errorBody(
        "alert_conditions_limit",
        `You can keep ${MAX_CONDITIONS_PER_ORG} alert conditions. Delete one to add another.`,
      ),
      400,
    );
  }

  const [row] = await db
    .insert(alertConditions)
    .values({
      orgId,
      userId: user.id,
      condition: parsed.data.condition,
      isActive: parsed.data.isActive ?? true,
    })
    .returning(columns);
  return c.json({ data: { condition: row } }, 201);
});

alertConditionsRouter.patch("/:id", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json(errorBody("invalid_condition", "That change to the condition isn't valid."), 400);
  }

  const update: { condition?: string; isActive?: boolean; updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (parsed.data.condition !== undefined) update.condition = parsed.data.condition;
  if (parsed.data.isActive !== undefined) update.isActive = parsed.data.isActive;

  const [row] = await db
    .update(alertConditions)
    .set(update)
    .where(and(eq(alertConditions.id, c.req.param("id")), eq(alertConditions.orgId, orgId)))
    .returning(columns);
  if (!row) return c.json(errorBody("not_found", "That condition no longer exists."), 404);
  return c.json({ data: { condition: row } });
});

alertConditionsRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");

  // Signals already flagged by this rule keep their flag and their reason: it was true
  // when it was raised, and rewriting the record to match a deleted rule is how a feed
  // stops being one. Only the id is dropped, so the filter no longer offers it.
  await db
    .update(signals)
    .set({
      matchedConditionIds: sql`coalesce(${signals.matchedConditionIds}, '[]'::jsonb) - ${id}`,
    })
    .where(
      and(
        eq(signals.orgId, orgId),
        sql`${signals.matchedConditionIds} @> ${JSON.stringify([id])}::jsonb`,
      ),
    );

  await db
    .delete(alertConditions)
    .where(and(eq(alertConditions.id, id), eq(alertConditions.orgId, orgId)));
  return c.json({ data: { ok: true } });
});
