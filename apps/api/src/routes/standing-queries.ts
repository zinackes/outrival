import { Hono } from "hono";
import { z } from "zod";
import { and, count, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { standingQueries, competitors, signals } from "@outrival/db";
import {
  extractQuestionCategories,
  hashSignalIdSet,
  normalizeSignalIdSet,
} from "@outrival/shared";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { getOrgPlan, getPlanLimits } from "../lib/plan";
import { captureServerEvent } from "../lib/posthog";

// Standing queries — a saved Ask answer kept under watch (docs/ask-outrival.md).
// Creation is the ONLY moment entities are extracted: the answer's citations are
// re-validated org-scoped (a forged/foreign id is dropped, exactly like the Ask
// tools), then reduced to the competitor ids + signal categories the re-evaluation
// trigger will match against. Backend plan gating: active queries per org.

type Variables = { user: { id: string } };

export const standingQueriesRouter = new Hono<{ Variables: Variables }>();

standingQueriesRouter.use("*", authMiddleware);

const CitationSchema = z.object({
  type: z.enum(["competitor", "signal"]),
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
});

const CreateSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  answer: z.string().trim().min(1).max(8000),
  citations: z.array(CitationSchema).max(12).default([]),
  context: z
    .object({
      label: z.string().trim().min(1).max(200),
      competitorId: z.string().max(64).optional(),
    })
    .nullish(),
});

async function countActiveQueries(orgId: string, excludeId?: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(standingQueries)
    .where(
      and(
        eq(standingQueries.orgId, orgId),
        eq(standingQueries.isActive, true),
        ...(excludeId ? [ne(standingQueries.id, excludeId)] : []),
      ),
    );
  return row?.value ?? 0;
}

standingQueriesRouter.post("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const parsed = CreateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const { question, answer, citations, context } = parsed.data;

  // Backend plan gating — the cap bounds background AI spend per org.
  const plan = await getOrgPlan(orgId);
  const limit = getPlanLimits(plan).standingQueries;
  const used = await countActiveQueries(orgId);
  if (used >= limit) {
    return c.json({ error: "plan_limit_standing_queries", used, limit, plan }, 403);
  }

  // Idempotent-ish: watching the same question twice returns the existing watch.
  const existing = await db.query.standingQueries.findFirst({
    where: and(
      eq(standingQueries.orgId, orgId),
      eq(standingQueries.userId, user.id),
      eq(standingQueries.question, question),
      eq(standingQueries.isActive, true),
    ),
  });
  if (existing) return c.json({ query: existing, existed: true });

  // Re-validate every citation inside the org — never trust client-supplied ids.
  const competitorIds = citations.filter((x) => x.type === "competitor").map((x) => x.id);
  const signalIds = citations.filter((x) => x.type === "signal").map((x) => x.id);

  const ownedCompetitors =
    competitorIds.length > 0
      ? await db.query.competitors.findMany({
          where: and(
            inArray(competitors.id, competitorIds),
            eq(competitors.orgId, orgId),
            isNull(competitors.deletedAt),
          ),
          columns: { id: true, name: true },
        })
      : [];
  const ownedSignals =
    signalIds.length > 0
      ? await db.query.signals.findMany({
          where: and(inArray(signals.id, signalIds), eq(signals.orgId, orgId)),
          columns: { id: true, competitorId: true, category: true },
        })
      : [];

  const competitorNames = new Map(ownedCompetitors.map((x) => [x.id, x.name]));
  const ownedSignalById = new Map(ownedSignals.map((x) => [x.id, x]));
  const validCitations = citations
    .filter((x) =>
      x.type === "competitor" ? competitorNames.has(x.id) : ownedSignalById.has(x.id),
    )
    .map((x) =>
      x.type === "competitor" ? { ...x, label: competitorNames.get(x.id)! } : x,
    );

  // Watched entities, extracted once. Empty arrays = wildcard (org-wide / any category).
  const watchedCompetitorIds = [
    ...new Set([
      ...ownedCompetitors.map((x) => x.id),
      ...ownedSignals.map((x) => x.competitorId),
    ]),
  ];
  const watchedCategories = [
    ...new Set([
      ...ownedSignals.map((x) => x.category as string),
      ...extractQuestionCategories(question),
    ]),
  ];

  const currentSignalIds = normalizeSignalIdSet(
    validCitations.filter((x) => x.type === "signal").map((x) => x.id),
  );

  const [created] = await db
    .insert(standingQueries)
    .values({
      orgId,
      userId: user.id,
      question,
      context: context ?? null,
      watchedCompetitorIds,
      watchedCategories,
      currentAnswer: answer,
      currentCitations: validCitations,
      currentSignalIds,
      currentHash: hashSignalIdSet(currentSignalIds),
    })
    .returning();

  void captureServerEvent(user.id, "standing_query_created", {
    orgId,
    watchedCompetitors: watchedCompetitorIds.length,
    watchedCategories: watchedCategories.length,
    citedSignals: currentSignalIds.length,
  });

  return c.json({ query: created });
});

standingQueriesRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const queries = await db.query.standingQueries.findMany({
    where: and(eq(standingQueries.orgId, orgId), eq(standingQueries.userId, user.id)),
    orderBy: desc(standingQueries.createdAt),
    limit: 100,
  });
  return c.json({ queries });
});

standingQueriesRouter.patch("/:id", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const body = z
    .object({ isActive: z.boolean() })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "invalid_body" }, 400);

  const id = c.req.param("id");
  const query = await db.query.standingQueries.findFirst({
    where: and(eq(standingQueries.id, id), eq(standingQueries.orgId, orgId)),
  });
  if (!query) return c.json({ error: "not_found" }, 404);

  // Resuming a paused watch re-enters the plan cap — same gate as creation.
  if (body.data.isActive && !query.isActive) {
    const plan = await getOrgPlan(orgId);
    const limit = getPlanLimits(plan).standingQueries;
    const used = await countActiveQueries(orgId, id);
    if (used >= limit) {
      return c.json({ error: "plan_limit_standing_queries", used, limit, plan }, 403);
    }
  }

  const [updated] = await db
    .update(standingQueries)
    .set({ isActive: body.data.isActive, updatedAt: new Date() })
    .where(and(eq(standingQueries.id, id), eq(standingQueries.orgId, orgId)))
    .returning();
  return c.json({ query: updated });
});

standingQueriesRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");
  const deleted = await db
    .delete(standingQueries)
    .where(and(eq(standingQueries.id, id), eq(standingQueries.orgId, orgId)))
    .returning({ id: standingQueries.id });
  if (deleted.length === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ deleted: true });
});
