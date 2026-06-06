import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { getUsageSnapshot } from "../lib/plan";

type Variables = { user: { id: string } };

export const usageRouter = new Hono<{ Variables: Variables }>();

usageRouter.use("*", authMiddleware);

// Consumption cockpit (Phase A) — every quantified per-tier cap with current use.
// Read-only aggregate over existing tables (no new schema). The web renders the
// plan's static entitlements (sources/frequency/channels/retention) itself from
// PLAN_LIMITS, so this endpoint only carries the counted dimensions.
usageRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const snapshot = await getUsageSnapshot(orgId);
  return c.json(snapshot);
});
