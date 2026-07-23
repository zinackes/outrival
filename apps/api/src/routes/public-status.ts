import { Hono } from "hono";
import { sql as dsql } from "drizzle-orm";
import { checkGlobalBreaker } from "@outrival/ai";
import { db } from "../lib/db";
import { analyticsQuery, sql } from "../lib/analytics-safe";

// PUBLIC (no auth) health of the four systems named on /status. Mounted OUTSIDE
// authMiddleware, because a status page nobody can read while logged out is not
// a status page.
//
// Deliberately coarse: each component resolves to operational | degraded | down
// and nothing else. Raw counts would tell an anonymous caller how much traffic
// the platform handles and when it is weakest, which is not information a status
// page owes anyone.
//
// Every probe is best-effort and fails toward "unknown" rather than "down": an
// analytics hiccup must not paint a red banner on a healthy platform. The one
// exception is the database, where a failed probe IS the outage.

export const publicStatusRouter = new Hono();

/** Lookback for the activity probes. Long enough to survive a quiet hour. */
const WINDOW_MINUTES = 60;
/** Scrape failure ratio above which the pipeline reads as degraded. */
const SCRAPE_FAILURE_DEGRADED = 0.5;
/** AI errors in the window before the insights pipeline reads as degraded. */
const AI_ERROR_THRESHOLD = 2;

type State = "operational" | "degraded" | "down" | "unknown";

type Component = {
  name: string;
  state: State;
  /** One short human sentence. Never a raw count. */
  detail: string;
};

async function dashboardAndApi(): Promise<Component> {
  try {
    await db.execute(dsql`SELECT 1`);
    return {
      name: "Dashboard & API",
      state: "operational",
      detail: "Serving requests.",
    };
  } catch {
    return {
      name: "Dashboard & API",
      state: "down",
      detail: "The database is not reachable.",
    };
  }
}

async function scrapingPipeline(): Promise<Component> {
  const rows = await analyticsQuery<{ total: string; failed: string }>(sql`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE status = 'failed') AS failed
    FROM scrape_runs
    WHERE recorded_at >= now() - make_interval(mins => ${WINDOW_MINUTES})
  `);

  const total = Number(rows[0]?.total ?? 0);
  const failed = Number(rows[0]?.failed ?? 0);

  // No runs in the window is not a fault: overnight, every monitor can be due
  // later. Claiming an outage here would cry wolf once a day.
  if (total === 0) {
    return {
      name: "Scraping pipeline",
      state: "unknown",
      detail: "No scrapes were due in the last hour.",
    };
  }

  const ratio = failed / total;
  if (ratio >= SCRAPE_FAILURE_DEGRADED) {
    return {
      name: "Scraping pipeline",
      state: "degraded",
      detail: "An unusual share of scrapes is failing.",
    };
  }
  return {
    name: "Scraping pipeline",
    state: "operational",
    detail: "Capturing competitor pages on schedule.",
  };
}

async function aiInsights(): Promise<Component> {
  const breaker = await checkGlobalBreaker();
  if (breaker.open) {
    return {
      name: "AI insights",
      state: "down",
      detail: "All model providers are unavailable; insights are paused.",
    };
  }

  const rows = await analyticsQuery<{ errors: string }>(sql`
    SELECT count(*) AS errors
    FROM ai_runs
    WHERE recorded_at >= now() - make_interval(mins => ${WINDOW_MINUTES})
      AND status = 'error'
  `);

  if (Number(rows[0]?.errors ?? 0) >= AI_ERROR_THRESHOLD) {
    return {
      name: "AI insights",
      state: "degraded",
      detail: "Model providers are rate-limiting; insights may lag.",
    };
  }
  return {
    name: "AI insights",
    state: "operational",
    detail: "Classifying changes and writing insights.",
  };
}

async function delivery(): Promise<Component> {
  const rows = await analyticsQuery<{ total: string; failed: string }>(sql`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE error IS NOT NULL) AS failed
    FROM alerts
    WHERE sent_at >= now() - make_interval(mins => ${WINDOW_MINUTES})
  `);

  const total = Number(rows[0]?.total ?? 0);
  if (total === 0) {
    return {
      name: "Email & Slack delivery",
      state: "unknown",
      detail: "No alerts were due in the last hour.",
    };
  }
  if (Number(rows[0]?.failed ?? 0) > 0) {
    return {
      name: "Email & Slack delivery",
      state: "degraded",
      detail: "Some alerts failed to send.",
    };
  }
  return {
    name: "Email & Slack delivery",
    state: "operational",
    detail: "Alerts and digests are going out.",
  };
}

publicStatusRouter.get("/", async (c) => {
  const components = await Promise.all([
    dashboardAndApi(),
    scrapingPipeline(),
    aiInsights(),
    delivery(),
  ]);

  // The page's headline. "unknown" never worsens it — an idle hour is not an
  // incident, and only a real signal should turn the banner.
  const overall: State = components.some((x) => x.state === "down")
    ? "down"
    : components.some((x) => x.state === "degraded")
      ? "degraded"
      : "operational";

  // Short cache: fresh enough to be worth reading during an incident, cheap
  // enough to survive being linked from a busy page.
  c.header("Cache-Control", "public, max-age=30, s-maxage=30");
  return c.json({
    overall,
    components,
    checkedAt: new Date().toISOString(),
  });
});
