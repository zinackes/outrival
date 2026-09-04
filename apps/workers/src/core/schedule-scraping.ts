import { logger } from "../lib/job-logger";
import { scrapeMonitor } from "@outrival/queue";
import { and, asc, eq, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { db, monitors, competitors, organizations, products } from "@outrival/db";
import {
  PLAN_LIMITS,
  productLimit,
  planAllowsMonitorSource,
  type Plan,
  type SourceType,
} from "@outrival/shared";
import { rearmableMonitorIds } from "../lib/rearm";
import { spreadOverWindow } from "../lib/burst-spread";

// How long the hourly batch is spread over (R1 of the AI pool reliability audit).
// 3000 s = 50 min, which leaves a 10-minute margin before the next `0 * * * *` fire.
// 0 disables the spread and restores the single-batch behaviour from env.
const SCRAPE_SPREAD_SEC = Number(process.env.SCRAPE_SPREAD_SEC ?? 3000);

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

// Runtime-neutral job body: shared verbatim by the pg-boss handler and the thin
// Trigger.dev wrapper in ../jobs/schedule-scraping.job.ts (deleted at the cutover).
// Only the header, the signature and the fan-out call change.
export async function runScheduleScraping() {
    const now = new Date();
    logger.log("Starting schedule-scraping", { now: now.toISOString() });

    // C2: re-arm monitors that were paused unscrapable after a transient outage.
    // One probe per interval — flip isActive back on and make them due now so the
    // select below enqueues them this run. A later success clears the flag; a
    // fresh failure re-pauses them (onFailure resets lastFailedAt → 7d cooldown).
    const paused = await db.query.monitors.findMany({
      where: and(eq(monitors.isActive, false), eq(monitors.markedUnscrapable, true)),
      columns: {
        id: true,
        isActive: true,
        markedUnscrapable: true,
        lastFailedAt: true,
        sourceType: true,
      },
    });
    const rearmIds = rearmableMonitorIds(paused, now);
    if (rearmIds.length > 0) {
      await db
        .update(monitors)
        .set({ isActive: true, nextRunAt: now })
        .where(inArray(monitors.id, rearmIds));
      logger.log("Re-armed unscrapable monitors", { count: rearmIds.length });
    }

    // Everything that falls due WITHIN the spread window, not just what is due now:
    // this batch is going to run over the next SCRAPE_SPREAD_SEC anyway, and taking
    // only `nextRunAt <= now` would strand the tail of it. A realtime monitor run at
    // :50 gets nextRunAt = :50 + 1 h, which is past the next :00, so it would wait for
    // the hour after that — the spread would have halved its cadence.
    const dueBy = new Date(now.getTime() + Math.max(0, SCRAPE_SPREAD_SEC) * 1000);
    const due = await db.query.monitors.findMany({
      where: and(
        eq(monitors.isActive, true),
        or(isNull(monitors.nextRunAt), lte(monitors.nextRunAt, dueBy)),
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

    // One batch call instead of N sequential triggers, but each row carries its own
    // `startAfter` so the hour arrives as a stream rather than a wall — the queue
    // lane was never the bottleneck, the AI pool behind it was (see lib/burst-spread).
    const spread = spreadOverWindow(enqueueable, SCRAPE_SPREAD_SEC);
    await scrapeMonitor.enqueueMany(
      spread.map(({ item, startAfterSec }) => ({
        data: { monitorId: item.id },
        options: { startAfter: startAfterSec },
      })),
    );

    logger.log("Completed schedule-scraping", {
      enqueued: enqueueable.length,
      capped,
      spreadSec: SCRAPE_SPREAD_SEC,
    });
    return { enqueued: enqueueable.length, total: due.length };
}
