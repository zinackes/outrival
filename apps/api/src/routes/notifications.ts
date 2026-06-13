import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { and, asc, count, desc, eq, gt } from "drizzle-orm";
import { notifications, organizations } from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";

type Variables = { user: { id: string } };

export const notificationsRouter = new Hono<{ Variables: Variables }>();

notificationsRouter.use("*", authMiddleware);

notificationsRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);

  const rows = await db.query.notifications.findMany({
    where: eq(notifications.orgId, orgId),
    orderBy: desc(notifications.createdAt),
    limit,
  });

  return c.json({ notifications: rows });
});

notificationsRouter.get("/unread-count", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const [row] = await db
    .select({ count: count() })
    .from(notifications)
    .where(and(eq(notifications.orgId, orgId), eq(notifications.isRead, false)));

  return c.json({ count: row?.count ?? 0 });
});

notificationsRouter.patch("/:id/read", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.id, id), eq(notifications.orgId, orgId)));

  return c.json({ ok: true });
});

notificationsRouter.post("/read-all", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.orgId, orgId), eq(notifications.isRead, false)));

  return c.json({ ok: true });
});

type ChannelResult = "sent" | "not_configured" | "error";

// Connectivity check: deliver a fixed test message straight to whichever
// channels the org has configured, reporting each one's result. Deliberately
// bypasses the signal pipeline (no signal, no AI, no alertsEnabled gating) so
// the user can verify Slack/webhook/email wiring in isolation.
notificationsRouter.post("/test", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return c.json({ error: "org_not_found" }, 404);

  const subject = "🔔 Outrival test alert";
  const text =
    "🔔 *Outrival test alert* — if you can read this, this channel is wired up correctly.";

  const results: Record<"email" | "slack" | "webhook", ChannelResult> = {
    email: "not_configured",
    slack: "not_configured",
    webhook: "not_configured",
  };
  const errors: Partial<Record<"email" | "slack" | "webhook", string>> = {};

  if (org.slackWebhookUrl) {
    try {
      const r = await fetch(org.slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) throw new Error(`${r.status} ${await r.text().catch(() => "")}`);
      results.slack = "sent";
    } catch (e) {
      results.slack = "error";
      errors.slack = String(e);
    }
  }

  if (org.webhookUrl) {
    try {
      const r = await fetch(org.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true, message: text }),
      });
      if (!r.ok) throw new Error(`${r.status} ${await r.text().catch(() => "")}`);
      results.webhook = "sent";
    } catch (e) {
      results.webhook = "error";
      errors.webhook = String(e);
    }
  }

  if (org.digestEmail) {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      results.email = "error";
      errors.email = "RESEND_API_KEY not set";
    } else {
      try {
        const from = process.env.RESEND_FROM ?? "Outrival <alerts@outrival.io>";
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({ from, to: org.digestEmail, subject, html: `<p>${text}</p>` }),
        });
        if (!r.ok) throw new Error(`${r.status} ${await r.text().catch(() => "")}`);
        results.email = "sent";
      } catch (e) {
        results.email = "error";
        errors.email = String(e);
      }
    }
  }

  return c.json({ results, errors });
});

notificationsRouter.get("/stream", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  // Disable reverse-proxy response buffering (nginx/Traefik) so SSE chunks reach
  // the client immediately instead of being held until the connection closes.
  c.header("X-Accel-Buffering", "no");

  return streamSSE(c, async (stream) => {
    let lastCheck = new Date();
    let aborted = false;
    stream.onAbort(() => {
      aborted = true;
    });

    await stream.writeSSE({ event: "ready", data: JSON.stringify({ ts: Date.now() }) });

    while (!aborted) {
      // Capture the poll time BEFORE querying. Postgres timestamps carry
      // microseconds that JS Date truncates to ms — advancing lastCheck to a
      // row's createdAt would leave that residue, so the same row keeps
      // matching gt() and gets re-sent every poll. Advancing to wall-clock
      // poll time avoids the re-send.
      const polledAt = new Date();
      const fresh = await db.query.notifications.findMany({
        where: and(
          eq(notifications.orgId, orgId),
          gt(notifications.createdAt, lastCheck),
        ),
        orderBy: asc(notifications.createdAt),
        limit: 20,
      });

      for (const n of fresh) {
        await stream.writeSSE({
          event: "notification",
          data: JSON.stringify(n),
        });
      }
      lastCheck = polledAt;

      await stream.writeSSE({ event: "heartbeat", data: String(Date.now()) });
      await stream.sleep(3000);
    }
  });
});
