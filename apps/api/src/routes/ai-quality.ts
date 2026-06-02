import { Hono } from "hono";
import { z } from "zod";
import { acknowledgeQualityChecks } from "@outrival/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";

// User-facing anti-hallucination actions (patch-24). The admin review queue lives
// under /api/admin/ai-review-queue; this is the one action a regular user can take:
// acknowledge a flagged output as fine ("I checked, it's fine" on the warning).

type Variables = { user: { id: string } };

export const aiQualityRouter = new Hono<{ Variables: Variables }>();

aiQualityRouter.use("*", authMiddleware);

const TargetSchema = z.object({
  targetType: z.enum(["signal", "battle_card", "digest"]),
  targetId: z.string().min(1),
});

aiQualityRouter.post("/:targetType/:targetId/acknowledge", async (c) => {
  const parsed = TargetSchema.safeParse({
    targetType: c.req.param("targetType"),
    targetId: c.req.param("targetId"),
  });
  if (!parsed.success) return c.json({ error: "invalid_target" }, 400);

  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  await acknowledgeQualityChecks(parsed.data.targetType, parsed.data.targetId, orgId);
  return c.json({ ok: true });
});
