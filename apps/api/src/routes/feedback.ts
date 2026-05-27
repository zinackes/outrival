import { Hono } from "hono";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { feedback, users } from "@outrival/db";
import { uploadToR2 } from "@outrival/shared";
import { sendSlackMessage } from "@outrival/shared";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";

type Variables = { user: { id: string } };

export const feedbackRouter = new Hono<{ Variables: Variables }>();

feedbackRouter.use("*", authMiddleware);

const SubmitSchema = z.object({
  type: z.enum(["bug", "idea", "other"]).default("bug"),
  message: z.string().min(1).max(5000),
  pageUrl: z.string().url().optional(),
  consoleErrors: z
    .array(z.object({ ts: z.number(), message: z.string().max(500) }))
    .max(20)
    .optional(),
  // data URL JPEG base64 — cap roughly 2MB encoded (≈2.7MB base64)
  screenshot: z.string().max(2_800_000).optional(),
  userAgent: z.string().max(500).optional(),
});

function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1]!, buffer: Buffer.from(match[2]!, "base64") };
}

feedbackRouter.post("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const body = await c.req.json().catch(() => null);
  const parsed = SubmitSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }

  const data = parsed.data;
  const id = crypto.randomUUID();

  let screenshotR2Key: string | null = null;
  if (data.screenshot) {
    const decoded = parseDataUrl(data.screenshot);
    if (decoded && decoded.buffer.byteLength <= 2_000_000) {
      const ext = decoded.mime === "image/png" ? "png" : "jpg";
      const key = `feedback/${id}/screenshot.${ext}`;
      try {
        await uploadToR2(key, decoded.buffer, decoded.mime);
        screenshotR2Key = key;
      } catch {
        // R2 down → continue without screenshot, never block the user
      }
    }
  }

  await db.insert(feedback).values({
    id,
    orgId,
    userId: user.id,
    type: data.type,
    message: data.message,
    pageUrl: data.pageUrl ?? null,
    consoleErrors: data.consoleErrors ?? null,
    screenshotR2Key,
    userAgent: data.userAgent ?? null,
  });

  const emoji = data.type === "bug" ? "🐛" : data.type === "idea" ? "💡" : "💬";
  const where = data.pageUrl ? ` sur ${data.pageUrl}` : "";
  const text = `${emoji} [${data.type}] feedback de ${user.id}${where}\n${data.message}`;
  await sendSlackMessage(process.env.OPS_SLACK_WEBHOOK_URL ?? "", text);

  return c.json({ ok: true, id });
});

feedbackRouter.get("/", async (c) => {
  const user = c.get("user");
  const dbUser = await db.query.users.findFirst({ where: eq(users.id, user.id) });
  if (!dbUser || dbUser.role !== "owner") {
    return c.json({ error: "Forbidden" }, 403);
  }

  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const rows = await db.query.feedback.findMany({
    orderBy: desc(feedback.createdAt),
    limit,
  });

  return c.json({ feedback: rows });
});
