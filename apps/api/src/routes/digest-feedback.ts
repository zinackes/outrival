import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { qualityFeedback, digests, users, organizations } from "@outrival/db";
import { verifyDigestFeedbackToken, verifyUnsubscribeToken } from "@outrival/shared";
import { db } from "../lib/db";

// Public one-click digest feedback from the weekly email (patch-21, point d).
// No auth middleware: the signed token IS the credential. Anti-forgery via HMAC;
// the response is always a tiny HTML page (this opens in a browser tab).

export const digestFeedbackRouter = new Hono();

function page(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Outrival feedback</title></head>
<body style="margin:0;background:#0a0a0a;color:#fafafa;font-family:Inter,system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;">
<div style="text-align:center;padding:24px;">
<div style="font-family:Syne,sans-serif;font-size:24px;font-weight:bold;margin-bottom:12px;">Out<span style="color:#f59e0b;">rival</span></div>
<p style="color:#a3a3a3;font-size:15px;">${message}</p>
</div></body></html>`;
}

// One-click unsubscribe from the digest email footer. Same trust model as the
// feedback link: the signed token is the credential, and the only effect is
// flipping digestEnabled off (reversible from Settings > Notifications).
// POST is the RFC 8058 List-Unsubscribe-Post path mail clients call directly.
digestFeedbackRouter.on(["GET", "POST"], "/unsubscribe", async (c) => {
  const token = c.req.query("token");
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  const payload = token && secret ? verifyUnsubscribeToken(token, secret) : null;
  if (!payload) {
    return c.html(page("This unsubscribe link is invalid."), 400);
  }

  await db
    .update(organizations)
    .set({ digestEnabled: false, updatedAt: new Date() })
    .where(eq(organizations.id, payload.orgId));

  return c.html(
    page(
      "You're unsubscribed from digest emails. You can re-enable them anytime in Settings → Notifications.",
    ),
  );
});

digestFeedbackRouter.get("/", async (c) => {
  const token = c.req.query("token");
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  const payload = token && secret ? verifyDigestFeedbackToken(token, secret) : null;
  if (!payload) {
    return c.html(page("This feedback link is invalid or has expired."), 400);
  }

  // The digest must belong to the org named in the token.
  const digest = await db.query.digests.findFirst({
    where: eq(digests.id, payload.digestId),
  });
  if (!digest || digest.orgId !== payload.orgId) {
    return c.html(page("This feedback link is invalid."), 400);
  }

  // Email feedback isn't tied to a session — attribute it to a user of the org.
  const owner =
    (await db.query.users.findFirst({
      where: and(eq(users.orgId, payload.orgId), eq(users.role, "owner")),
    })) ?? (await db.query.users.findFirst({ where: eq(users.orgId, payload.orgId) }));
  if (!owner) {
    return c.html(page("Thanks for your feedback!"));
  }

  const existing = await db.query.qualityFeedback.findFirst({
    where: and(
      eq(qualityFeedback.userId, owner.id),
      eq(qualityFeedback.targetType, "digest"),
      eq(qualityFeedback.targetId, payload.digestId),
    ),
  });
  if (existing) {
    await db
      .update(qualityFeedback)
      .set({ verdict: payload.verdict, createdAt: new Date() })
      .where(eq(qualityFeedback.id, existing.id));
  } else {
    await db.insert(qualityFeedback).values({
      userId: owner.id,
      orgId: payload.orgId,
      targetType: "digest",
      targetId: payload.digestId,
      verdict: payload.verdict,
    });
  }

  return c.html(
    page(
      payload.verdict === "useful"
        ? "Thanks — glad the digest was useful!"
        : "Thanks — we'll work on making the digest more useful.",
    ),
  );
});
