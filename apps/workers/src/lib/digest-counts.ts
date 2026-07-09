import { and, eq, isNull } from "drizzle-orm";
import { db, competitors, monitors } from "@outrival/db";
import { getWeeklyCheckCount } from "./analytics";

// Internal monitoring anchors with no user-facing meaning (mirrors HIDDEN_SOURCES
// in apps/api/src/routes/activity.ts) — never counted as a "page" Outrival
// watches for the user.
const INTERNAL_SOURCES = new Set(["tech_stack", "sitemap", "news"]);

export interface MonitorRosterRow {
  isActive: boolean;
  sourceType: string;
  competitorType: string;
}

// Pure: how many of an org's monitors count as a user-facing "page" watched —
// active, excluding the internal-only anchors and the org's own self-product.
export function countActivePages(rows: MonitorRosterRow[]): number {
  return rows.filter(
    (r) => r.isActive && r.competitorType !== "self" && !INTERNAL_SOURCES.has(r.sourceType),
  ).length;
}

export interface AllQuietCounts {
  pages: number;
  checks: number;
}

// Counts for the all-quiet weekly briefing (Lever 6): how many pages Outrival
// watches for this org, and (best-effort) how many times it checked them in
// [weekStart, weekEnd).
export async function getAllQuietCounts(
  orgId: string,
  weekStart: Date,
  weekEnd: Date,
): Promise<AllQuietCounts> {
  const rows = await db
    .select({
      competitorId: competitors.id,
      isActive: monitors.isActive,
      sourceType: monitors.sourceType,
      competitorType: competitors.type,
    })
    .from(monitors)
    .innerJoin(competitors, eq(monitors.competitorId, competitors.id))
    .where(and(eq(competitors.orgId, orgId), isNull(competitors.deletedAt)));

  const pages = countActivePages(rows);
  const competitorIds = [...new Set(rows.map((r) => r.competitorId))];
  const checks = await getWeeklyCheckCount(competitorIds, weekStart, weekEnd);

  return { pages, checks };
}
