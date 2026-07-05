import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { buildMonthlyRecap } from "../lib/monthly-recap";

type Variables = { user: { id: string } };

export const recapRouter = new Hono<{ Variables: Variables }>();

recapRouter.use("*", authMiddleware);

// Monthly "Competitive Recap" (Lever 9) — the numbers behind the in-app Wrapped view.
// Defaults to the last complete month; `?month=YYYY-MM` for a specific one. All tiers.
recapRouter.get("/", async (c) => {
  const orgId = await ensureUserOrg(c.get("user").id);
  c.header("Cache-Control", "private, max-age=300");
  const month = c.req.query("month") || undefined;
  return c.json(await buildMonthlyRecap(orgId, month));
});
