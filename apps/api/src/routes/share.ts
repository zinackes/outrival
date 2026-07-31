import { Hono } from "hono";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { shareLinks, products } from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { primaryProductId } from "../lib/products";

type Variables = { user: { id: string } };

export const shareRouter = new Hono<{ Variables: Variables }>();

shareRouter.use("*", authMiddleware);

// Public read-only share links (Lever 8). Create-or-return a revocable token for an
// artifact (v1: the "landscape" Competitive Snapshot Report, scoped to a product),
// list the org's active links (settings), and revoke. Default OFF: a row only exists
// after this explicit action. See docs/post-onboarding-activation.md + routes/public-report.ts.

const WEB_URL = process.env.WEB_URL ?? "https://outrival.app";
const publicUrl = (token: string) => `${WEB_URL}/report/${token}`;
// 128-bit unguessable capability (two UUIDs, dashes stripped).
const mintToken = () =>
  `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");

// Create or return the org's existing active share link for this (type, product).
// Idempotent so re-clicking "Share" hands back the same URL instead of minting a pile
// of live tokens for the same report.
shareRouter.post("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const body = (await c.req.json().catch(() => ({}))) as {
    type?: unknown;
    productId?: unknown;
    month?: unknown;
  };
  const type = body.type === "recap" ? "recap" : "landscape";

  // Recap link: keyed to a month, no product. Dedupe on (org, recap, meta.month).
  if (type === "recap") {
    const month =
      typeof body.month === "string" && /^\d{4}-\d{2}$/.test(body.month) ? body.month : null;
    if (!month) return c.json({ error: "month_required" }, 400);
    const recaps = await db
      .select({ id: shareLinks.id, token: shareLinks.token, meta: shareLinks.meta })
      .from(shareLinks)
      .where(
        and(eq(shareLinks.orgId, orgId), eq(shareLinks.type, "recap"), isNull(shareLinks.revokedAt)),
      );
    const existing = recaps.find((r) => (r.meta as { month?: string } | null)?.month === month);
    if (existing) {
      return c.json({ id: existing.id, token: existing.token, url: publicUrl(existing.token) });
    }
    const token = mintToken();
    const [row] = await db
      .insert(shareLinks)
      .values({ orgId, type: "recap", meta: { month }, token, createdBy: user.id })
      .returning({ id: shareLinks.id, token: shareLinks.token });
    if (!row) return c.json({ error: "create_failed" }, 500);
    return c.json({ id: row.id, token: row.token, url: publicUrl(row.token) }, 201);
  }

  // Landscape link: scoped to a product (defaults to primary).
  let productId = typeof body.productId === "string" ? body.productId : undefined;
  if (productId) {
    // Archived excluded: minting a public snapshot of a removed product would publish a
    // view the owner can no longer open themselves.
    const owned = await db.query.products.findFirst({
      where: and(
        eq(products.id, productId),
        eq(products.orgId, orgId),
        ne(products.status, "archived"),
      ),
      columns: { id: true },
    });
    if (!owned) return c.json({ error: "not_found" }, 404);
  } else {
    productId = (await primaryProductId(orgId)) ?? undefined;
  }

  const existing = await db.query.shareLinks.findFirst({
    where: and(
      eq(shareLinks.orgId, orgId),
      eq(shareLinks.type, "landscape"),
      productId ? eq(shareLinks.productId, productId) : isNull(shareLinks.productId),
      isNull(shareLinks.revokedAt),
    ),
  });
  if (existing) {
    return c.json({ id: existing.id, token: existing.token, url: publicUrl(existing.token) });
  }

  const token = mintToken();
  const [row] = await db
    .insert(shareLinks)
    .values({ orgId, type: "landscape", productId: productId ?? null, token, createdBy: user.id })
    .returning({ id: shareLinks.id, token: shareLinks.token });
  if (!row) return c.json({ error: "create_failed" }, 500);
  return c.json({ id: row.id, token: row.token, url: publicUrl(row.token) }, 201);
});

// Active links for the settings "Shared reports" list.
shareRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const rows = await db
    .select({
      id: shareLinks.id,
      type: shareLinks.type,
      productId: shareLinks.productId,
      token: shareLinks.token,
      createdAt: shareLinks.createdAt,
    })
    .from(shareLinks)
    .where(and(eq(shareLinks.orgId, orgId), isNull(shareLinks.revokedAt)))
    .orderBy(desc(shareLinks.createdAt));
  return c.json({
    links: rows.map((r) => ({ ...r, url: publicUrl(r.token) })),
  });
});

// Revoke (soft): the token stays dead even if the same report is shared again later.
shareRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");
  await db
    .update(shareLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(shareLinks.id, id), eq(shareLinks.orgId, orgId), isNull(shareLinks.revokedAt)));
  return c.json({ ok: true });
});
