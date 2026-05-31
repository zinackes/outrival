import { Hono } from "hono";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { competitors, signals, digests } from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";

type Variables = { user: { id: string } };

export const searchRouter = new Hono<{ Variables: Variables }>();

searchRouter.use("*", authMiddleware);

const PER_GROUP = 6;
const MIN_QUERY = 2;

// Escape ILIKE wildcards (% _ \) so user input is matched literally.
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

// Global full-text search scoped to the caller's org. Returns up to PER_GROUP
// rows per entity type for a ⌘K command palette — competitors, signals, digests.
searchRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const q = (c.req.query("q") ?? "").trim();
  if (q.length < MIN_QUERY) {
    return c.json({ competitors: [], signals: [], digests: [] });
  }
  const pat = likePattern(q);

  const [competitorRows, signalRows, digestRows] = await Promise.all([
    db
      .select({
        id: competitors.id,
        name: competitors.name,
        url: competitors.url,
        category: competitors.category,
      })
      .from(competitors)
      .where(
        and(
          eq(competitors.orgId, orgId),
          isNull(competitors.deletedAt),
          or(
            ilike(competitors.name, pat),
            ilike(competitors.description, pat),
            ilike(competitors.category, pat),
            ilike(competitors.aiSummary, pat),
          ),
        ),
      )
      .orderBy(desc(competitors.updatedAt))
      .limit(PER_GROUP),
    db
      .select({
        id: signals.id,
        competitorId: signals.competitorId,
        competitorName: competitors.name,
        category: signals.category,
        severity: signals.severity,
        insight: signals.insight,
        createdAt: signals.createdAt,
      })
      .from(signals)
      .innerJoin(competitors, eq(competitors.id, signals.competitorId))
      .where(
        and(
          eq(signals.orgId, orgId),
          or(
            ilike(signals.insight, pat),
            ilike(signals.soWhat, pat),
            ilike(signals.recommendedAction, pat),
          ),
        ),
      )
      .orderBy(desc(signals.createdAt))
      .limit(PER_GROUP),
    db
      .select({
        id: digests.id,
        weekStart: digests.weekStart,
        weekEnd: digests.weekEnd,
        temperature: digests.temperature,
      })
      .from(digests)
      .where(and(eq(digests.orgId, orgId), sql`${digests.content}::text ilike ${pat}`))
      .orderBy(desc(digests.weekStart))
      .limit(PER_GROUP),
  ]);

  return c.json({
    competitors: competitorRows,
    signals: signalRows,
    digests: digestRows,
  });
});
