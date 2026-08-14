import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { shareLinks, organizations, products, competitors, battleCards } from "@outrival/db";
import type { BattleCardContent } from "@outrival/ai";
import { db } from "../lib/db";
import { buildLandscape } from "../lib/landscape-data";
import { buildMonthlyRecap } from "../lib/monthly-recap";

// PUBLIC (no auth) resolver for a share token → the "Competitive Snapshot Report"
// (Lever 8). Mounted OUTSIDE authMiddleware. The token is the only capability: a
// revoked or unknown token 404s, and nothing here reads a session, so there is no
// tenant surface beyond the single org+product the token points to. Best-effort data
// (buildLandscape never throws); a short public cache since a shared report doesn't
// need to be live. See docs/post-onboarding-activation.md.
export const publicReportRouter = new Hono();

publicReportRouter.get("/:token", async (c) => {
  const token = c.req.param("token");
  // Cheap sanity bound before hitting the DB (real tokens are 64 hex chars).
  if (!token || token.length < 16 || token.length > 128) {
    return c.json({ error: "not_found" }, 404);
  }

  const link = await db.query.shareLinks.findFirst({
    where: and(eq(shareLinks.token, token), isNull(shareLinks.revokedAt)),
  });
  if (!link) return c.json({ error: "not_found" }, 404);

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, link.orgId),
    columns: { name: true },
  });
  if (!org) return c.json({ error: "not_found" }, 404);

  c.header("Cache-Control", "public, max-age=300");

  // Recap share (Lever 9): the shared "Wrapped". Month is pinned in the link's meta.
  if (link.type === "recap") {
    const month = (link.meta as { month?: string } | null)?.month;
    const recap = await buildMonthlyRecap(link.orgId, month);
    return c.json({ kind: "recap", org: { name: org.name }, recap });
  }

  // Battle card share (OUT-193). The token names a (product, competitor) couple, not a
  // card row, so the reader always gets the CURRENT card — including one the nightly
  // auto-refresh rewrote after the link was sent. A couple whose card was deleted
  // 404s rather than rendering an empty shell.
  if (link.type === "battle_card") {
    const competitorId = (link.meta as { competitorId?: string } | null)?.competitorId;
    if (!competitorId) return c.json({ error: "not_found" }, 404);

    const competitor = await db.query.competitors.findFirst({
      where: and(
        eq(competitors.id, competitorId),
        eq(competitors.orgId, link.orgId),
        isNull(competitors.deletedAt),
      ),
      columns: { name: true },
    });
    if (!competitor) return c.json({ error: "not_found" }, 404);

    const card = await db.query.battleCards.findFirst({
      where: link.productId
        ? and(
            eq(battleCards.competitorId, competitorId),
            eq(battleCards.productId, link.productId),
          )
        : eq(battleCards.competitorId, competitorId),
      columns: { content: true, generatedAt: true },
    });
    if (!card) return c.json({ error: "not_found" }, 404);

    const cardProduct = link.productId
      ? await db.query.products.findFirst({
          where: eq(products.id, link.productId),
          columns: { name: true },
        })
      : null;

    return c.json({
      kind: "battle_card",
      org: { name: org.name },
      product: cardProduct ? { name: cardProduct.name } : null,
      competitor: { name: competitor.name },
      generatedAt: card.generatedAt,
      content: card.content as BattleCardContent,
    });
  }

  // Landscape share (Lever 8): the "Competitive Snapshot Report".
  const product = link.productId
    ? await db.query.products.findFirst({
        where: eq(products.id, link.productId),
        columns: { name: true },
      })
    : null;
  const data = await buildLandscape(link.orgId, link.productId ?? undefined);
  return c.json({
    kind: "landscape",
    org: { name: org.name },
    product: product ? { name: product.name } : null,
    generatedAt: new Date().toISOString(),
    ...data,
  });
});
