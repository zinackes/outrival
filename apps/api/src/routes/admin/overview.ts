import { Hono } from "hono";
import { and, gte, isNull, ne, sql } from "drizzle-orm";
import { db, organizations, users, competitors, signals } from "@outrival/db";
import type { AdminVariables } from "./shared";

export const overviewRouter = new Hono<{ Variables: AdminVariables }>();

// --- Overview: orgs by plan, users, tracked competitors, signals (7d) ---
overviewRouter.get("/overview", async (c) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000);
  const [orgsByPlan, userCount, competitorCount, signalCount] = await Promise.all([
    db
      .select({ plan: organizations.plan, count: sql<number>`count(*)::int` })
      .from(organizations)
      .groupBy(organizations.plan),
    db.select({ count: sql<number>`count(*)::int` }).from(users),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(competitors)
      .where(and(isNull(competitors.deletedAt), ne(competitors.type, "self"))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(signals)
      .where(gte(signals.createdAt, sevenDaysAgo)),
  ]);

  return c.json({
    orgsByPlan,
    totalUsers: userCount[0]?.count ?? 0,
    totalCompetitors: competitorCount[0]?.count ?? 0,
    signals7d: signalCount[0]?.count ?? 0,
  });
});
