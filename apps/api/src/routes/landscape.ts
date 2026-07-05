import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { buildLandscape } from "../lib/landscape-data";

type Variables = { user: { id: string } };

export const landscapeRouter = new Hono<{ Variables: Variables }>();

landscapeRouter.use("*", authMiddleware);

// Day-0 competitive landscape (docs/post-onboarding-activation.md, Lever 1).
// "Here is where you stand today", assembled entirely from first-scrape data —
// no diff, no signal, no AI call. The assembly lives in lib/landscape-data.ts so
// the public "Competitive Snapshot Report" share view (Lever 8) reuses it verbatim.
landscapeRouter.get("/", async (c) => {
  const orgId = await ensureUserOrg(c.get("user").id);
  // First scrapes land within minutes of onboarding; a short private cache keeps
  // the 30s client poll cheap without going stale.
  c.header("Cache-Control", "private, max-age=25");
  const productId = c.req.query("productId") || undefined;
  return c.json(await buildLandscape(orgId, productId));
});
