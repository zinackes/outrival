import { Hono } from "hono";
import { checkGlobalBreaker } from "@outrival/ai";
import { authMiddleware } from "../middleware/auth";
import { analyticsQuery, sql } from "../lib/analytics-safe";

type Variables = { user: { id: string } };

export const systemRouter = new Hono<{ Variables: Variables }>();

systemRouter.use("*", authMiddleware);

// How far back we look for AI failures, and how many it takes to call the
// pipeline "degraded". A provider's free tier rate-limits in bursts: a single
// 429 self-heals via the SDK retries, so we only surface the banner once a couple
// of AI runs have actually failed inside the window.
const WINDOW_MINUTES = 15;
const ERROR_THRESHOLD = 2;

// Health of the AI pipeline for every signed-in user — the providers are shared
// across the workspace, so degradation affects everyone. Two signals (patch-22):
//   - global circuit breaker open (all providers down) → "down" + ETA
//   - repeated ai_runs errors in the window (rate-limited but still trying) → "degraded"
// Best-effort: breaker reads Redis (no-op → never open), analyticsQuery returns []
// on error (→ never degraded). Drives the "AI is catching up" banner.
systemRouter.get("/ai-status", async (c) => {
  const breaker = await checkGlobalBreaker();

  const rows = await analyticsQuery<{ errors: string; since: string | null }>(sql`
    SELECT count(*) AS errors, max(recorded_at)::text AS since
    FROM ai_runs
    WHERE recorded_at >= now() - make_interval(mins => ${WINDOW_MINUTES})
      AND status = 'error'
  `);
  const errorCount = Number(rows[0]?.errors ?? 0);

  let status: "healthy" | "degraded" | "down" = "healthy";
  let estimatedRecovery: string | null = null;
  if (breaker.open) {
    status = "down";
    if (breaker.resetInSec && breaker.resetInSec > 0) {
      estimatedRecovery = new Date(Date.now() + breaker.resetInSec * 1000).toISOString();
    }
  } else if (errorCount >= ERROR_THRESHOLD) {
    status = "degraded";
  }

  const degraded = status !== "healthy";
  // Incident key for the banner's dismiss logic: the breaker's recovery time while
  // it's open (stable for the incident), else the latest ai_runs failure timestamp.
  const since = degraded ? (estimatedRecovery ?? rows[0]?.since ?? null) : null;

  return c.json({ status, degraded, errorCount, since, estimatedRecovery });
});
