import { schedules, logger, tasks } from "@trigger.dev/sdk/v3";
import { and, asc, eq, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { db, monitors, competitors, organizations, products } from "@outrival/db";
import {
  PLAN_LIMITS,
  productLimit,
  planAllowsMonitorSource,
  type Plan,
  type SourceType,
} from "@outrival/shared";
import { SCRAPE_SLOW_QUEUE_NAME, SLOW_LANE_MIN_LEVEL } from "../lib/scrape-queues";

type DueMonitor = {
  id: string;
  competitorId: string;
  requiresLevel: number | null;
  sourceType: SourceType;
};

// Plan-aware enqueue gate (tier-limits). A downgraded org keeps every row it ever
// added, but we must not keep paying to scrape/classify beyond its current tier.
// Three soft, reversible caps applied here at enqueue time — we never mutate rows,
// so re-upgrading restores the full set on the next cycle:
//   1. competitors — only the oldest `maxCompetitors` real competitors per org.
//   2. sources     — premium sources (jobs/reviews/status) freeze once the plan no
//                    longer includes them; internal anchors are never gated.
//   3. products    — only the first `productLimit` SKUs (primary first) stay
//                    monitored; the self-competitor of an over-cap SKU is frozen.
// The self-competitor (the user's own product) never counts against the competitor
// quota; a legacy self-competitor not backed by any product row is always enqueued.
async function selectWithinPlanCap<T extends DueMonitor>(due: T[]): Promise<T[]> {
  const competitorIds = [...new Set(due.map((m) => m.competitorId))];
  const comps = await db.query.competitors.findMany({
    where: inArray(competitors.id, competitorIds),
    columns: { id: true, orgId: true, type: true, monitoringPaused: true },
  });
  const byId = new Map(comps.map((c) => [c.id, c]));
  const orgIds = [...new Set(comps.map((c) => c.orgId))];
  if (orgIds.length === 0) return due;

  const orgs = await db.query.organizations.findMany({
    where: inArray(organizations.id, orgIds),
    columns: { id: true, plan: true },
  });
  const planByOrg = new Map<string, Plan>(orgs.map((o) => [o.id, o.plan]));

  // Competitor cap: every real (non-self, non-deleted) competitor of the affected
  // orgs, oldest first — keep the oldest `maxCompetitors` per org (set up first).
  const ranked = await db.query.competitors.findMany({
    where: and(
      inArray(competitors.orgId, orgIds),
      isNull(competitors.deletedAt),
      ne(competitors.type, "self"),
    ),
    columns: { id: true, orgId: true },
    orderBy: [asc(competitors.orgId), asc(competitors.createdAt)],
  });
  const inCap = new Set<string>();
  const countByOrg = new Map<string, number>();
  for (const c of ranked) {
    const used = countByOrg.get(c.orgId) ?? 0;
    const plan = planByOrg.get(c.orgId) ?? "free";
    if (used < PLAN_LIMITS[plan].maxCompetitors) {
      inCap.add(c.id);
      countByOrg.set(c.orgId, used + 1);
    }
  }

  // Product cap: the first `productLimit` active SKUs per org (primary first, then
  // display order) keep their self-competitor monitored. `selfManaged` = every self
  // backed by an active product, so a legacy self with no product row stays enqueued.
  const prods = await db.query.products.findMany({
    where: and(inArray(products.orgId, orgIds), ne(products.status, "archived")),
    columns: {
      orgId: true,
      selfCompetitorId: true,
      isPrimary: true,
      position: true,
      createdAt: true,
    },
  });
  const prodsByOrg = new Map<string, typeof prods>();
  const selfManaged = new Set<string>();
  for (const p of prods) {
    selfManaged.add(p.selfCompetitorId);
    const arr = prodsByOrg.get(p.orgId);
    if (arr) arr.push(p);
    else prodsByOrg.set(p.orgId, [p]);
  }
  const selfInCap = new Set<string>();
  for (const [orgId, ps] of prodsByOrg) {
    ps.sort(
      (a, b) =>
        Number(b.isPrimary) - Number(a.isPrimary) ||
        a.position - b.position ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const limit = productLimit(planByOrg.get(orgId) ?? "free");
    for (const p of ps.slice(0, limit)) selfInCap.add(p.selfCompetitorId);
  }

  return due.filter((m) => {
    const comp = byId.get(m.competitorId);
    if (!comp) return false; // competitor deleted out from under the monitor — skip
    if (comp.monitoringPaused) return false; // user-paused → skip every source
    const plan = planByOrg.get(comp.orgId) ?? "free";
    if (comp.type === "self") {
      // Keep self-competitors of in-cap SKUs; legacy ones (no product row) too.
      return !selfManaged.has(comp.id) || selfInCap.has(comp.id);
    }
    // Real competitor: within the competitor cap AND on a source the plan entitles.
    return inCap.has(comp.id) && planAllowsMonitorSource(plan, m.sourceType);
  });
}

export const scheduleScrapingJob = schedules.task({
  id: "schedule-scraping",
  cron: "0 * * * *",
  maxDuration: 120,

  async run() {
    const now = new Date();
    logger.log("Starting schedule-scraping", { now: now.toISOString() });

    const due = await db.query.monitors.findMany({
      where: and(
        eq(monitors.isActive, true),
        or(isNull(monitors.nextRunAt), lte(monitors.nextRunAt, now)),
      ),
      columns: { id: true, competitorId: true, requiresLevel: true, sourceType: true },
    });

    logger.log("Monitors due", { count: due.length });

    if (due.length === 0) {
      logger.log("Completed schedule-scraping", { enqueued: 0 });
      return { enqueued: 0, total: 0 };
    }

    const enqueueable = await selectWithinPlanCap(due);
    const capped = due.length - enqueueable.length;

    if (enqueueable.length === 0) {
      logger.log("Completed schedule-scraping", { enqueued: 0, capped });
      return { enqueued: 0, total: due.length };
    }

    // One batch call instead of N sequential triggers. Actual execution is
    // throttled by the scrape-monitor queue (concurrencyLimit). Learned-slow
    // monitors (L3 residential / L4 Camoufox) are routed to the bounded slow lane
    // so they can't fill the fast lane and starve other orgs (head-of-line block).
    const slowCount = enqueueable.filter(
      (m) => m.requiresLevel != null && m.requiresLevel >= SLOW_LANE_MIN_LEVEL,
    ).length;
    await tasks.batchTrigger(
      "scrape-monitor",
      enqueueable.map((monitor) => ({
        payload: { monitorId: monitor.id },
        ...(monitor.requiresLevel != null && monitor.requiresLevel >= SLOW_LANE_MIN_LEVEL
          ? { options: { queue: SCRAPE_SLOW_QUEUE_NAME } }
          : {}),
      })),
    );

    logger.log("Completed schedule-scraping", {
      enqueued: enqueueable.length,
      slowLane: slowCount,
      capped,
    });
    return { enqueued: enqueueable.length, total: due.length };
  },
});
