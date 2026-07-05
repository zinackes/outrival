import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { shareLinks, organizations, products } from "@outrival/db";
import { db } from "../lib/db";
import { buildLandscape } from "../lib/landscape-data";

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

  const product = link.productId
    ? await db.query.products.findFirst({
        where: eq(products.id, link.productId),
        columns: { name: true },
      })
    : null;

  const data = await buildLandscape(link.orgId, link.productId ?? undefined);

  c.header("Cache-Control", "public, max-age=300");
  return c.json({
    org: { name: org.name },
    product: product ? { name: product.name } : null,
    generatedAt: new Date().toISOString(),
    ...data,
  });
});
