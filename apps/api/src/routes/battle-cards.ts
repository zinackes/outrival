import { Hono } from "hono";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { tasks } from "@trigger.dev/sdk/v3";
import { battleCards, competitors } from "@outrival/db";
import { getBytesFromR2 } from "@outrival/shared";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { getOrgPlan, isFeatureAllowed } from "../lib/plan";

type Variables = { user: { id: string } };

export const battleCardsRouter = new Hono<{ Variables: Variables }>();

battleCardsRouter.use("*", authMiddleware);

const PatchSchema = z.object({
  content: z.object({
    their_strengths: z.array(z.string()).max(5),
    our_strengths: z.array(z.string()).max(5),
    their_weaknesses: z.array(z.string()).max(5),
    common_objections: z
      .array(z.object({ objection: z.string(), response: z.string() }))
      .max(5),
    when_we_win: z.array(z.string()).max(4),
    when_we_lose: z.array(z.string()).max(4),
  }),
});

async function assertOwnedCompetitor(competitorId: string, orgId: string) {
  return db.query.competitors.findFirst({
    where: and(
      eq(competitors.id, competitorId),
      eq(competitors.orgId, orgId),
      isNull(competitors.deletedAt),
    ),
  });
}

battleCardsRouter.get("/:id/battle-card", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const card = await db.query.battleCards.findFirst({
    where: eq(battleCards.competitorId, competitor.id),
  });
  if (!card) return c.json({ error: "Not generated" }, 404);

  return c.json({ battleCard: card });
});

battleCardsRouter.post("/:id/battle-card/generate", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const plan = await getOrgPlan(orgId);
  if (!isFeatureAllowed(plan, "battleCards")) {
    return c.json({ error: "plan_locked_feature", feature: "battleCards", plan }, 403);
  }

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const handle = await tasks.trigger("generate-battle-card", {
    competitorId: competitor.id,
    orgId,
  });

  return c.json({ status: "generating", runId: handle.id });
});

battleCardsRouter.patch("/:id/battle-card", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const existing = await db.query.battleCards.findFirst({
    where: eq(battleCards.competitorId, competitor.id),
  });
  if (!existing) return c.json({ error: "Not generated" }, 404);

  const [updated] = await db
    .update(battleCards)
    .set({ content: parsed.data.content, updatedAt: new Date() })
    .where(eq(battleCards.id, existing.id))
    .returning();

  return c.json({ battleCard: updated });
});

battleCardsRouter.get("/:id/battle-card/pdf", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const card = await db.query.battleCards.findFirst({
    where: eq(battleCards.competitorId, competitor.id),
  });
  if (!card?.pdfR2Key) return c.json({ error: "PDF not available" }, 404);

  const bytes = await getBytesFromR2(card.pdfR2Key);
  const filename = `battle-card-${competitor.name.replace(/[^\w-]+/g, "-").toLowerCase()}.pdf`;

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, max-age=0",
    },
  });
});
