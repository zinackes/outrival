import { createMiddleware } from "hono/factory";
import { getRedis } from "@outrival/shared";
import { ensureUserOrg } from "../lib/org";
import { getOrgPlan } from "../lib/plan";
import { aiRateLimitBody, consumeAiAction } from "../lib/ai-actions";

// Hard anti-abuse cap on discretionary AI actions per user (patch-22). Read routes are
// never gated. Backed by Upstash; degrades to a no-op when Upstash isn't configured
// (dev). Apply AFTER authMiddleware so c.get("user") is set. The budget itself lives in
// lib/ai-actions.ts — routes whose exemption depends on state they have to load first
// (a monitor's first scrape is setup, not consumption) call consumeAiAction directly.
//
// Per-tier since 2026-07-31 (PLAN_LIMITS.aiActionsPerHour). It was a flat 10/h for free
// and business alike, which is below a single legitimate setup burst and made the tier
// caps it sits above (pro: 20 re-scans + 50 battle cards a day) unreachable in one hour.

export const aiIntensiveRateLimit = createMiddleware<{
  Variables: { user: { id: string } };
}>(async (c, next) => {
  const userId = c.get("user")?.id;
  if (!userId) return next(); // unauthenticated → authMiddleware handles it
  if (!getRedis()) return next(); // no Upstash → skip before paying for the plan read

  const plan = await getOrgPlan(await ensureUserOrg(userId));
  const outcome = await consumeAiAction(userId, plan);
  if (!outcome.allowed) return c.json(aiRateLimitBody(outcome), 429);

  return next();
});
